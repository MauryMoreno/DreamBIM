// IFCx file that is not from Studio (e.g. converted from IFC), opened for editing. The file is the
// base: the controller composes it as an internal layer that is edited just like a linked file
// (move, relocate, properties). On top goes a minimal layer with what is placed. Save applies the
// edits to the nodes of the file itself and overwrites it, keeping everything Studio does not understand.
import { findRoots, flatten } from '../ifcx/compose';
import { parseIfcx } from '../ifcx/layers';
import type { IfcxFile, IfcxNode, IfcxSchema } from '../ifcx/types';
import { BUNDLED_SCHEMAS } from '../model/schemas';
import {
  CONTAINER_PREFIX, K_COMPOSER, parseComposer, serializeComposer, placementTransform, type ComposerMeta, type StudioDoc,
} from './document';
import { EditSession } from './session';

import { BASE_URI } from '../composer/stack';

export { BASE_URI };
const K_CLASS = 'bsi::ifc::class';
const K_NAME = 'bsi::ifc::prop::Name';

/** Composer schema: a validating viewer requires every attribute to have one. */
const COMPOSER_SCHEMA: IfcxSchema = { value: { dataType: 'Object' } };

/** Schema ids declared by each packaged standard schema (computed once). */
let bundledIds: Map<string, Set<string>> | null = null;
function idsOfBundled(): Map<string, Set<string>> {
  bundledIds ??= new Map(Object.entries(BUNDLED_SCHEMAS).map(([uri, text]) => [uri, new Set(Object.keys(parseIfcx(text).schemas ?? {}))]));
  return bundledIds;
}

/**
 * Imports of the file plus the standard schemas needed for the attributes it writes
 * Studio (`keys`): un visor que valida rechaza un atributo sin esquema. Un id que el archivo ya
 * declares, or one of its standard imports brings, adds nothing.
 */
export function importsFor(file: IfcxFile, keys: Iterable<string>): NonNullable<IfcxFile['imports']> {
  const imports = [...(file.imports ?? [])];
  const bundled = idsOfBundled();
  const declared = (key: string) =>
    key in (file.schemas ?? {}) || imports.some((i) => bundled.get(i.uri)?.has(key));
  for (const key of keys) {
    if (declared(key)) continue;
    const uri = [...bundled].find(([, ids]) => ids.has(key))?.[0];
    if (uri) imports.push({ uri });
  }
  return imports;
}

/** Ids de atributo que usan esos nodos. */
const attributeKeys = (nodes: IfcxNode[]): Set<string> => new Set(nodes.flatMap((n) => Object.keys(n.attributes ?? {})));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (o: object | undefined) => !o || Object.keys(o).length === 0;

/** IfcProject node of the file (where the composer is stored); if there is none, its first root. */
function projectOf(file: IfcxFile): string {
  const p = file.data.find((n) => {
    const c = n.attributes?.[K_CLASS];
    return isObj(c) && c.code === 'IfcProject';
  });
  return p?.path ?? findRoots(flatten([file]))[0] ?? '';
}

/**
 * Merges a map of children (or of inherits) of an edit into that of the node: `null` removes the entry.
 * Si la ruta tiene una sola entrada en el archivo se borra; si tiene varias se deja el `null`,
 * that it also removes it from the others when composing.
 */
function mergeMap(
  base: Record<string, string | null> | undefined,
  edit: Record<string, string | null>,
  single: boolean,
): Record<string, string | null> {
  const out = { ...base };
  for (const [k, v] of Object.entries(edit)) {
    if (v === null && single && k in out) delete out[k];
    else out[k] = v;
  }
  return out;
}

/**
 * Applies an edit layer to the nodes of the file: each edit is merged into the last entry of
 * its path (attributes on top, children with `null` = remove); a path the file does not have (e.g. the
 * override of an instance, `parent/child`) is added as is. It does not change the received lists.
 */
export function applyEdits(data: IfcxNode[], edits: IfcxNode[]): IfcxNode[] {
  const out = data.map((n) => ({ ...n }));
  const last = new Map<string, number>();
  const count = new Map<string, number>();
  out.forEach((n, i) => {
    last.set(n.path, i);
    count.set(n.path, (count.get(n.path) ?? 0) + 1);
  });
  for (const e of edits) {
    const i = last.get(e.path);
    if (i === undefined) {
      out.push(JSON.parse(JSON.stringify(e)));
      last.set(e.path, out.length - 1);
      continue;
    }
    const n = out[i];
    const single = count.get(e.path) === 1;
    out[i] = {
      ...n,
      ...(e.attributes ? { attributes: { ...n.attributes, ...JSON.parse(JSON.stringify(e.attributes)) } } : {}),
      ...(e.children ? { children: mergeMap(n.children, e.children, single) } : {}),
      ...(e.inherits ? { inherits: mergeMap(n.inherits, e.inherits, single) } : {}),
    };
  }
  return out;
}

export class ForeignSession extends EditSession {
  /** Edits of the base not yet saved (the controller copies them before saving). */
  baseEdits: IfcxNode[] = [];
  /** Indentation it is saved with: that of the original file (0 = compact, as the converter leaves it). */
  indent = 0;

  /**
   * `source`: el archivo sin lo que escribe Studio al guardarlo (contenedores, sus enlaces y el
   * composer), que se reconstruye desde `composer`.
   */
  constructor(public source: IfcxFile, composer: ComposerMeta) {
    const project = projectOf(source);
    const doc: StudioDoc = {
      ids: { root: project, project, site: '', building: '' },
      levels: [],
      walls: [],
      floors: [],
      stairs: [],
      composer,
      overs: [],
      imports: [],
    };
    super(doc);
  }

