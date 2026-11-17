import type { ComposedNode } from '../ifcx/types';
import { normDeg, worldOrigin, worldRotScale, type Vec3 } from '../composer/xform';
import type { StudioProps } from '../properties/studio';
import { floorTopZ, levelById, stairOf, wallBaseZ, type Placement } from '../modeling/document';
import { hostedOrigin, wallAngle } from '../modeling/hosting';
import type { Vec2 } from '../modeling/footprint';
import type { EditSession } from '../modeling/session';

/**
 * What moves with the Move box: an element of the document itself (wall, floor or level, by its
 * Studio id) or an element of a linked file (its layer id, edit path and composed node).
 */
export type MoveTarget =
  | { branch: 'document'; origin: string }
  | { branch: string /* layer id */; path: string /* editPath */; node: ComposedNode };

export type LinkedTarget = Extract<MoveTarget, { node: ComposedNode }>;

export type Axes = { x: boolean; y: boolean; z: boolean };

/**
 * What allowedAxes and targetPosition consult from the document. `placement`: the placement of a
 * linked file by its container id (without it, containers do not move).
 */
export type MoveStudio = Pick<StudioProps, 'levels' | 'wall' | 'floor' | 'stair'> & {
  placement?(id: string): Placement | undefined;
  /**
   * World point on which the container offset is added: the origin of the linked node
   * it hangs from. Without this (or for a document parent), the elevation of its level.
   */
  placementBase?(p: Placement): Vec3 | null;
};

/** Elevation of the level that a container hanging from a document element follows (see placementBaseZ). */
export function docBaseZ(studio: MoveStudio, p: Placement): number {
  const levels = studio.levels();
  const levelId = levelById(levels, p.parentId)?.id ?? studio.wall(p.parentId)?.baseLevelId ?? studio.floor(p.parentId)?.levelId;
  return (levelId && levelById(levels, levelId)?.elevation) || 0;
}

export const isLinked = (t: MoveTarget): t is LinkedTarget => 'node' in t;

/**
 * Axes on which it can move: document wall/floor x,y (Z is governed by level and offsets);
 * level z (its Elevation); linked element and container of a placed file x,y,z. The rest of the
 * document does not move.
 */
export function allowedAxes(target: MoveTarget, studio: MoveStudio): Axes {
  if (isLinked(target)) return { x: true, y: true, z: true };
  const id = target.origin;
  if (studio.placement?.(id)) return { x: true, y: true, z: true };
  if (studio.wall(id) || studio.floor(id) || studio.stair?.(id)) return { x: true, y: true, z: false };
  if (levelById(studio.levels(), id)) return { x: false, y: false, z: true };
  return { x: false, y: false, z: false };
}

/**
 * Position shown by the Move box. Linked: the element local origin in the world. Own
 * document elements (without xformop): wall, its start point at the elevation of its base; floor, its first vertex
 * at the elevation of its top face; level, its Elevation; container of a placed file, its
 * offset over the elevation of its level (the transformation written to it on save).
 */
export function targetPosition(target: MoveTarget, studio: MoveStudio): Vec3 {
  if (isLinked(target)) return worldOrigin(target.node);
  const levels = studio.levels();
  const p = studio.placement?.(target.origin);
  if (p) {
    // a hosted piece is on the axis of its wall, at the wall elevation plus its sill
    const wall = p.host ? studio.wall(p.parentId) : undefined;
    if (p.host && wall) {
      const [x, y] = hostedOrigin(wall, p.host.along);
      return [x, y, wallBaseZ(levels, wall) + p.host.sill];
    }
    const base = studio.placementBase?.(p) ?? [0, 0, p.parentLayerUri === undefined ? docBaseZ(studio, p) : 0];
    return [base[0] + p.offset[0], base[1] + p.offset[1], base[2] + p.offset[2]];
  }
  const w = studio.wall(target.origin);
  if (w) return [w.start[0], w.start[1], wallBaseZ(levels, w)];
  const f = studio.floor(target.origin);
  if (f) return [f.boundary[0][0], f.boundary[0][1], floorTopZ(levels, f)];
  const stair = studio.stair?.(target.origin);
  if (stair) {
    const base = levelById(levels, stair.baseLevelId);
    return [stair.origin[0], stair.origin[1], base ? base.elevation : 0];
  }
  const level = levelById(levels, target.origin);
  return [0, 0, level ? level.elevation : 0];
}

export const NONE: Axes = { x: false, y: false, z: false };

export const ALL: Axes = { x: true, y: true, z: true };

/** Direction in plan, in degrees, from `a` to `b`. */
export const planAngle = (a: Vec2, b: Vec2): number => normDeg((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);

/**
 * Axes on which it can rotate and scale: linked ones and containers of placed files, all;
 * document walls and floors only rotate in Z (in plan) and are not scaled; the rest, none.
 */
export function rotScaleAxes(target: MoveTarget, studio: MoveStudio): { rot: Axes; scale: Axes } {
  if (isLinked(target)) return { rot: ALL, scale: ALL };
  const p = studio.placement?.(target.origin);
  // a hosted piece rotates with its wall: it has no rotation or scale of its own
  if (p?.host) return { rot: NONE, scale: NONE };
  if (p) return { rot: ALL, scale: ALL };
  if (studio.wall(target.origin) || studio.floor(target.origin)) return { rot: { x: false, y: false, z: true }, scale: NONE };
  if (studio.stair?.(target.origin)) return { rot: NONE, scale: NONE };
  return { rot: NONE, scale: NONE };
}

/**
 * Rotation (degrees) and scale shown by the box. Linked: those of the element in the world; container:
 * its own ones; wall: the direction of its axis in Z; floor: that of its first side.
 */
export function targetRotScale(target: MoveTarget, studio: MoveStudio): { rot: Vec3; scale: Vec3 } {
  if (isLinked(target)) return worldRotScale(target.node);
  const one: Vec3 = [1, 1, 1];
  const p = studio.placement?.(target.origin);
  if (p) {
    if (p.host) {
      const wall = studio.wall(p.parentId);
      return { rot: [0, 0, wall ? wallAngle(wall) : 0], scale: one };
    }
    return { rot: [...(p.rotation ?? [0, 0, 0])], scale: [...(p.scale ?? one)] };
  }
  const w = studio.wall(target.origin);
  if (w) return { rot: [0, 0, planAngle(w.start, w.end)], scale: one };
  const stair = studio.stair?.(target.origin);
  if (stair) return { rot: [0, 0, stair.angle], scale: one };
  const f = studio.floor(target.origin);
  if (f && f.boundary.length > 1) return { rot: [0, 0, planAngle(f.boundary[0], f.boundary[1])], scale: one };
  return { rot: [0, 0, 0], scale: one };
}

/** `next` on the allowed axes; on the others, `now`. */
export const pick = (next: Vec3, now: Vec3, a: Axes): Vec3 => [a.x ? next[0] : now[0], a.y ? next[1] : now[1], a.z ? next[2] : now[2]];

/** The offset only on the allowed axes. */
export const masked = (d: Vec3, a: Axes): Vec3 => [a.x ? d[0] : 0, a.y ? d[1] : 0, a.z ? d[2] : 0];

export const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const studioOf = (s: EditSession, placementBase?: (p: Placement) => Vec3 | null): MoveStudio => ({
  levels: () => s.doc.levels,
  wall: (id) => s.doc.walls.find((w) => w.id === id),
  floor: (id) => s.doc.floors.find((f) => f.id === id),
  stair: (id) => stairOf(s.doc, id),
  placement: (id) => s.doc.composer.placements.find((p) => p.id === id),
  placementBase,
});
