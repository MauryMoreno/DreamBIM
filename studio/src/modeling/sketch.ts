// Pure geometry of a floor sketch (Floor › Create Floor Boundary): wall faces, corners of
// Pick Walls y cierre del contorno. Sin DOM.
import { JOIN_TOLERANCE } from './constants';
import { polygonArea, type Vec2, type WallAxis } from './footprint';

export interface SketchLine {
  id: string;
  a: Vec2;
  b: Vec2;
  source: 'pick' | 'line' | 'rect';
  /** Only with `source: 'pick'`: the wall it comes from and its thickness. */
  wallId?: string;
  thickness?: number;
}

export type LoopResult = { ok: true; polygon: Vec2[] } | { ok: false; open: string[] };

/** Minimum area of a boundary (m²). */
const MIN_AREA = 1e-6;
const EPS = 1e-9;

const sub = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const cross = (u: Vec2, v: Vec2) => u[0] * v[1] - u[1] * v[0];
const dot = (u: Vec2, v: Vec2) => u[0] * v[0] + u[1] * v[1];
const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Distance from `p` to the segment `a`–`b`, and its position `t` (0..1) along it. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number } {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 < EPS ? 0 : Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  return { d: dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]), t };
}

/** The wall whose rectangle (axis ± thickness/2) contains `p`; with several, the one with the nearest axis. */
export function wallAt(walls: WallAxis[], p: Vec2): WallAxis | null {
  let best: WallAxis | null = null;
  let bestD = Infinity;
  for (const w of walls) {
    const { d } = toSegment(p, w.start, w.end);
    if (d <= w.thickness / 2 + JOIN_TOLERANCE && d < bestD) {
      best = w;
      bestD = d;
    }
  }
  return best;
}

/** The axis of the wall offset thickness/2 towards the side of `p`; it measures the same as the axis. */
export function wallFace(w: WallAxis, p: Vec2): [Vec2, Vec2] {
  const d = sub(w.end, w.start);
  const len = Math.hypot(d[0], d[1]);
  const side = cross(d, sub(p, w.start)) >= 0 ? 1 : -1; // izquierda del sentido del eje: +n
  const h = (w.thickness / 2) * side;
  const n: Vec2 = [(-d[1] / len) * h, (d[0] / len) * h];
  return [[w.start[0] + n[0], w.start[1] + n[1]], [w.end[0] + n[0], w.end[1] + n[1]]];
}

/** Intersection of the lines of two lines; null if they are parallel. */
function intersect(l: SketchLine, m: SketchLine): Vec2 | null {
  const r = sub(l.b, l.a);
  const s = sub(m.b, m.a);
  const den = cross(r, s);
  if (Math.abs(den) < EPS * Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1])) return null;
  const t = cross(sub(m.a, l.a), s) / den;
  return [l.a[0] + r[0] * t, l.a[1] + r[1] * t];
}

/** Moves to `x` the end of `l` nearest to it. */
function moveNearestEnd(l: SketchLine, x: Vec2): SketchLine {
  return dist(l.a, x) <= dist(l.b, x) ? { ...l, a: x } : { ...l, b: x };
}

const nearestEndDist = (l: SketchLine, x: Vec2) => Math.min(dist(l.a, x), dist(l.b, x));

/**
 * Adds `added` and, like Revit with Pick Walls, trims or extends to their intersection the ends of
 * the chosen lines that do not touch or that overshoot. Only if the intersection is close:
 * within 2 × the thickness of the thicker of the two walls. It returns a new copy.
 */
export function joinPicked(lines: SketchLine[], added: SketchLine): SketchLine[] {
  const out = [...lines];
  let mine = added;
  if (added.source === 'pick') {
    for (let i = 0; i < out.length; i++) {
      const other = out[i];
      if (other.source !== 'pick') continue;
      const x = intersect(mine, other);
      if (!x) continue;
      const limit = 2 * Math.max(mine.thickness ?? 0, other.thickness ?? 0);
      if (nearestEndDist(mine, x) > limit || nearestEndDist(other, x) > limit) continue;
      mine = moveNearestEnd(mine, x);
      out[i] = moveNearestEnd(other, x);
    }
  }
  out.push(mine);
  return out;
}

