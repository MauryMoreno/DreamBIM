import type { Vec2 } from './footprint';

/**
 * Chain-closing snap: if the click falls within <= thresholdPx of the screen projection
 * of the first point of the chain, it returns an EXACT copy of that point; otherwise, the point.
 * `project` lleva un punto del plano a coordenadas de cliente (null si no es proyectable).
 */
export function snapToChainStart(
  point: Vec2,
  chainStart: Vec2 | null,
  project: (p: Vec2) => { x: number; y: number } | null,
  clientXY: { x: number; y: number },
  thresholdPx = 8,
): Vec2 {
  if (!chainStart) return point;
  const s = project(chainStart);
  if (!s) return point;
  return Math.hypot(s.x - clientXY.x, s.y - clientXY.y) <= thresholdPx ? [chainStart[0], chainStart[1]] : point;
}

/** Tolerance of the automatic orthogonal snap (degrees with respect to an axis of the project). */
export const ORTHO_TOLERANCE_DEG = 3;

export type OrthoAxis = 'x' | 'y';

/**
 * Orthogonal snap of the end of a wall: projects `point` onto the X or Y axis of the project that
 * passes through `start` if the direction is within <= toleranceDeg of it. With `force` (Shift) it always chooses the
 * nearest axis. A null segment has no direction: it is not snapped.
 */
export function snapOrtho(
  start: Vec2,
  point: Vec2,
  force: boolean,
  toleranceDeg = ORTHO_TOLERANCE_DEG,
): { point: Vec2; axis: OrthoAxis | null } {
  const dx = point[0] - start[0];
  const dy = point[1] - start[1];
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.hypot(dx, dy) < 1e-6) return { point, axis: null };
  const axis: OrthoAxis = ax >= ay ? 'x' : 'y';
  const deviationDeg = (Math.atan2(Math.min(ax, ay), Math.max(ax, ay)) * 180) / Math.PI;
  if (!force && deviationDeg > toleranceDeg) return { point, axis: null };
  return { point: axis === 'x' ? [point[0], start[1]] : [start[0], point[1]], axis };
}

/**
 * Punto final del muro: el cierre de cadena (copia exacta del inicio) tiene prioridad; si no ajusta,
 * the orthogonal snap is applied. `chainStart` is null if there is no chain to close.
 */
export function snapWallEnd(
  point: Vec2,
  start: Vec2,
  chainStart: Vec2 | null,
  project: (p: Vec2) => { x: number; y: number } | null,
  clientXY: { x: number; y: number },
  shift: boolean,
): { point: Vec2; axis: OrthoAxis | null } {
  const closed = snapToChainStart(point, chainStart, project, clientXY);
  if (closed !== point) return { point: closed, axis: null };
  return snapOrtho(start, point, shift);
}

/** Ángulo del segmento en grados, en [0, 360), desde +X en sentido antihorario. */
export function wallAngleDeg(start: Vec2, end: Vec2): number {
  const deg = (Math.atan2(end[1] - start[1], end[0] - start[0]) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg;
}
