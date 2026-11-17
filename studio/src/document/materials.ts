import type { ComposedNode, IfcxFile, IfcxNode, ProvenanceSource } from '../ifcx/types';
import type { ComposeResult } from '../ifcx/compose';
import { editPath } from '../composer/edits';
import { resolveUri } from '../composer/uri';
import { fileName } from '../model/open';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { BASE_URI, ForeignSession, importsFor } from '../modeling/foreign';
import type { MaterialDef } from '../materials/state';
import { K_DENSITY, materialNodes, modelColor, type MaterialNode } from '../materials/nodes';
import { assignTo, checkDef, clearKeys, defChanges, elementMaterial, newMaterialNode, OVERRIDABLE_KEYS, writeAttrs, type AssignTarget } from '../materials/overs';
import { emptyAssignment } from '../costs/assign';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { OverEdit, OverResult, DOCUMENT_LAYER } from './shared';

/** Empty material library; the material keys bring their standard schemas when added. */
const emptyLibrary = (id: string): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'Dream BIM', timestamp: new Date().toISOString() },
  imports: [],
  schemas: {},
  data: [],
});

/** The library with the node added, with the schemas of the attributes it writes. */
function withNode(lib: IfcxFile, node: IfcxNode, keys: string[]): IfcxFile {
  const schemas = keys.includes(K_DENSITY) && !(K_DENSITY in (lib.schemas ?? {}))
    ? { ...lib.schemas, [K_DENSITY]: { value: { dataType: 'Real' as const } } }
    : lib.schemas;
  return { ...lib, imports: importsFor(lib, keys), schemas, data: [...lib.data, node] };
}

export class MaterialsService {
  constructor(private readonly ctx: DocumentContext) {}

  /**
   * The assignments of the legacy `*.materials.ifcx` move to `inherits.material` in the over
   * layer of the document (their colors are discarded). A code without a node is created as a new material. It is not a
   * history step: it leaves the document with changes and warns.
   */
  async migrateLegacyAssignments(s: EditSession, assign: Record<string, string>, file: string): Promise<void> {
    const result = this.ctx.state.shown?.result;
    if (!result) return;
    const nodes = this.materialNodes;
    const elements = this.elementsByEditPath(result);
    const made = new Map<string, string>();
    let overs = this.docOvers();
    let converted = 0;
    for (const [ep, code] of Object.entries(assign)) {
      const el = elements.get(ep);
      if (!el) continue;
      let path = nodes.find((n) => n.def.code === code)?.path ?? made.get(code);
      let withNode = overs;
      if (!path) {
        const fresh = newMaterialNode({ name: code, code, color: modelColor(code), opacity: 1 });
        withNode = [...overs, fresh];
        path = fresh.path;
      }
      const next = assignTo(withNode, ep, { node: path, code }, elementMaterial(el, result));
      if (next === withNode) continue;
      made.set(code, path);
      overs = next;
      converted++;
    }
    if (!converted) return;
    this.setDocOvers(overs);
    s.dirty = true;
    this.ctx.state.version = this.ctx.state.nextVersion++;
    if (s instanceof ForeignSession) {
      this.ctx.stack.writeMeta(s);
      await this.ctx.stack.recompose();
    } else await this.ctx.stack.refresh(s, true);
    this.ctx.d.toast(`Converted ${converted} material assignment${converted === 1 ? '' : 's'} from ${file}; its colors are no longer used`, 'info');
  }

  /** The materials of the shown model (IFCX nodes), with what the document overrides of each one. */
  get materialNodes(): (MaterialNode & { overridden: string[] })[] {
    const result = this.ctx.state.shown?.result;
    if (!result?.provenance) return [];
    return materialNodes(result, (src) => this.isDocumentSource(src)).map((n) => {
      const written = result.provenance.attributeSources(n.path);
      const overridden = n.site === 'document'
        ? []
        : OVERRIDABLE_KEYS.filter((k) => written[k] !== undefined && this.isDocumentSource(written[k]));
      return { ...n, overridden };
    });
  }