  /** The elements of the base are placed as nodes of a layer (BASE_URI), not as Studio elements. */
  override isPlaceTarget(_id: string): boolean {
    return false;
  }

  /**
   * Minimal layer on top of the base: the containers of what is placed and the children that are added to their
   * parents. A parent that is no longer there (its layer was removed or switched off) is replaced by the project.
   */
  overlay(): IfcxFile {
    const { layers, placements } = this.doc.composer;
    const layerOf = (uri: string) => layers.find((l) => l.uri === uri);
    const usable = (uri: string) => uri === BASE_URI || layerOf(uri)?.enabled === true;
    const parents = new Map<string, Record<string, string>>();
    const data: IfcxNode[] = [];
    for (const p of placements) {
      const layer = layerOf(p.layerUri);
      if (!layer) continue;
      const from = p.parentLayerUri ?? BASE_URI;
      const parent = usable(from) && from !== p.layerUri ? p.parentId : this.doc.ids.project;
      parents.set(parent, { ...parents.get(parent), [p.id]: p.id });
      data.push({
        path: p.id,
        children: layer.enabled ? Object.fromEntries(p.roots.map((r) => [r, r])) : {},
        attributes: {
          [K_NAME]: `${CONTAINER_PREFIX}${layer.name}`,
          'usd::xformop': { transform: placementTransform(p) },
        },
      });
    }
    for (const [path, children] of parents) data.push({ path, children });
    return {
      header: { ...this.source.header },
      imports: [...Object.keys(BUNDLED_SCHEMAS), ...layers.map((l) => l.uri)].map((uri) => ({ uri })),
      schemas: {},
      data,
    };
  }

  /** What the viewer paints: only the minimal layer (the base and its edits are composed by the controller). */
  override async modelText(): Promise<string> {
    return JSON.stringify(this.overlay());
  }

  /** The file with the edits applied to its nodes, without what Studio writes on top. */
  private baked(): IfcxFile {
    return { ...this.source, data: applyEdits(this.source.data, this.baseEdits) };
  }

  /** The file as it is saved: the baked edits, the links in `imports`, what is placed and the composer. */
  override async serialize(): Promise<string> {
    const base = this.baked();
    const { layers, placements } = this.doc.composer;
    const added = this.overlay().data;
    // the standard schemas needed by what was edited and placed, and then the links
    const imports = importsFor(base, attributeKeys([...this.baseEdits, ...added]));
    for (const l of layers) if (!imports.some((i) => i.uri === l.uri)) imports.push({ uri: l.uri });
    // sin enlaces ni colocaciones no queda rastro de Studio: solo lo editado en sus nodos
    const meta: IfcxNode[] = layers.length || placements.length
      ? [{ path: this.doc.ids.project, attributes: { [K_COMPOSER]: serializeComposer(this.doc.composer) } }]
      : [];
    const schemas = meta.length ? { ...base.schemas, [K_COMPOSER]: COMPOSER_SCHEMA } : base.schemas;
    const file: IfcxFile = { ...base, imports, schemas, data: [...base.data, ...added, ...meta] };
    return JSON.stringify(file, null, this.indent || undefined);
  }

  /** Escribe y solo entonces fija la ruta, hornea las ediciones en la base y limpia dirty. */
  override async saveTo(path: string): Promise<void> {
    const source = this.baked();
    await super.saveTo(path);
    this.source = source;
    this.baseEdits = [];
  }
}

/**
 * Session for editing an IFCx that is not from Studio. It separates what Studio wrote when saving it
 * (containers, the children it added to their parents, the composer and the links in `imports`) in order to
 * rebuild it from the composer. It never throws: a damaged composer is discarded and reported.
 */
export function foreignFromFile(file: IfcxFile, path: string, text?: string): ForeignSession {
  let raw: unknown;
  for (const n of file.data) if (n.attributes && K_COMPOSER in n.attributes) raw = n.attributes[K_COMPOSER];
  const parsed = raw === undefined ? null : parseComposer(raw);
  const composer: ComposerMeta = parsed ? { layers: parsed.layers, placements: parsed.placements } : { layers: [], placements: [] };
  const containers = parsed?.containers ?? new Set<string>();
  const linked = new Set(composer.layers.map((l) => l.uri));

  const data: IfcxNode[] = [];
  for (const n of file.data) {
    if (containers.has(n.path)) continue;
    let next: IfcxNode = n;
    if (n.children && Object.values(n.children).some((v) => v !== null && containers.has(v))) {
      next = { ...next, children: Object.fromEntries(Object.entries(n.children).filter(([, v]) => v === null || !containers.has(v))) };
    }
    if (n.attributes && K_COMPOSER in n.attributes) {
      const { [K_COMPOSER]: _meta, ...attributes } = n.attributes;
      next = { ...next, attributes };
    }
    // an entry that only had what Studio added disappears
    if (next !== n && isEmpty(next.attributes) && isEmpty(next.children) && isEmpty(next.inherits)) continue;
    data.push(next);
  }
  const { [K_COMPOSER]: _schema, ...schemas } = file.schemas ?? {};
  const source: IfcxFile = {
    ...file,
    imports: (file.imports ?? []).filter((i) => !linked.has(i.uri)),
    schemas: raw === undefined ? file.schemas : schemas,
    data,
  };
  const s = new ForeignSession(source, composer);
  s.path = path;
  s.composerDamaged = raw !== undefined && !parsed;
  // the indentation of the first key of the original text (without text or compact, 0)
  s.indent = text ? /^\s*\{\r?\n([ \t]+)"/.exec(text)?.[1].length ?? 0 : 0;
  return s;
}
