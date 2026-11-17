import { JOIN_TOLERANCE } from './constants';

export type Vec2 = [number, number];

export interface WallAxis {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
}

const EPS = 1e-9;
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};

/** Signed area of the polygon: positive if it is counterclockwise (CCW). */
export function polygonArea(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/**
 * Desplazamientos `s` (a lo largo de `a`) de las caras izquierda (+n) y derecha (-n)
 * en un extremo P. Con inglete se corta por la bisectriz; si no, perpendicular (s = 0).
 */
function endOffsets(a: Vec2, n: Vec2, half: number, thickness: number, other?: Vec2): { left: number; right: number } {
  if (!other) return { left: 0, right: 0 };
  const sum: Vec2 = [a[0] + other[0], a[1] + other[1]];
  if (Math.hypot(sum[0], sum[1]) < EPS) return { left: 0, right: 0 };
  const bis = norm(sum);
  const den = cross(a, bis);
  if (Math.abs(den) < EPS) return { left: 0, right: 0 };
  // cross(sign·n·half + s·a, bis) = 0
  const left = (-half * cross(n, bis)) / den;
  const right = (half * cross(n, bis)) / den;
  const limit = 2 * thickness;
  if (Math.abs(left) > limit || Math.abs(right) > limit) return { left: 0, right: 0 };
  return { left, right };
}

/**
 * Footprint (4 CCW vertices) of each wall, with miters at the joints of exactly
 * two walls. With zero or three or more walls at a point, the end is square.
 */
export function wallFootprints(walls: WallAxis[]): Map<string, Vec2[]> {
  const out = new Map<string, Vec2[]>();
  const near = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= JOIN_TOLERANCE;

  /** Unit direction (from P) of the only other wall joined at P, or undefined. */
  const partnerDir = (self: WallAxis, p: Vec2): Vec2 | undefined => {
    const found: Vec2[] = [];
    for (const w of walls) {
      if (w === self) continue;
      for (const [e, o] of [[w.start, w.end], [w.end, w.start]] as [Vec2, Vec2][]) {
        if (near(p, e)) {
          const dx = o[0] - e[0];
          const dy = o[1] - e[1];
          if (Math.hypot(dx, dy) > EPS) found.push(norm([dx, dy]));
        }
      }
    }
    return found.length === 1 ? found[0] : undefined;
  };

  for (const w of walls) {
    const dx = w.end[0] - w.start[0];
    const dy = w.end[1] - w.start[1];
    if (Math.hypot(dx, dy) < EPS) continue;
    const d = norm([dx, dy]);
    const n: Vec2 = [-d[1], d[0]];
    const h = w.thickness / 2;

    const s0 = endOffsets(d, n, h, w.thickness, partnerDir(w, w.start));
    const negD: Vec2 = [-d[0], -d[1]];
    const s1 = endOffsets(negD, n, h, w.thickness, partnerDir(w, w.end));

    const pt = (base: Vec2, side: number, a: Vec2, s: number): Vec2 => [
      base[0] + side * n[0] * h + s * a[0],
      base[1] + side * n[1] * h + s * a[1],
    ];
    let poly: Vec2[] = [
      pt(w.start, -1, d, s0.right),
      pt(w.end, -1, negD, s1.right),
      pt(w.end, 1, negD, s1.left),
      pt(w.start, 1, d, s0.left),
    ];
    if (polygonArea(poly) < 0) poly = poly.reverse();
    out.set(w.id, poly);
  }
  return out;
}
