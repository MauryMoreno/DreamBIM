// Search for valid sites for a stair: stacked candidates and ones next to walls, already filtered.
import { FLOOR_THICKNESS } from './constants';
import { levelById, type StudioDoc } from './document';
import type { Vec2 } from './footprint';
import { wallFootprints } from './footprint';
import { convexOverlap, polygonContains, rectPolygon } from './plan2d';
import { checkStair, placeStair } from './staircheck';
import { stairLayout, type StairShape, type StairTurn } from './stairlayout';

export interface SpotQuery {
  baseLevelId: string;
  topLevelId: string;
  shape: StairShape;
  width: number;
}

export interface StairSpot {
  origin: Vec2;
  angle: number;
  turn?: StairTurn;
  stacked: boolean;
  /** Lados de tramo con pasamanos de pared. */
  walls: number;
  /** Largo y fondo de la huella en el marco local de la escalera. */
  length: number;
  depth: number;
}

export interface SpotResult {
  spots: StairSpot[];
  risers: number;
  riser: number;
  reason?: string;
}

/** Normalizes an angle to [0, 360). */
const norm = (deg: number): number => {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
};

/** Center of the plan of the level, to sort by nearness to a corner. */
function planCorners(doc: StudioDoc, levelId: string): Vec2[] {
  const pts: Vec2[] = doc.floors.filter((f) => f.levelId === levelId).flatMap((f) => f.boundary);
  if (!pts.length) {
    for (const w of doc.walls.filter((x) => x.baseLevelId === levelId)) pts.push(w.start, w.end);
  }
  if (!pts.length) return [[0, 0]];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Most repeated reason in a list of rejections. */
function mostFrequent(reasons: string[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  let max = 0;
  for (const r of reasons) {
    const n = (counts.get(r) ?? 0) + 1;
    counts.set(r, n);
    if (n > max) {
      max = n;
      best = r;
    }
  }
  return best;
}

/**
 * Sites that already pass all the rules, sorted: first the stacked ones, then those with the most
 * walls (handrails) and finally those nearest to a corner of the plan.
 */
export function findStairSpots(doc: StudioDoc, q: SpotQuery, limit = 10): SpotResult {
  const base = levelById(doc.levels, q.baseLevelId);
  const top = levelById(doc.levels, q.topLevelId);
  if (!base || !top) return { spots: [], risers: 0, riser: 0, reason: 'both levels must exist' };
  const rise = top.elevation - base.elevation;
  let layout;
  try {
    layout = stairLayout(rise, q.shape, q.width, FLOOR_THICKNESS);
  } catch (e) {
    return { spots: [], risers: 0, riser: 0, reason: e instanceof Error ? e.message : String(e) };
  }

  const baseFloors = doc.floors.filter((f) => f.levelId === base.id);
  const topFloors = doc.floors.filter((f) => f.levelId === top.id);
  const baseWalls = [...wallFootprints(doc.walls.filter((w) => w.baseLevelId === base.id)).values()];
  const topWalls = [...wallFootprints(doc.walls.filter((w) => w.baseLevelId === top.id)).values()];
  const corners = planCorners(doc, base.id);

  /** Filtro barato de las reglas 2-5 antes de validar la candidata entera. Devuelve el motivo si no pasa. */
  const plausible = (origin: Vec2, angle: number, turn: StairTurn | undefined): string | null => {
    let l;
    try {
      l = stairLayout(rise, q.shape, q.width, FLOOR_THICKNESS, turn);
    } catch {
      return 'the stair does not fit in this storey';
    }
    const fp = rectPolygon(l.footprint, origin, angle);
    const bottom = rectPolygon(l.bottomClear, origin, angle);
    const topClear = rectPolygon(l.topClear, origin, angle);
    const opening = rectPolygon(l.opening, origin, angle);
    if (!baseFloors.some((f) => polygonContains(f.boundary, fp) && polygonContains(f.boundary, bottom))) {
      return `the stair and its landing space at the bottom must stand on a floor of ${base.name}`;
    }
    if (!topFloors.some((f) => polygonContains(f.boundary, topClear) && polygonContains(f.boundary, opening))) {
      return `the arrival space and the opening must be inside a floor of ${top.name}`;
    }
    if (baseWalls.some((w) => convexOverlap(w, fp))) return 'the stair runs into a wall';
    if (baseWalls.some((w) => convexOverlap(w, bottom))) return `the bottom of the stair faces a wall: it needs ${Math.max(q.width, 1.1)} m of clear floor`;
    if (topWalls.some((w) => convexOverlap(w, topClear))) return `the stair arrives against a wall: it needs ${Math.max(q.width, 1.1)} m of clear floor`;
    if (topWalls.some((w) => convexOverlap(w, opening))) return `the floor opening would cut a wall of ${top.name}`;
    return null;
  };

  const accepted: StairSpot[] = [];
  const reasons: string[] = [];
  const seen: { origin: Vec2; angle: number }[] = [];

  const trySpot = (origin: Vec2, angle: number, turn: StairTurn | undefined, stacked: boolean): void => {
    if (seen.some((s) => Math.hypot(s.origin[0] - origin[0], s.origin[1] - origin[1]) < 0.5 && Math.abs(s.angle - angle) < 1e-6)) return;
    const why = plausible(origin, angle, turn);
    if (why) {
      reasons.push(why);
      return;
    }
    const params = {
      id: 'spot', baseLevelId: base.id, topLevelId: top.id, shape: q.shape,
      origin: [origin[0], origin[1]] as Vec2, angle, width: q.width, ...(turn ? { turn } : {}),
    };
    const reason = checkStair(doc, params);
    if (reason) {
      reasons.push(reason);
      return;
    }
    const placed = placeStair(doc, params);
    seen.push({ origin, angle });
    accepted.push({
      origin: [origin[0], origin[1]],
      angle,
      ...(turn ? { turn } : {}),
      stacked,
      walls: placed.rails.filter((r) => r.where === 'flight' && r.kind === 'handrail').length,
      length: l1(layout.footprint.x1 - layout.footprint.x0),
      depth: l1(layout.footprint.y1 - layout.footprint.y0),
    });
  };

  // (a) apilada sobre otra escalera del nivel de abajo
  for (const below of doc.stairs) {
    if (below.topLevelId !== base.id || below.shape !== q.shape) continue;
    if (Math.abs(below.width - q.width) > 1e-9) continue;
    trySpot(below.origin, below.angle, below.turn, true);
  }

  // (b) next to each face of each wall, in both directions (and in U with both turns)
  for (const wall of doc.walls.filter((w) => w.baseLevelId === base.id)) {
    const dx = wall.end[0] - wall.start[0];
    const dy = wall.end[1] - wall.start[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const d: Vec2 = [dx / len, dy / len];
    const n: Vec2 = [-d[1], d[0]];
    for (const face of [1, -1]) {
      for (const dir of [1, -1]) {
        const angle = norm((Math.atan2(dir * d[1], dir * d[0]) * 180) / Math.PI);
        const turns: (StairTurn | undefined)[] = q.shape === 'u' ? ['left', 'right'] : [undefined];
        for (let u = 0; u <= len + 1e-9; u += 0.25) {
          const origin: Vec2 = [
            wall.start[0] + d[0] * u + n[0] * face * (wall.thickness / 2 + q.width / 2),
            wall.start[1] + d[1] * u + n[1] * face * (wall.thickness / 2 + q.width / 2),
          ];
          for (const turn of turns) trySpot(origin, angle, turn, false);
        }
      }
    }
  }

  accepted.sort((a, b) => {
    if (a.stacked !== b.stacked) return a.stacked ? -1 : 1;
    if (a.walls !== b.walls) return b.walls - a.walls;
    const corner = (s: StairSpot) => Math.min(...corners.map((c) => Math.hypot(s.origin[0] - c[0], s.origin[1] - c[1])));
    return corner(a) - corner(b);
  });

  const result: SpotResult = { spots: accepted.slice(0, Math.max(0, limit)), risers: layout.risers, riser: layout.riser };
  if (!accepted.length) {
    const reason = mostFrequent(reasons);
    if (reason) result.reason = reason;
  }
  return result;
}

/** Rounding to the millimeter of the measurements of the footprint. */
const l1 = (v: number): number => Math.round(v * 1000) / 1000;