  /** Is that composition source the document itself (it, its edits or its base)? */
  private isDocumentSource(src: ProvenanceSource): boolean {
    if (src.role !== 'layer') return false;
    const id = src.layerId;
    if (id === DOCUMENT_LAYER || id === 'base' || id === 'base:edits') return true;
    // without a stack, the model is composed directly and its layer keeps the id it was read with
    return id !== undefined && id === this.ctx.state.base?.layer?.id && !this.ctx.state.layers.some((l) => l.id === id);
  }

  /**
   * Changes the cost assignment layer (`<model>.costos-asignacion.ifcx`, next to the document): a history
   * step. The first time it reads it from disk if it already exists or creates it empty, and adds it to the model imports, so
   * that the model remains geometry only. An unsaved document cannot have that file next to it yet.
   */
  changeCostAssignment(label: string, change: (file: IfcxFile, result: ComposeResult) => IfcxFile | string): Promise<boolean> {
    return this.overChange(label, async (overs, result) => {
      const s = this.ctx.state.current;
      const docPath = this.ctx.stack.docPath();
      if (!s || !docPath) return 'Save the model before assigning costs';
      const uri = `${fileName(docPath).replace(/\.ifcx$/i, '')}.costos-asignacion.ifcx`;
      const location = resolveUri(docPath, uri);
      const imported = this.ctx.libraryFiles.importedUris().includes(uri);
      const known = this.ctx.state.libs.has(location) || imported || (await this.ctx.d.exists?.(location));
      const prev = known ? await this.ctx.libraryFiles.ensureLib(location) : emptyAssignment(uri.replace(/\.ifcx$/i, ''));
      const next = change(prev, result);
      if (typeof next === 'string') return next;
      if (next === prev) return overs;
      const libs = new Map(this.ctx.state.libs).set(location, next);
      if (imported) return { overs, libs };
      if (s instanceof ForeignSession) return { overs, libs, source: { ...s.source, imports: [...(s.source.imports ?? []), { uri }] } };
      return { overs, libs, docImports: [...s.doc.imports, uri] };
    });
  }

  /** The over layer of the document: in a foreign IFCx the edits of its base, in a Studio one its overs. */
  docOvers(): IfcxNode[] {
    const s = this.ctx.state.current;
    if (s instanceof ForeignSession) return this.ctx.state.baseLayer?.edits ?? [];
    return s?.doc.overs ?? [];
  }

  setDocOvers(next: IfcxNode[]): void {
    const s = this.ctx.state.current;
    if (s instanceof ForeignSession) {
      if (this.ctx.state.baseLayer) this.ctx.state.baseLayer.edits = next;
    } else if (s) s.doc.overs = next;
  }

