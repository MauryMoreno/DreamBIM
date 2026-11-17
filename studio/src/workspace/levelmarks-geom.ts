// Geometry of the level marks in 3D and picking with the cursor. Pure (no three.js, no DOM).
import type { LevelInfo } from '../render/levels';

/** `selected`: only the selected level, as a plane. */
export type LevelsStyle = 'off' | 'outline' | 'plane' | 'selected';

/** Margin of each mark around the model footprint, per side (m). */
export const LEVEL_MARGIN = 2;
/** Side of the mark when the model is empty (m), centered on the origin. */
const EMPTY_SIZE = 10;
/** Distance between the level head and the rectangle corner (m). */
const HEAD_GAP = 1;

export interface LevelMark {
  path: string;
  label: string;
  z: number;
  /** Rectangle corners, counterclockwise, at elevation `z`. */
  corners: [number, number][];
  /** Where the head goes: outside the minimum corner, towards −X. */
  head: [number, number];
}

export interface Footprint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Project = (x: number, y: number, z: number) => { x: number; y: number } | null;
type Pt = { x: number; y: number };

export function levelMarks(levels: LevelInfo[], footprint: Footprint | null): LevelMark[] {
  const h = EMPTY_SIZE / 2;
  const f = footprint
    ? {
        minX: footprint.minX - LEVEL_MARGIN,
        minY: footprint.minY - LEVEL_MARGIN,
        maxX: footprint.maxX + LEVEL_MARGIN,
        maxY: footprint.maxY + LEVEL_MARGIN,
      }
    : { minX: -h, minY: -h, maxX: h, maxY: h };
  return levels.map((l) => ({
    path: l.path,
    label: `${l.name} ${l.minZ.toFixed(3)}`,
    z: l.minZ,
    corners: [[f.minX, f.minY], [f.maxX, f.minY], [f.maxX, f.maxY], [f.minX, f.maxY]],
    head: [f.minX - HEAD_GAP, f.minY],
  }));
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Level with a (projected) side within <= tolerancePx of the cursor; the nearest one if there are several. */
export function pickLevelEdge(marks: LevelMark[], project: Project, client: Pt, tolerancePx = 6): string | null {
  let best: { path: string; d: number } | null = null;
  for (const m of marks) {
    const pts = m.corners.map(([x, y]) => project(x, y, m.z));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b) continue;
      const d = distToSegment(client, a, b);
      if (d <= tolerancePx && (!best || d < best.d)) best = { path: m.path, d };
    }
  }
  return best?.path ?? null;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Level whose (projected) plane contains the cursor; with several, the highest elevation. */
export function pickLevelPlane(marks: LevelMark[], project: Project, client: Pt): string | null {
  let best: LevelMark | null = null;
  for (const m of marks) {
    const pts = m.corners.map(([x, y]) => project(x, y, m.z));
    if (pts.some((p) => !p)) continue;
    if (inside(client, pts as Pt[]) && (!best || m.z > best.z)) best = m;
  }
  return best?.path ?? null;
}

const STORAGE_KEY = 'ifcx-studio.levels-style';
export const isLevelsStyle = (v: unknown): v is LevelsStyle =>
  v === 'off' || v === 'outline' || v === 'plane' || v === 'selected';

/** Saved style; missing, invalid or with localStorage inaccessible it is "selected". */
export function loadLevelsStyle(): LevelsStyle {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLevelsStyle(v) ? v : 'selected';
  } catch {
    return 'selected';
  }
}

export function saveLevelsStyle(s: LevelsStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, s);
  } catch {
    /* no storage: the style only lasts this session */
  }
}
