// Host real: une el ejecutor de comandos con el espacio de trabajo, el controlador del documento y el
// disk. What each piece already knows how to do is delegated; here it is only translated and the rules of the
// agente (por ejemplo, no abrir otro modelo encima de cambios sin guardar).
import type { CardInfo } from '../../collection/cardinfo';
import type { MaterialDef } from '../../materials/state';
import type { ElementColor } from '../../render/coloroverride';
import type { BuildCounts, BuildRequest } from '../../modeling/build';
import type { PlaceRequest, WallPiece } from '../../modeling/place';
import type { PlaceResult, StairPlaceResult } from '../../document/controller';
import type { Review, ReviewOptions } from '../../modeling/egress';
import type { Plan, PlanReview } from '../../modeling/planreview';
import type { SpotResult } from '../../modeling/stairspots';
import type { StairRequest } from '../../modeling/stairplace';
import type { StairShape } from '../../modeling/stairlayout';
import type { ModelSnapshot, StudioHost, WorkspaceAgentApi } from './host';

export interface LiveHostDeps {
  ws: WorkspaceAgentApi;
  doc: {
    readonly hasDocument: boolean;
    isDirty(): boolean;
    editable(): ModelSnapshot['editable'];
    /** Waits for what the user left queued to finish (a pending edit dirties the document). */
    idle(): Promise<void>;
  };
  /** What the controller offers to edit on behalf of the Assistant. */
  edit: {
    /** Corre `fn` atravesando el bloqueo del usuario durante el turno. */
    asAgent<T>(fn: () => T): T;
    /** Edit paths of composed paths; null if any is not in the model. */
    editPaths(composed: string[]): string[] | null;
    setColors(editPaths: string[], c: ElementColor | null, label: string): Promise<boolean>;
    assignMaterial(editPaths: string[], code: string | null, label: string): Promise<boolean>;
    setMaterial(code: string | null, def: MaterialDef): Promise<boolean>;
    /** Construye el edificio en un solo paso (con `fresh`, sobre un documento nuevo). */
    buildModel(req: BuildRequest): Promise<BuildCounts>;
    /** Places pieces of the library; with `dryRun` it only validates and summarizes. */
    placeAssets(req: PlaceRequest, dryRun: boolean): Promise<PlaceResult>;
    /** Valid sites for a stair; the controller resolves them over the Studio session. */
    stairSpots(q: { from: string; to: string; shape: StairShape; width: number; limit: number }): SpotResult;
    /** Coloca escaleras; con `dryRun` solo valida y resume. */
    placeStairs(req: StairRequest, dryRun: boolean): Promise<StairPlaceResult>;
    /** The id that each composed path deletes or edits; null if any is not in the model. */
    elementIds(composed: string[]): string[] | null;
    /** Borra muros, suelos y piezas por su id, en un solo paso. */
    removeElements(ids: string[], label: string): Promise<number>;
    /** Revisa un plan entero sobre un documento de trabajo (no toca el abierto). */
    reviewPlan(plan: Plan): Promise<PlanReview>;
    /** Revisa el modelo de Studio abierto. */
    reviewModel(opts: ReviewOptions): Review;
  };
  /** Opens the file as the user would with Open; it rejects if it could not be done. */
  openPath(path: string): Promise<void>;
  searchLibrary(query: string, limit: number): Promise<{ path: string; name: string; mtime: number }[]>;
  cardInfo(path: string, mtime: number): Promise<CardInfo | null>;
  scale(dataUrl: string, width: number, height: number, maxSize: number): Promise<{ dataUrl: string; width: number; height: number }>;
}

