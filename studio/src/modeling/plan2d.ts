// Minimal 2D geometry for stairs: oriented rectangles, overlap of convex shapes and containment.
import type { Vec2 } from './footprint';

/** Rectangle in local coordinates, with x0 < x1 and y0 < y1. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const EPS = 1e-9;
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** Vertices of the rectangle in the world, counterclockwise, rotated `angleDeg` around `origin`. */
export function rectPolygon(r: Rect, origin: Vec2, angleDeg: number): Vec2[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts: Vec2[] = [
    [r.x0, r.y0],
    [r.x1, r.y0],
    [r.x1, r.y1],
    [r.x0, r.y1],
  ];
  return pts.map(([x, y]): Vec2 => [origin[0] + x * c - y * s, origin[1] + x * s + y * c]);
}

/** Do two convex shapes overlap? Touching (penetration <= `tol`) does not count as overlap. */
export function convexOverlap(a: Vec2[], b: Vec2[], tol = 0.001): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const axes = (poly: Vec2[]): Vec2[] =>
    poly.flatMap((p, i): Vec2[] => {
      const q = poly[(i + 1) % poly.length];
      const d = sub(q, p);
      const len = Math.hypot(d[0], d[1]);
      return len < EPS ? [] : [[-d[1] / len, d[0] / len]];
    });
  for (const axis of [...axes(a), ...axes(b)]) {
    const proj = (poly: Vec2[]) => {
      const values = poly.map((p) => p[0] * axis[0] + p[1] * axis[1]);
      return [Math.min(...values), Math.max(...values)] as const;
    };
    const [a0, a1] = proj(a);
    const [b0, b1] = proj(b);
    if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
  }
  return true;
}

const onSegment = (p: Vec2, a: Vec2, b: Vec2): boolean => {
  const ab = sub(b, a);
  const ap = sub(p, a);
  if (Math.abs(cross(ab, ap)) > 1e-9) return false;
  const dot = ap[0] * ab[0] + ap[1] * ab[1];
  return dot >= -EPS && dot <= ab[0] * ab[0] + ab[1] * ab[1] + EPS;
};

/** Is `p` inside the polygon? The edge counts as inside. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  for (let i = 0; i < poly.length; i++) {
    if (onSegment(p, poly[i], poly[(i + 1) % poly.length])) return true;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Do two segments cross in their interior (not counting ends or collinear stretches)? */
function properCross(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const d1 = cross(sub(q2, q1), sub(p1, q1));
  const d2 = cross(sub(q2, q1), sub(p2, q1));
  const d3 = cross(sub(p2, p1), sub(q1, p1));
  const d4 = cross(sub(p2, p1), sub(q2, p1));
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/** Is `inner` entirely inside `outer` and does none of its sides cross a side of `outer`? */
export function polygonContains(outer: Vec2[], inner: Vec2[]): boolean {
  if (outer.length < 3 || inner.length < 3) return false;
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j++) {
      if (properCross(a, b, outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
}
