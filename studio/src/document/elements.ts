import type { ComposedNode } from '../ifcx/types';
import { editPath } from '../composer/edits';
import { nextColor } from '../composer/stack';
import { fileName } from '../model/open';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { stairOf } from '../modeling/document';
import { applyBuild, type BuildCounts, type BuildRequest } from '../modeling/build';
import { applyPlace, summarizePlace, type PlaceRequest } from '../modeling/place';
import { applyStairs, summarizeStairs, type StairRequest } from '../modeling/stairplace';
import { newSession, type FloorPatch, type WallPatch } from '../modeling/session';
import type { DocumentContext } from './context';
import type { PlaceResult, StairPlaceResult } from './types';

export class ElementsService {
  constructor(private readonly ctx: DocumentContext) {}

  /** Edit paths of those composed paths; null if any is not in the shown model. */
  editPaths(composedPaths: string[]): string[] | null {
    const result = this.ctx.state.shown?.result;
    if (!result?.byPath) return null;
    const out: string[] = [];
    for (const p of composedPaths) {
      const n = result.byPath.get(p);
      if (!n) return null;
      out.push(editPath(n, result));
    }
    return out;
  }

  setFloorConstraints(id: string, patch: FloorPatch): Promise<boolean> {
    return this.ctx.mutations.editChecked('Change Floor', (s) => s.setFloorConstraints(id, patch));
  }