/** Size of a PNG reading its IHDR header (without decoding it); null if it is not a readable PNG. */
export function pngSize(dataUrl: string): { width: number; height: number } | null {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  let bytes: string;
  try {
    bytes = atob(m[1].slice(0, 44)); // 33 bytes: la firma, el trozo IHDR y su ancho y alto
  } catch {
    return null;
  }
  if (bytes.length < 24 || bytes.charCodeAt(1) !== 0x50) return null;
  const u32 = (i: number) =>
    ((bytes.charCodeAt(i) << 24) | (bytes.charCodeAt(i + 1) << 16) | (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

export function createLiveHost(d: LiveHostDeps): StudioHost {
  /** Date of each card of the last search: the Collection stores its data by path and date. */
  const mtimes = new Map<string, number>();

  /** Before writing: there is an editable model and what the user left queued has finished. */
  const writable = async (): Promise<void> => {
    if (!d.doc.hasDocument) throw new Error('No model is open');
    await d.doc.idle();
    if (d.doc.editable() === 'readonly') throw new Error('The model is read-only');
  };
  const editPathsOf = (paths: string[]): string[] =>
    d.edit.editPaths(paths) ?? (() => { throw new Error('Some paths are not in the open model'); })();
  /** Before touching the open document: there is a model, what was queued has finished and it is a Studio one. */
  const studioOnly = async (): Promise<void> => {
    if (!d.doc.hasDocument) throw new Error('No model is open');
    await d.doc.idle();
    if (d.doc.editable() !== 'studio') {
      throw new Error('This model was not made in Dream BIM: build a new model instead (new: true)');
    }
  };
  const applied = (ok: boolean): void => {
    if (!ok) throw new Error('Dream BIM could not apply the change; the user has been shown why');
  };

  return {
    model() {
      if (!d.doc.hasDocument) return null;
      const m = d.ws.model();
      return m ? { name: m.name, path: m.path, dirty: d.doc.isDirty(), editable: d.doc.editable(), root: m.root } : null;
    },
    levels: () => d.ws.levels(),
    selection: () => d.ws.selection(),
    select: (path) => d.ws.select(path),
    selectMany: (paths) => d.ws.selectMany(paths),
    provenance: (path) => d.ws.provenance(path),
    highlight: (paths, c) => d.ws.highlight(paths, c),
    clearHighlight: (paths) => d.ws.clearHighlight(paths),
    materials: () => d.ws.materials(),
    openView: (v) => d.ws.openView(v),
    fit: (path) => d.ws.fit(path),
    setToggle: (name, on) => d.ws.setToggle(name, on),
    layers: () => d.ws.layers(),
    setLayerHidden: (id, hidden) => d.ws.setLayerHidden(id, hidden),
    async screenshot(maxSize) {
      const url = d.ws.screenshot();
      const size = url ? pngSize(url) : null;
      if (!url || !size) return null;
      if (Math.max(size.width, size.height) <= maxSize) return { dataUrl: url, ...size };
      return d.scale(url, size.width, size.height, maxSize);
    },
    libraryFolder: () => d.ws.libraryFolder(),
    async searchLibrary(query, limit) {
      const found = await d.searchLibrary(query, limit);
      for (const f of found) mtimes.set(f.path, f.mtime);
      return found.map(({ path, name }) => ({ path, name }));
    },
    async cardInfo(path) {
      const mtime = mtimes.get(path);
      return mtime === undefined ? null : d.cardInfo(path, mtime);
    },
    async setColor(paths, c) {
      await writable();
      const ep = editPathsOf(paths);
      const label = c ? `Assistant: Set Color (${paths.length})` : `Assistant: Clear Color (${paths.length})`;
      applied(await d.edit.asAgent(() => d.edit.setColors(ep, c, label)));
    },
    async assignMaterial(paths, code) {
      await writable();
      const ep = editPathsOf(paths);
      applied(await d.edit.asAgent(() => d.edit.assignMaterial(ep, code, `Assistant: Assign Material (${paths.length})`)));
    },
    async createMaterial(def) {
      await writable();
      applied(await d.edit.asAgent(() => d.edit.setMaterial(null, def)));
    },
    async buildModel(req) {
      if (req.fresh) {
        // sustituye el modelo abierto: sin elegir por el usuario, se niega con cambios sin guardar
        if (d.doc.hasDocument) await d.doc.idle();
        if (d.doc.hasDocument && d.doc.isDirty()) {
          throw new Error('The open model has unsaved changes: ask the user to save or discard them first');
        }
      } else await studioOnly();
      return d.edit.asAgent(() => d.edit.buildModel(req));
    },
    async placePieces(req, dryRun) {
      await studioOnly();
      let translated = req;
      if (req.kind === 'wall') {
        const walled = req.items.filter((i): i is Extract<WallPiece, { wall: string }> => 'wall' in i);
        const ids = walled.length ? d.edit.elementIds(walled.map((i) => i.wall)) : [];
        if (!ids) throw new Error('Some paths are not in the open model');
        let k = 0;
        translated = {
          kind: 'wall',
          items: req.items.map((it) => ('wall' in it ? { ...it, wall: ids[k++] } : it)),
        };
      }
      if (dryRun) return d.edit.placeAssets(translated, true);
      return d.edit.asAgent(() => d.edit.placeAssets(translated, false));
    },
    stairSpots(q) {
      // synchronous read: the same Studio model rules, without waiting for the queue
      if (!d.doc.hasDocument) throw new Error('No model is open');
      if (d.doc.editable() !== 'studio') {
        throw new Error('This model was not made in Dream BIM: build a new model instead (new: true)');
      }
      return d.edit.stairSpots(q);
    },
    async placeStairs(req, dryRun) {
      await studioOnly();
      if (dryRun) return d.edit.placeStairs(req, true);
      return d.edit.asAgent(() => d.edit.placeStairs(req, false));
    },
    async deleteElements(paths) {
      await studioOnly();
      const ids = d.edit.elementIds(paths);
      if (!ids) throw new Error('Some paths are not in the open model');
      return d.edit.asAgent(() => d.edit.removeElements(ids, `Assistant: Delete Elements (${paths.length})`));
    },
    async reviewPlan(plan) {
      await d.doc.idle();
      return d.edit.reviewPlan(plan);
    },
    async reviewModel(opts) {
      await studioOnly();
      return d.edit.reviewModel(opts);
    },
    async openModel(path) {
      if (!path.toLowerCase().endsWith('.ifcx')) throw new Error("open_model: 'path' must be an .ifcx file");
      // No dialog: the agent cannot decide for the user whether changes are discarded. It waits for what is
      // queued before looking: otherwise, a pending edit could dirty the document right after
      // and open the discard dialog.
      if (d.doc.hasDocument) await d.doc.idle();
      if (d.doc.hasDocument && d.doc.isDirty()) {
        throw new Error('The open model has unsaved changes: ask the user to save or discard them first');
      }
      await d.openPath(path);
    },
  };
}
