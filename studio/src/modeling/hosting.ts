// Pure geometry of pieces hosted in a wall: frame of the wall, validation that they fit and their openings.
import type { Vec2, WallAxis } from './footprint';

/** Una puerta o ventana dentro de un muro: distancia sobre el eje, antepecho, ancho y alto. */
export interface WallHost {
  /** Distancia del inicio del muro al centro de la pieza, en metros. */
  along: number;
  /** Altura de la base de la pieza sobre la base del muro, en metros. */
  sill: number;
  width: number;
  height: number;
}

/** Hueco de un muro en el mundo: centro en planta, giro en grados y rango de cotas. */
export interface WallHole {
  center: Vec2;
  angle: number;
  width: number;
  z0: number;
  z1: number;
}

/** Minimum margin between the end of a wall and the edge of a hosted piece. */
export const OPENING_MARGIN = 0.1;

const EPS = 1e-9;

/** Number formatted as in the messages: rounded to the millimeter and without padding zeros. */
const num = (v: number): string => String(+v.toFixed(3));

export function wallLength(w: WallAxis): number {
  return Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
}

/** Direction of the axis in degrees, in (-180, 180]. */
export function wallAngle(w: WallAxis): number {
  const dx = w.end[0] - w.start[0];
  const dy = w.end[1] - w.start[1];
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return 0;
  const r = ((((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 360) + 360) % 360 - 180;
  const v = r === -180 ? 180 : r;
  return Math.abs(v) < EPS ? 0 : v;
}

/** Punto del eje a `along` metros del inicio. */
export function hostedOrigin(w: WallAxis, along: number): Vec2 {
  const length = wallLength(w);
  if (length < EPS) return [w.start[0], w.start[1]];
  const dx = (w.end[0] - w.start[0]) / length;
  const dy = (w.end[1] - w.start[1]) / length;
  return [w.start[0] + dx * along, w.start[1] + dy * along];
}

/** Do two intervals overlap (touching edge to edge does not count)? */
const overlap = (a0: number, a1: number, b0: number, b1: number): boolean => Math.min(a1, b1) - Math.max(a0, b0) > EPS;

/**
 * null if the piece fits in the wall; otherwise the reason in English (without command prefix). `others` are
 * the other hosted pieces of the same wall.
 */
export function checkHost(length: number, height: number, h: WallHost, others: WallHost[]): string | null {
  if (!(h.width > 0)) return 'the piece width must be greater than 0';
  if (!(h.height > 0)) return 'the piece height must be greater than 0';
  if (h.sill < -EPS) return "'sill' must be 0 or more";
  if (h.height > height + EPS) {
    return `the piece (${num(h.height)} m) is taller than the wall (${num(height)} m)`;
  }
  if (length - 2 * OPENING_MARGIN < h.width - EPS) {
    return `the wall (${num(length)} m) is too short for a ${num(h.width)} m wide piece`;
  }
  const min = OPENING_MARGIN + h.width / 2;
  const max = length - OPENING_MARGIN - h.width / 2;
  if (h.along < min - EPS || h.along > max + EPS) {
    return `does not fit: 'offset' must be between ${num(min)} and ${num(max)} on this ${num(length)} m wall`;
  }
  if (h.sill + h.height > height + EPS) {
    return `too tall: 'sill' can be at most ${num(height - h.height)} on this ${num(height)} m high wall`;
  }
  for (const o of others) {
    const samePlan = overlap(h.along - h.width / 2, h.along + h.width / 2, o.along - o.width / 2, o.along + o.width / 2);
    const sameHeight = overlap(h.sill, h.sill + h.height, o.sill, o.sill + o.height);
    if (samePlan && sameHeight) return 'overlaps another piece in the same wall';
  }
  return null;
}

/** Openings of the wall in the world, clipped to [baseZ, baseZ + height]; those left without height are dropped. */
export function wallHoles(w: WallAxis, baseZ: number, height: number, hosts: WallHost[]): WallHole[] {
  const top = baseZ + height;
  const angle = wallAngle(w);
  const out: WallHole[] = [];
  for (const h of hosts) {
    const z0 = Math.max(baseZ, baseZ + h.sill);
    const z1 = Math.min(top, baseZ + h.sill + h.height);
    if (!(z1 > z0)) continue;
    out.push({ center: hostedOrigin(w, h.along), angle, width: h.width, z0, z1 });
  }
  return out;
}
