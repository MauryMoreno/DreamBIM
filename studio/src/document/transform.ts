import { flatten } from '../ifcx/compose';
import { clearAttr, editPath, freeName, insideOwnOrigin, K_XFORM, movePrefix, reparent, setXform } from '../composer/edits';
import type { ReparentAt } from '../composer/stagepanel';
import { localTransformFor, localTransformWith, normDeg, reparentTransform, sameLocal, worldOrigin, worldRotScale, type Vec3 } from '../composer/xform';
import { levelById } from '../modeling/document';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { MoveTarget, LinkedTarget, MoveStudio, isLinked, allowedAxes, targetPosition, ALL, rotScaleAxes, targetRotScale, pick, masked, minus, studioOf } from './move-target';

export class TransformService {
  constructor(private readonly ctx: DocumentContext) {}

  /** Moves the element `delta` in the world; disallowed axes are ignored. true if it was applied. */
  moveBy(target: MoveTarget, delta: Vec3): Promise<boolean> {
    return this.move(target, () => delta);
  }

  /** Moves the element origin to `pos` (delta = pos - current position, at the moment it is applied). */
  moveTo(target: MoveTarget, pos: Vec3): Promise<boolean> {
    return this.move(target, (current) => minus(pos, current));
  }

  /**
   * Moves with the offset that `deltaFrom` gives from the current position. Only in editable documents:
   * own elements change their data (walls and floors their points, levels their elevation,
   * the container of a placed file its offset); linked ones write their xformop in the
   * edit layer of their file.
   */
  private move(target: MoveTarget, deltaFrom: (current: Vec3) => Vec3): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    if (isLinked(target)) return this.moveLinked(s, target, deltaFrom);
    const id = target.origin;
    const axes = allowedAxes(target, studioOf(s, this.ctx.placement.placementBase));
    if (!axes.x && !axes.y && !axes.z) return Promise.resolve(false);
    return this.ctx.mutations.editChecked('Move', (es) => {
      const studio = studioOf(es, this.ctx.placement.placementBase);
      const d = masked(deltaFrom(targetPosition(target, studio)), allowedAxes(target, studio));
      if (studio.placement?.(id)) return es.movePlacement(id, d);
      if (studio.wall(id)) return es.moveWall(id, d[0], d[1]);
      if (studio.floor(id)) return es.moveFloor(id, d[0], d[1]);
      if (studio.stair?.(id)) return es.moveStair(id, d[0], d[1]);
      const level = levelById(es.doc.levels, id);
      if (!level) return { ok: false, error: 'unknown' };
      return es.setLevelElevation(id, level.elevation + d[2]);
    });
  }

  /**
   * Linked element: its new xformop (compensating to its parents) goes to the edit layer of its
   * file; with that edit layer turned off it does not move (warns). It is computed when applied, on the
   * last composed model, so that two consecutive moves add up.
   */
  private moveLinked(s: EditSession, target: LinkedTarget, deltaFrom: (current: Vec3) => Vec3): Promise<boolean> {
    return this.ctx.stack.stackChange('Move', () => {
      const l = this.ctx.stack.edited(target.branch);
      if (!l || this.ctx.state.current !== s || this.ctx.stack.editsOff(l)) return null;
      const node = this.ctx.state.shown?.result.byPath.get(target.node.path) ?? target.node;
      const d = deltaFrom(worldOrigin(node));
      if (d.every((v) => v === 0)) return false;
      l.edits = setXform(l.edits, target.path, localTransformFor(node, d));
      return true;
    });
  }

  /** Leaves the element with that rotation (degrees, Euler XYZ); disallowed axes do not change. true if it was applied. */
  rotateTo(target: MoveTarget, rot: Vec3): Promise<boolean> {
    return this.rotScale('Rotate', target, { rot });
  }

  /** Leaves the element with that per-axis scale (distinct from 0); disallowed axes do not change. */
  scaleTo(target: MoveTarget, scale: Vec3): Promise<boolean> {
    if (scale.some((v) => !Number.isFinite(v) || v === 0)) return Promise.resolve(false);
    return this.rotScale('Scale', target, { scale });
  }

  /**
   * Like `move`: own elements change their data (wall, the direction of its axis; floor, its
   * rotated boundary; container, its rotation and scale) and linked ones write their xformop, which rotates and
   * scales around their origin, in the edit layer of their file.
   */
  private rotScale(label: string, target: MoveTarget, want: { rot?: Vec3; scale?: Vec3 }): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    const axesOf = (studio: MoveStudio) => rotScaleAxes(target, studio);
    if (isLinked(target)) {
      return this.ctx.stack.stackChange(label, () => {
        const l = this.ctx.stack.edited(target.branch);
        if (!l || this.ctx.state.current !== s || this.ctx.stack.editsOff(l)) return null;
        const node = this.ctx.state.shown?.result.byPath.get(target.node.path) ?? target.node;
        const now = worldRotScale(node);
        const rot = want.rot && pick(want.rot, now.rot, ALL);
        const scale = want.scale && pick(want.scale, now.scale, ALL);
        const m = localTransformWith(node, { rot, scale });
        if (sameLocal(node.attributes, m)) return false;
        l.edits = setXform(l.edits, target.path, m);
        return true;
      });
    }
    const id = target.origin;
    const { rot: ra, scale: sa } = axesOf(studioOf(s, this.ctx.placement.placementBase));
    if (want.rot ? !(ra.x || ra.y || ra.z) : !(sa.x || sa.y || sa.z)) return Promise.resolve(false);
    return this.ctx.mutations.editChecked(label, (es) => {
      const studio = studioOf(es, this.ctx.placement.placementBase);
      const axes = axesOf(studio);
      const now = targetRotScale(target, studio);
      if (studio.placement?.(id)) {
        return es.setPlacementRotScale(id, {
          ...(want.rot ? { rotation: pick(want.rot, now.rot, axes.rot) } : {}),
          ...(want.scale ? { scale: pick(want.scale, now.scale, axes.scale) } : {}),
        });
      }
      if (!want.rot) return { ok: false, error: 'unknown' };
      if (studio.wall(id)) return es.rotateWall(id, want.rot[2]);
      if (studio.floor(id)) return es.rotateFloor(id, normDeg(want.rot[2] - now.rot[2]));
      return { ok: false, error: 'unknown' };
    });
  }

  /**
   * Reparents an element of a linked file, inside that file: the old parent
   * releases it and the new one adds it (with -2, -3… if the name already exists), in the edit layer of `layerId`,
   * and its xformop is compensated so it does not move in the world. `at` gives the paths of the composed tree
   * of the dragged instance and of the new parent (a reused element has several); without `at`, the
   * first instance of each origin. false without an editable document, if the layer or the nodes do not exist
   * or if the destination is the node itself, one of its descendants or its current parent; also with the edit
   * layer turned off (warns).
   */
  reparent(layerId: string, origin: string, newParentOrigin: string, at?: ReparentAt): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Relocate', () => {
      const l = this.ctx.stack.edited(layerId);
      const result = this.ctx.state.shown?.result;
      if (!l || this.ctx.state.current !== s || !result?.byOrigin || this.ctx.stack.editsOff(l)) return null;
      const find = (o: string, path?: string) => {
        const n = path !== undefined ? result.byPath.get(path) : result.byOrigin.get(o)?.[0];
        return n && n.origin === o ? n : null;
      };
      const node = find(origin, at?.node);
      const to = find(newParentOrigin, at?.parent);
      const from = node?.parent;
      // the composed root is not a data node: its children are not reparented nor added to it
      if (!node || !to || !from?.parent || !to.parent || from === to) return null;
      // nor inside itself: nor inside another instance of the same origin (that would be a cycle)
      if (insideOwnOrigin(node, to)) return null;

      const taken = new Set(to.children.map((c) => c.name));
      const name = freeName(node.name, taken);
      const fromPath = editPath(from, result);
      const toPath = editPath(to, result);
      const reused = (result.byOrigin.get(origin)?.length ?? 0) > 1;
      let edits = reparent(l.edits, { origin, name: node.name }, fromPath, toPath, taken);
      // reused: its edits are per instance, and the instance comes to hang from the new parent
      const path = reused ? `${toPath}/${name}` : origin;
      if (reused) edits = movePrefix(edits, `${fromPath}/${node.name}`, path);
      // if the compensation leaves the file transform, the position edit is unnecessary
      const m = reparentTransform(node, to);
      const file = this.ctx.state.files.get(l.uri);
      const base = file ? flatten([file]).get(origin)?.attributes ?? {} : {};
      edits = sameLocal(base, m) ? clearAttr(edits, path, K_XFORM) : setXform(edits, path, m);
      l.edits = edits;
      return true;
    });
  }
}