  /**
   * Queues a materials change in the document. `change` receives the overs and the shown model and
   * returns the new overs (the same list if there is nothing to change), a text with the reason for the
   * rejection (it is shown and nothing changes) or an `OverEdit` if it also changes libraries or imports.
   * `unchanged`: what the promise returns when there is nothing to change.
   */
  overChange(
    label: string,
    change: (overs: IfcxNode[], result: ComposeResult) => OverResult | Promise<OverResult>,
    unchanged = true,
  ): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    const s = this.ctx.state.current;
    if (!s) {
      this.ctx.d.toast(NOT_EDITABLE, 'info');
      return Promise.resolve(false);
    }
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      const result = this.ctx.state.shown?.result;
      if (gen !== this.ctx.state.generation || this.ctx.state.current !== s || !result) return false;
      if (s instanceof ForeignSession && this.ctx.state.baseLayer && this.ctx.stack.editsOff(this.ctx.state.baseLayer)) return false;
      const before = this.docOvers();
      const got = await change(before, result);
      if (gen !== this.ctx.state.generation || this.ctx.state.current !== s) return false;
      if (typeof got === 'string') {
        this.ctx.d.toast(got, 'info');
        return false;
      }
      const edit: OverEdit = Array.isArray(got) ? { overs: got } : got;
      if (edit.overs === before && !edit.source && !edit.libs && !edit.docImports) return unchanged;
      const snap = this.ctx.history.snapshot(label);
      this.setDocOvers(edit.overs);
      if (edit.libs) this.ctx.state.libs = edit.libs;
      if (edit.docImports) s.doc.imports = edit.docImports;
      if (s instanceof ForeignSession && edit.source) {
        s.source = edit.source;
        this.ctx.state.files.set(BASE_URI, edit.source);
      }
      s.dirty = true;
      this.ctx.history.commit(snap);
      if (s instanceof ForeignSession) {
        this.ctx.stack.writeMeta(s);
        await this.ctx.stack.recompose();
      } else await this.ctx.stack.refresh(s, true);
      return true;
    });
  }

  /** Elements of the shown model by their edit path. */
  elementsByEditPath(result: ComposeResult): Map<string, ComposedNode> {
    const out = new Map<string, ComposedNode>();
    for (const n of result.byPath.values()) if (n.parent) out.set(editPath(n, result), n);
    return out;
  }

  /** Elements that use that material: they inherit it from the node or carry it as their own code. */
  private usersOf(result: ComposeResult, node: MaterialNode | undefined, code: string): [string, ComposedNode][] {
    return [...this.elementsByEditPath(result)].filter(([, n]) => {
      const m = elementMaterial(n, result);
      return node ? m.inherited === node.path : m.localCode === code;
    });
  }

  /**
   * Puts the node of a new material in the local library that the model already imports; if there is none,
   * in a new `materiales.ifcx` next to the model, which the model imports. Returns the change or the reason.
   */
  private async placeInLibrary(node: IfcxNode, overs: IfcxNode[], result: ComposeResult): Promise<OverEdit | string> {
    const s = this.ctx.state.current;
    if (!s) return NOT_EDITABLE;
    const nodes = this.materialNodes.filter((n) => n.site === 'library' && n.source.location);
    const first = result.provenance.sources.find((src) => nodes.some((n) => n.source === src));
    const keys = Object.keys(node.attributes ?? {});
    if (first?.location) {
      const lib = await this.ctx.libraryFiles.ensureLib(first.location);
      return { overs, libs: new Map(this.ctx.state.libs).set(first.location, withNode(lib, node, keys)) };
    }
    const docPath = this.ctx.stack.docPath();
    if (!docPath) return 'Save the model before creating a material library';
    let uri = 'materiales.ifcx';
    for (let n = 2; this.ctx.d.exists && (await this.ctx.d.exists(resolveUri(docPath, uri))); n++) uri = `materiales-${n}.ifcx`;
    const location = resolveUri(docPath, uri);
    const lib = withNode(emptyLibrary(uri), node, keys);
    const libs = new Map(this.ctx.state.libs).set(location, lib);
    if (s instanceof ForeignSession) return { overs, libs, source: { ...s.source, imports: [...(s.source.imports ?? []), { uri }] } };
    return { overs, libs, docImports: [...s.doc.imports, uri] };
  }

  /** Creates (`code` null) or changes material `code`; a different `def.code` renames it. Editing creates an over. */
  setMaterial(code: string | null, def: MaterialDef): Promise<boolean> {
    const next: MaterialDef = { ...def, name: def.name.trim(), code: def.code.trim() };
    return this.overChange(code === null ? 'New Material' : 'Change Material', async (overs, result) => {
      const bad = checkDef(next);
      if (bad) return bad;
      const nodes = this.materialNodes;
      if (nodes.some((n) => n.def.code === next.code && n.def.code !== code)) return `A material with code ${next.code} already exists`;
      if (code === null) return this.placeInLibrary(newMaterialNode(next), overs, result);
      const node = nodes.find((n) => n.def.code === code);
      if (node) return writeAttrs(overs, node.path, defChanges(node.def, next));
      // a material the model only carries as a code: its node is created and the elements inherit it
      const fresh = newMaterialNode(next);
      const placed = await this.placeInLibrary(fresh, overs, result);
      if (typeof placed === 'string') return placed;
      let out = placed.overs;
      for (const [ep, n] of this.usersOf(result, undefined, code)) {
        out = assignTo(out, ep, { node: fresh.path, code: next.code }, elementMaterial(n, result));
      }
      return { ...placed, overs: out };
    });
  }

  /** Removes the overs of this material in the document and restores what its file says. false if there were none. */
  resetMaterial(code: string): Promise<boolean> {
    return this.overChange('Reset Material', (overs) => {
      const node = this.materialNodes.find((n) => n.def.code === code);
      if (!node || !node.overridden.length) return overs;
      return this.withoutOver(node, overs);
    }, false);
  }

  /** The overs without that node's overrides (also those already baked into the base file of a foreign IFCx). */
  private withoutOver(node: MaterialNode & { overridden: string[] }, overs: IfcxNode[]): OverEdit {
    const out = clearKeys(overs, node.path, node.overridden);
    const s = this.ctx.state.current;
    if (s instanceof ForeignSession) {
      const data = clearKeys(s.source.data, node.path, node.overridden);
      if (data !== s.source.data) return { overs: out, source: { ...s.source, data } };
    }
    return { overs: out };
  }

  /** Moves this material's overrides in the document to its library and removes them from the document. */
  promoteMaterial(code: string): Promise<boolean> {
    return this.overChange('Change Material in Library', async (overs, result) => {
      const node = this.materialNodes.find((n) => n.def.code === code);
      if (!node || !node.overridden.length) return overs;
      if (node.site === 'readonly') return 'This material comes from a file Dream BIM cannot write';
      if (node.site !== 'library' || !node.source.location) return overs;
      const location = node.source.location;
      const lib = await this.ctx.libraryFiles.ensureLib(location);
      const composed = result.provenance.attributesOf(node.path) ?? {};
      const data = lib.data.map((n) => ({ ...n }));
      const at = data.map((n) => n.path).lastIndexOf(node.path);
      if (at < 0) return 'This material is not defined in its library any more';
      const attributes = { ...data[at].attributes };
      for (const k of node.overridden) {
        if (composed[k] === undefined) delete attributes[k];
        else attributes[k] = composed[k];
      }
      data[at] = { ...data[at], attributes };
      return { ...this.withoutOver(node, overs), libs: new Map(this.ctx.state.libs).set(location, { ...lib, data }) };
    }, false);
  }

  /** Copy of a material with another free code (`<code>-copy`, `-copy-2`…); null if it does not exist or could not be done. */
  async duplicateMaterial(code: string): Promise<string | null> {
    let made: string | null = null;
    const ok = await this.overChange('Duplicate Material', (overs, result) => {
      const src = this.materialNodes.find((n) => n.def.code === code);
      if (!src) return overs;
      const taken = new Set(this.materialNodes.map((n) => n.def.code));
      let n = 1;
      let copy = `${code}-copy`;
      while (taken.has(copy)) copy = `${code}-copy-${++n}`;
      made = copy;
      return this.placeInLibrary(newMaterialNode({ ...src.def, code: copy, name: `${src.def.name} copy` }), overs, result);
    });
    return ok ? made : null;
  }

  /** Removes the material and its assignment to the elements, in a single step. */
  deleteMaterial(code: string): Promise<boolean> {
    return this.overChange('Delete Material', async (overs, result) => {
      const node = this.materialNodes.find((n) => n.def.code === code);
      const users = this.usersOf(result, node, code);
      if (!node && !users.length) return overs;
      if (node?.site === 'readonly') return 'This material comes from a file Dream BIM cannot write';
      if (node?.site === 'document' && !overs.some((o) => o.path === node.path)) return 'Deleting a material from its own file is not supported yet';
      let out = overs;
      for (const [ep, n] of users) out = assignTo(out, ep, null, elementMaterial(n, result));
      if (!node) return out;
      out = out.filter((o) => o.path !== node.path);
      if (node.site === 'document') return out;
      const location = node.source.location!;
      const lib = await this.ctx.libraryFiles.ensureLib(location);
      const data = lib.data.filter((n) => n.path !== node.path);
      return { overs: out, libs: new Map(this.ctx.state.libs).set(location, { ...lib, data }) };
    });
  }

  /** Assigns `code` (null: removes the material) to those elements, by their edit path. */
  assignMaterial(paths: string[], code: string | null, label: string = 'Assign Material'): Promise<boolean> {
    return this.overChange(label, (overs, result) => {
      const node = code === null ? undefined : this.materialNodes.find((n) => n.def.code === code);
      const target: AssignTarget | null =
        code === null ? null : { node: node?.path ?? null, code, ...(node?.def.uri ? { uri: node.def.uri } : {}) };
      const elements = this.elementsByEditPath(result);
      let out = overs;
      for (const p of paths) {
        const n = elements.get(p);
        if (n) out = assignTo(out, p, target, elementMaterial(n, result));
      }
      return out;
    });
  }
}