/** The 4 sides of a rectangle aligned with X/Y; null if the width or the height is smaller than JOIN_TOLERANCE. */
export function rectangle(c1: Vec2, c2: Vec2): [Vec2, Vec2][] | null {
  if (Math.abs(c2[0] - c1[0]) < JOIN_TOLERANCE || Math.abs(c2[1] - c1[1]) < JOIN_TOLERANCE) return null;
  const p1: Vec2 = [c1[0], c1[1]];
  const p2: Vec2 = [c2[0], c1[1]];
  const p3: Vec2 = [c2[0], c2[1]];
  const p4: Vec2 = [c1[0], c2[1]];
  return [[p1, p2], [p2, p3], [p3, p4], [p4, p1]];
}

/** The line nearest to `p` if it is at `tol` or less; otherwise, null. */
export function nearestLine(lines: readonly SketchLine[], p: Vec2, tol: number): string | null {
  let best: string | null = null;
  let bestD = tol;
  for (const l of lines) {
    const { d } = toSegment(p, l.a, l.b);
    if (d <= bestD) {
      best = l.id;
      bestD = d;
    }
  }
  return best;
}

/** Do the segments pq and rs cross (or touch)? */
function segmentsMeet(p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean {
  const o = (a: Vec2, b: Vec2, c: Vec2) => {
    const v = cross(sub(b, a), sub(c, a));
    return Math.abs(v) < EPS ? 0 : Math.sign(v);
  };
  const onSeg = (a: Vec2, b: Vec2, c: Vec2) => toSegment(c, a, b).d < JOIN_TOLERANCE;
  const o1 = o(p, q, r), o2 = o(p, q, s), o3 = o(r, s, p), o4 = o(r, s, q);
  if (o1 !== o2 && o3 !== o4) return true;
  return onSeg(p, q, r) || onSeg(p, q, s) || onSeg(r, s, p) || onSeg(r, s, q);
}

/**
 * Converts the lines into a single closed, simple polygon, counterclockwise and without collinear vertices.
 * If it cannot, `open` lists the lines with a loose end (or all of them, if the failure is another one).
 */
export function closeLoop(lines: readonly SketchLine[]): LoopResult {
  const all = lines.map((l) => l.id);
  if (!lines.length) return { ok: false, open: [] };

  // vertices: the ends within JOIN_TOLERANCE are the same
  const verts: Vec2[] = [];
  const vertOf = (p: Vec2): number => {
    let i = verts.findIndex((v) => dist(v, p) <= JOIN_TOLERANCE);
    if (i < 0) i = verts.push([p[0], p[1]]) - 1;
    return i;
  };
  const edges = lines.map((l) => ({ id: l.id, u: vertOf(l.a), v: vertOf(l.b) }));
  if (edges.some((e) => e.u === e.v)) return { ok: false, open: all };

  const degree = new Array<number>(verts.length).fill(0);
  for (const e of edges) {
    degree[e.u]++;
    degree[e.v]++;
  }
  const loose = edges.filter((e) => degree[e.u] !== 2 || degree[e.v] !== 2).map((e) => e.id);
  if (loose.length) return { ok: false, open: loose };

  // a single cycle that uses all the lines
  const order: number[] = [edges[0].u];
  let at = edges[0].v;
  const used = new Set<number>([0]);
  while (at !== order[0]) {
    order.push(at);
    const k = edges.findIndex((e, i) => !used.has(i) && (e.u === at || e.v === at));
    if (k < 0) return { ok: false, open: all };
    used.add(k);
    at = edges[k].u === at ? edges[k].v : edges[k].u;
  }
  if (used.size !== edges.length) return { ok: false, open: all };

  // sin cruces entre lados no contiguos
  const n = order.length;
  const pts = order.map((i) => verts[i]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // contiguos por el cierre
      if (segmentsMeet(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return { ok: false, open: all };
    }
  }

  // without collinear vertices
  const polygon = pts.filter((p, i) => {
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    const a = sub(p, prev);
    const b = sub(next, p);
    return Math.abs(cross(a, b)) > 1e-9 * Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]);
  });
  if (polygon.length < 3) return { ok: false, open: all };

  const area = polygonArea(polygon);
  if (Math.abs(area) < MIN_AREA) return { ok: false, open: all };
  return { ok: true, polygon: area > 0 ? polygon : polygon.reverse() };
}
