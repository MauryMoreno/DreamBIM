import type { IfcxNode } from '../ifcx/types';
import { findRoots, flatten } from '../ifcx/compose';
import { displayName } from '../ifcx/names';
import { editPath, marksOf, orphans } from '../composer/edits';
import type { PlaceTarget, StackRow } from '../composer/rows';
import { composeStack, DOCUMENT_COLOR, editsFile, type ComposerLayer } from '../composer/stack';
import type { EditMark, StageData } from '../composer/stagepanel';
import { resolveUri } from '../composer/uri';
import type { LoadedModel } from '../model/load';
import { perfSpanAsync } from '../render/perf';
import { errorMessage } from '../model/open';
import { sortedLevels } from '../modeling/document';
import { ForeignSession } from '../modeling/foreign';
import type { ElementColor } from '../render/coloroverride';
import { sessionModel, type EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { DOCUMENT_LAYER, persisted } from './shared';

/** Where a linked file can be placed: the project and the levels, from bottom to top. */
const placeTargets = (s: EditSession): PlaceTarget[] => [
  { id: s.doc.ids.project, name: 'Project' },
  ...sortedLevels(s.doc.levels).map((l) => ({ id: l.id, name: l.name })),
];

export class StackService {
  constructor(private readonly ctx: DocumentContext) {}

  /** The model the viewer paints from the session: the document plus the composed stack. */
  async build(s: EditSession): Promise<LoadedModel> {
    const raw = this.ctx.d.buildModel ?? sessionModel;
    const m = await raw(s);
    this.ctx.state.base = m;
    return this.compose(m);
  }


  newLayerId(): string {
    return String(this.ctx.state.nextLayerId++);
  }

  /** Document path against which the uris are resolved (null if it has not been saved yet). */
  docPath(): string | null {
    return this.ctx.state.current ? this.ctx.state.current.path : this.ctx.state.base?.path ?? null;
  }

  /** The model with the linked layers below the document and the loaded payloads (the same one if none). */
  compose(m: LoadedModel): Promise<LoadedModel> {
    const all = this.stack();
    const layer = m.layer && { ...m.layer, id: DOCUMENT_LAYER };
    const overlays = this.ctx.sidecars.overlays();
    return layer && (all.length || this.ctx.state.payloads.size || overlays.length || this.ctx.state.libs.size)
      ? perfSpanAsync('studio.compose', () =>
          composeStack(m.name, m.path, layer, all, this.ctx.state.files, this.ctx.libraryFiles.libFetcher, this.ctx.state.payloads, overlays)).then((r) => this.withColors(r))
      : Promise.resolve(m);
  }

  /** The model with the saved colors translated from edit path to composed path. */
  private withColors(m: LoadedModel): LoadedModel {
    const { assign } = this.ctx.state.colorsState;
    if (Object.keys(assign).length === 0) return m;
    const savedColors = new Map<string, ElementColor>();
    for (const n of m.result.byPath.values()) {
      const c = assign[editPath(n, m.result)];
      if (c) savedColors.set(n.path, c);
    }
    return savedColors.size ? { ...m, savedColors } : m;
  }

  /** The layers that are composed: the linked ones and, in a foreign file, its base on top. */
  private stack(): ComposerLayer[] {
    return this.ctx.state.baseLayer ? [...this.ctx.state.layers, this.ctx.state.baseLayer] : this.ctx.state.layers;
  }

  /**
   * Puts the current roots of its file into the layer placement (if it is placed, the file
   * was read and has roots; if not, it keeps the saved ones). true if they changed.
   */
  refreshRoots(s: EditSession, l: ComposerLayer): boolean {
    const file = this.ctx.state.files.get(l.uri);
    const list = s.doc.composer.placements.filter((p) => p.layerUri === l.uri);
    if (!list.length || !file) return false;
    const roots = findRoots(flatten([file]));
    if (!roots.length) return false;
    let changed = false;
    for (const p of list) {
      if (roots.length === p.roots.length && roots.every((r, i) => r === p.roots[i])) continue;
      p.roots = [...roots];
      changed = true;
    }
    return changed;
  }

  /** Copies the stack to the document metadata (what is saved), without marking changes. */
  writeMeta(s: EditSession): void {
    s.doc.composer.layers = this.ctx.state.layers.map(persisted);
    if (s instanceof ForeignSession && this.ctx.state.baseLayer) s.baseEdits = this.ctx.state.baseLayer.edits;
  }

  /**
   * Stage data: the composed root and, for each data path, the strongest layer that defines it
   * (active layers in stack order, each followed by its edits, and the document at the end).
   */
  stageData(): StageData {
    // A layer that only adds children to a node (e.g. a model that hangs its elements from a level
    // of the base) does not keep it: the strongest one that defines it with attributes or inherits wins, and
    // only if none does, the strongest one that names it.
    const strong = new Map<string, string>();
    const weak = new Map<string, string>();
    const colors = new Map<string, string>([['document', DOCUMENT_COLOR]]);
    const define = (data: readonly IfcxNode[], source: string) => {
      for (const n of data) {
        const own = Object.keys(n.attributes ?? {}).length > 0 || Object.keys(n.inherits ?? {}).length > 0;
        (own ? strong : weak).set(n.path, source);
      }
    };
    for (const l of this.stack()) {
      colors.set(l.id, l.color);
      const file = this.ctx.state.files.get(l.uri);
      if (!l.enabled || !file) continue;
      define(file.data, l.id);
      if (l.editsEnabled && l.edits.length) define(editsFile(l).data, l.id);
    }
    // the document only adds children to the linked nodes that contain placements: they still belong to their layer
    const foreign = this.ctx.state.current instanceof ForeignSession;
    const stubs = new Set(
      this.ctx.state.current?.doc.composer.placements.filter((p) => foreign || p.parentLayerUri !== undefined).map((p) => p.parentId),
    );
    define((this.ctx.state.base?.layer?.file.data ?? []).filter((n) => !stubs.has(n.path)), 'document');
    const sourceOf = new Map(weak);
    for (const [path, source] of strong) sourceOf.set(path, source);
    return { root: this.ctx.state.shown?.result.root ?? null, sourceOf, colors, marks: this.marks() };
  }

  /** Stage name of the node with that origin (null if it is not in the composition). */
  private nodeName(origin: string): string | null {
    const n = this.ctx.state.shown?.result.byOrigin.get(origin)?.[0];
    return n ? displayName(n) : null;
  }

  /** Edit marks of the layers whose edits are in the composition, merged by origin. */
  private marks(): Map<string, EditMark[]> {
    const out = new Map<string, EditMark[]>();
    for (const l of this.stack()) {
      const file = this.ctx.state.files.get(l.uri);
      if (!l.enabled || !l.editsEnabled || !l.edits.length || !file) continue;
      for (const [origin, ms] of marksOf(l.edits, file)) {
        const prev = out.get(origin) ?? [];
        out.set(origin, [...prev, ...ms.filter((m) => !prev.includes(m))]);
      }
    }
    return out;
  }

  pushLayers(): void {
    const ws = this.ctx.d.ws;
    if (!ws.setComposer) return;
    const base = this.ctx.state.base;
    if (!this.ctx.state.open || !base) {
      return ws.setComposer(null, { root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() });
    }
    const docPath = this.docPath();
    const s = this.ctx.state.current;
    ws.setComposer([
      ...this.ctx.state.layers.map((l): StackRow => {
        const placed = s?.placementOf(l.uri);
        const file = this.ctx.state.files.get(l.uri);
        return {
          kind: 'file',
          id: l.id,
          name: l.name,
          path: resolveUri(docPath, l.uri),
          color: l.color,
          enabled: l.enabled,
          missing: !file,
          editCount: l.edits.length,
          editsEnabled: l.editsEnabled,
          // without the file there is nothing to compare against: they are not marked as orphans
          orphans: file && l.edits.length ? orphans(l.edits, file) : [],
          ...(placed ? { placedIn: placed.parentId, placedInName: this.nodeName(placed.parentId) } : {}),
        };
      }),
      { kind: 'document', name: s?.name ?? base.name, path: docPath, ...(s ? { targets: placeTargets(s) } : {}) },
    ], this.stageData());
  }

  /** Recomposes and shows the model without rebuilding the document; restores the * and the panel. */
  async recompose(): Promise<void> {
    const base = this.ctx.state.base;
    if (!base) return;
    const gen = this.ctx.state.generation;
    try {
      const model = await this.compose(base);
      if (gen === this.ctx.state.generation) {
        this.ctx.state.shown = model;
        this.ctx.d.ws.updateModel(model);
      }
    } catch (e) {
      this.ctx.d.toast(`Could not update the layers: ${errorMessage(e)}`, 'error');
    }
    if (gen !== this.ctx.state.generation) return;
    this.ctx.d.ws.setDirty(this.ctx.state.current?.dirty ?? false);
    this.pushLayers();
  }

  /**
   * Queues a stack change. `apply` returns null if the layer does not exist (false), false if there is
   * nothing to change (true without touching anything) or true if it changed: then it is saved in the editable
   * document (with *) and recomposed.
   */
  stackChange(label: string, apply: () => Promise<boolean | null> | boolean | null): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      if (gen !== this.ctx.state.generation) return false;
      const placed = this.ctx.state.current?.doc.composer.placements.length ?? 0;
      const before = this.ctx.history.snapshot(label);
      const r = await apply();
      if (gen !== this.ctx.state.generation || r === null) return false;
      if (!r) return true;
      const s = this.ctx.state.current;
      if (s) {
        this.writeMeta(s);
        s.dirty = true;
      }
      this.ctx.history.commit(before);
      // The placement containers are document data (the name and roots of its layer):
      // if there is or was any, the document is rebuilt, not only the composition.
      if (s && (placed || s.doc.composer.placements.length)) await this.refresh(s, true);
      else await this.recompose();
      return true;
    });
  }

  layer(id: string): ComposerLayer | undefined {
    return this.ctx.state.layers.find((l) => l.id === id);
  }

  /** Layer where the edits of its elements are written: a linked one or the base of a foreign file. */
  edited(id: string): ComposerLayer | undefined {
    return this.layer(id) ?? (this.ctx.state.baseLayer?.id === id ? this.ctx.state.baseLayer : undefined);
  }

  /**
   * Are the layer edits turned off? Then its elements are not edited (warns): what is
   * seen is the file without them, and writing over that would overwrite or duplicate the hidden edits.
   */
  editsOff(l: ComposerLayer): boolean {
    if (l.editsEnabled) return false;
    this.ctx.d.toast(`Turn on "Edits · ${l.name}" to edit this element`, 'info');
    return true;
  }

  /** Rebuilds the session model and passes it to the workspace (if it is still open). */
  async refresh(s: EditSession, dirty: boolean): Promise<LoadedModel | null> {
    let model: LoadedModel | null = null;
    try {
      model = await this.build(s);
      if (this.ctx.state.current === s) {
        this.ctx.state.shown = model;
        this.ctx.d.ws.updateModel(model);
        this.pushLayers(); // a Save As changes the name of the document layer
      }
    } catch (e) {
      this.ctx.d.toast(`Could not update the model: ${errorMessage(e)}`, 'error');
    }
    if (this.ctx.state.current === s) this.ctx.d.ws.setDirty(dirty);
    return model;
  }
}