  /** Creates a level; resolves to its id once the model is already recomposed (null without an editable session). */
  addLevel(): Promise<string | null> {
    const s = this.ctx.mutations.studioSession();
    if (!s) return Promise.resolve(null);
    if (this.ctx.lock.userLocked()) return Promise.resolve(null);
    return this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) return null;
      const before = this.ctx.history.snapshot('Add Level');
      const level = s.addLevel();
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, s.dirty);
      return level.id;
    });
  }

  /**
   * Builds levels, walls and floors from an Assistant request as a single undo step and
   * a single recomposition. With `fresh` it first opens a new document (the caller already checked that
   * there are no unsaved changes). It rejects without touching the document if the request does not fit.
   */
  buildModel(req: BuildRequest): Promise<BuildCounts> {
    if (this.ctx.lock.userLocked()) return Promise.reject(new Error('Editing is locked'));
    return this.ctx.queue.enqueue(async () => {
      if (req.fresh) {
        // it is validated on a new test document: if the request fails, the open one stays the same
        const probe = newSession();
        const counts = applyBuild(probe.doc, req);
        this.ctx.lifecycle.resetStack();
        const s = newSession();
        const empty = await this.ctx.stack.build(s);
        this.ctx.lifecycle.show(empty, s);
        this.ctx.d.ws.showPlan();
        // the undo step returns to the new empty document with its «Level 1»
        const before = this.ctx.history.snapshot('Assistant: Build Model');
        s.doc = probe.doc;
        s.dirty = true;
        this.ctx.history.commit(before);
        await this.ctx.stack.refresh(s, true);
        return counts;
      }

      const s = this.ctx.mutations.studioSession();
      if (!s) throw new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open');
      const next = structuredClone(s.doc);
      const counts = applyBuild(next, req);
      const before = this.ctx.history.snapshot('Assistant: Build Model');
      s.doc = next;
      s.dirty = true;
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, true);
      return counts;
    });
  }

  /**
   * Places library pieces (doors and windows in walls, furniture on levels) in a single step.
   * With `dryRun` it validates and summarizes without touching anything (no history, no layers). `WallPiece.wall` are ids of the
   * document; the files that were not layers yet are read here and linked with the placement.
   */
  placeAssets(req: PlaceRequest, dryRun: boolean): Promise<PlaceResult> {
    if (!dryRun && this.ctx.lock.userLocked()) return Promise.reject(new Error('Editing is locked'));
    return this.ctx.queue.enqueue(async () => {
      const s = this.ctx.mutations.studioSession();
      if (!s) throw new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open');
      const cmd = req.kind === 'wall' ? 'place_in_wall' : 'place_furniture';

      // 1) read (without warnings) each file that is not a layer yet and gather its measurements
      const { assets, nuevos } = await this.ctx.placement.assetRefs(req.items.map((i) => i.asset), cmd);
      if (this.ctx.state.current !== s) throw new Error('The open model changed before the change could be applied');

      // 2) apply to a copy: if something does not fit, the open document does not change
      const next = structuredClone(s.doc);
      const ids = applyPlace(next, req, assets);
      const summary = summarizePlace(req, assets);
      if (dryRun) return { summary, ids: [] };

      // 3) a single step: new layers, document and recomposition
      const before = this.ctx.history.snapshot(`Assistant: Place (${req.items.length})`);
      for (const n of nuevos) {
        this.ctx.state.files.set(n.uri, n.file);
        this.ctx.state.layers = [...this.ctx.state.layers, {
          id: this.ctx.stack.newLayerId(), uri: n.uri, name: fileName(n.asset), color: nextColor(this.ctx.state.layers),
          enabled: true, editsEnabled: true, edits: [],
        }];
      }
      s.doc = next;
      s.dirty = true;
      this.ctx.stack.writeMeta(s);
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, true);
      return { summary, ids };
    });
  }

  /**
   * Places the requested stairs in a single step. With `dryRun` it validates and summarizes without touching anything (no
   * history or document). Each stair is checked again against the previous ones.
   */
  placeStairs(req: StairRequest, dryRun: boolean): Promise<StairPlaceResult> {
    if (!dryRun && this.ctx.lock.userLocked()) return Promise.reject(new Error('Editing is locked'));
    return this.ctx.queue.enqueue(async () => {
      const s = this.ctx.mutations.studioSession();
      if (!s) throw new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open');
      const next = structuredClone(s.doc);
      const ids = applyStairs(next, req);
      const summary = summarizeStairs(next, ids);
      if (dryRun) return { summary, ids: [] };

      const before = this.ctx.history.snapshot(`Assistant: Place Stairs (${req.items.length})`);
      s.doc = next;
      s.dirty = true;
      this.ctx.stack.writeMeta(s);
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, true);
      return { summary, ids };
    });
  }

  /**
   * Id that deletes or edits each composed path: the container of the placement that holds it (it or
   * an ancestor), or its edit path. null if any is not in the model.
   */
  elementIds(composedPaths: string[]): string[] | null {
    const s = this.ctx.state.current;
    const result = this.ctx.state.shown?.result;
    if (!s || !result) return null;
    const placements = new Set(s.doc.composer.placements.map((p) => p.id));
    const out: string[] = [];
    for (const path of composedPaths) {
      const n = result.byPath.get(path);
      if (!n) return null;
      let found: string | null = null;
      for (let a: ComposedNode | null = n; a; a = a.parent) {
        if (placements.has(a.origin)) {
          found = a.origin;
          break;
        }
      }
      out.push(found ?? editPath(n, result));
    }
    return out;
  }

  /**
   * Deletes walls, floors and placed pieces by id in a single step; it rejects if any is not one. A wall
   * takes its hosted pieces with it; a layer left without any placement stops being linked.
   */
  removeElements(ids: string[], label: string): Promise<number> {
    if (this.ctx.lock.userLocked()) return Promise.reject(new Error('Editing is locked'));
    const s = this.ctx.mutations.studioSession();
    if (!s) return Promise.reject(new Error(this.ctx.state.open ? NOT_EDITABLE : 'No model is open'));
    return this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) throw new Error('The open model changed before the change could be applied');
      const next = structuredClone(s.doc);
      const wanted = new Set(ids);
      const wallIds = new Set(next.walls.map((w) => w.id));
      const floorIds = new Set(next.floors.map((f) => f.id));
      const placementIds = new Set(next.composer.placements.map((p) => p.id));
      const stairs = new Set([...wanted].flatMap((id) => (stairOf(next, id) ? [stairOf(next, id)!.id] : [])));
      for (const id of wanted) {
        if (!wallIds.has(id) && !floorIds.has(id) && !placementIds.has(id) && !stairs.has(id) && !stairOf(next, id)) {
          throw new Error(`delete_elements: '${id}' is not a wall, floor, stair or placed piece of the model`);
        }
      }
      const walls = new Set([...wanted].filter((id) => wallIds.has(id)));
      // the hosted pieces of a wall go with it (they do not count as requested if nobody named them)
      const pieces = new Set([...wanted].filter((id) => placementIds.has(id)));
      for (const p of next.composer.placements) if (p.host && walls.has(p.parentId)) pieces.add(p.id);
      const removed =
        [...wanted].filter((id) => wallIds.has(id) || floorIds.has(id) || placementIds.has(id)).length + stairs.size;
      if (!removed) return 0;

      const placedBefore = new Set(s.doc.composer.placements.map((p) => p.layerUri));
      next.walls = next.walls.filter((w) => !walls.has(w.id));
      next.floors = next.floors.filter((f) => !wanted.has(f.id));
      next.stairs = next.stairs.filter((s) => !stairs.has(s.id));
      next.composer.placements = next.composer.placements.filter((p) => !pieces.has(p.id));
      const placedAfter = new Set(next.composer.placements.map((p) => p.layerUri));
      const doomed = this.ctx.state.layers.filter((l) => placedBefore.has(l.uri) && !placedAfter.has(l.uri));

      const before = this.ctx.history.snapshot(label);
      if (doomed.length) {
        const gone = new Set(doomed.map((l) => l.id));
        this.ctx.state.layers = this.ctx.state.layers.filter((l) => !gone.has(l.id));
        for (const l of doomed) this.ctx.state.files.delete(l.uri);
      }
      s.doc = next;
      s.dirty = true;
      this.ctx.stack.writeMeta(s);
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, true);
      return removed;
    });
  }

  renameLevel(id: string, name: string): Promise<boolean> {
    return this.ctx.mutations.editChecked('Rename Level', (s) => s.renameLevel(id, name));
  }

  setLevelElevation(id: string, elevation: number): Promise<boolean> {
    return this.ctx.mutations.editChecked('Change Level Elevation', (s) => s.setLevelElevation(id, elevation));
  }

  setWallConstraints(id: string, patch: WallPatch): Promise<boolean> {
    return this.ctx.mutations.editChecked('Change Wall', (s) => s.setWallConstraints(id, patch));
  }
}
