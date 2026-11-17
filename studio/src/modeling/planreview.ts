// El plan completo de un edificio como objeto: se lee, se aplica a un documento de trabajo y se
// revisa entero (muros, suelos, puertas y escaleras) antes de construir nada.
import { STAIR_WIDTH } from './constants';
import { newDocument, type StairParams, type StudioDoc } from './document';
import type { Vec2 } from './footprint';
import { pointInPolygon } from './plan2d';
import type { BuildRequest } from './build';
import { parseBuildRequest, applyBuild } from './build';
import { applyPlace, parsePlaceInWall, type AssetRef, type PlaceRequest } from './place';
import { applyStairs, type StairItem } from './stairplace';
import { doorSides, placeStair } from './staircheck';
import { findStairSpots } from './stairspots';
import type { StairShape } from './stairlayout';
import { reviewDoc, roomProbe, type Review, type ReviewLimits, type ReviewOptions } from './egress';

export interface PlanStair {
  from: string;
  to: string;
  shape: StairShape;
  width: number;
}

export interface Plan {
  lot: { width: number; depth: number; setback: number };
  apartments: Record<string, number>;
  build: BuildRequest;
  /** stableKey of the `build` as it arrived (the one the gate compares with `build_model`). */
  buildKey: string;
  doors: Extract<PlaceRequest, { kind: 'wall' }> | null;
  stairs: PlanStair[];
  limits: Partial<ReviewLimits>;
}

export interface PlanReview {
  review: Review;
  stairs: StairItem[];
  buildKey: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const shapeOf = (v: unknown): v is StairShape => v === 'straight' || v === 'u';
const nameKey = (s: string): string => s.trim().toLowerCase();

function bad(message: string): never {
  throw new Error(`review_plan: ${message}`);
}

/** Un error del comando original, con el prefijo de este. */
function rethrow(fn: () => never): never;
function rethrow<T>(fn: () => T): T;
function rethrow<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    throw new Error(`review_plan: ${text.replace(/^\w+: /, '')}`);
  }
}

/** JSON with the keys of all the objects sorted: two equal values give the same string. */
export function stableKey(v: unknown): string {
  const stable = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(stable);
    if (isObj(x)) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(x).sort()) {
        if (x[k] !== undefined) out[k] = stable(x[k]);
      }
      return out;
    }
    return x;
  };
  return JSON.stringify(stable(v));
}

/** Lee el plan entero; lanza Error con el prefijo `review_plan: `. */
export function parsePlan(args: unknown): Plan {
  if (!isObj(args)) bad('args must be an object');

  if (!isObj(args.lot)) bad("'lot' needs width and depth in meters");
  const width = args.lot.width;
  const depth = args.lot.depth;
  if (!isNum(width) || width <= 0 || !isNum(depth) || depth <= 0) bad("'lot' needs width and depth in meters");
  const setback = args.lot.setback === undefined ? 0 : args.lot.setback;
  if (!isNum(setback) || setback < 0) bad("'lot.setback' must be 0 or more");

  if (args.build === undefined) bad("'build' is required");
  const build = rethrow(() => parseBuildRequest(args.build));
  const buildKey = stableKey(args.build);

  const apartments: Record<string, number> = {};
  if (args.apartments !== undefined) {
    if (!isObj(args.apartments)) bad("'apartments' must be an object {level name: count}");
    for (const [name, value] of Object.entries(args.apartments)) {
      if (!isStr(name)) bad("'apartments' needs level names");
      if (!isNum(value) || !Number.isInteger(value) || value < 0) {
        bad(`'apartments.${name}' must be a whole number of apartments`);
      }
      apartments[name] = value;
    }
  }

  let doors: Plan['doors'] = null;
  if (args.doors !== undefined && !(Array.isArray(args.doors) && args.doors.length === 0)) {
    if (!Array.isArray(args.doors)) bad("'doors' must be an array");
    (args.doors as unknown[]).forEach((raw, i) => {
      if (!isObj(raw)) bad(`'doors[${i}]' must be an object`);
      if (raw.wall !== undefined || raw.offset !== undefined) {
        bad(`'doors[${i}]' must give 'level' with 'at' (the plan is reviewed before the walls exist)`);
      }
    });
    const parsed = rethrow(() => parsePlaceInWall({ items: args.doors }));
    doors = parsed.items.length ? parsed : null;
  }

  const stairs: PlanStair[] = [];
  if (args.stairs !== undefined) {
    if (!Array.isArray(args.stairs)) bad("'stairs' must be an array");
    (args.stairs as unknown[]).forEach((raw, i) => {
      if (!isObj(raw)) bad(`'stairs[${i}]' must be an object`);
      if (!isStr(raw.from)) bad(`'stairs[${i}].from' must be a level name`);
      if (!isStr(raw.to)) bad(`'stairs[${i}].to' must be a level name`);
      if (!shapeOf(raw.shape)) bad(`'stairs[${i}].shape' must be 'straight' or 'u'`);
      const w = raw.width === undefined ? STAIR_WIDTH : raw.width;
      if (!isNum(w) || w <= 0) bad(`'stairs[${i}].width' must be a positive number`);
      stairs.push({ from: raw.from, to: raw.to, shape: raw.shape, width: w });
    });
  }

  const limits: Partial<ReviewLimits> = {};
  if (args.limits !== undefined) {
    if (!isObj(args.limits)) bad("'limits' must be an object");
    for (const key of ['maxTravel', 'maxTravelToStair', 'minPassage', 'minCorridor'] as const) {
      const v = args.limits[key];
      if (v === undefined) continue;
      if (!isNum(v) || v <= 0) bad(`'limits.${key}' must be a positive number`);
      limits[key] = v;
    }
  }

  return {
    lot: { width, depth, setback },
    apartments,
    build: { ...build, fresh: true },
    buildKey,
    doors,
    stairs,
    limits,
  };
}

/**
 * Reads the common options of a review (`lot`, `apartments`, `limits`) without requiring a plan.
 * `cmd` is the prefix of the error (`review_model` by default).
 */
export function parseReviewOptions(args: unknown, cmd = 'review_model'): ReviewOptions {
  function fail(message: string): never {
    throw new Error(`${cmd}: ${message}`);
  }
  const a = isObj(args) ? args : fail('args must be an object');
  const out: ReviewOptions = {};
  if (a.lot !== undefined) {
    const lot = isObj(a.lot) ? a.lot : fail("'lot' needs width and depth in meters");
    const width = lot.width;
    const depth = lot.depth;
    if (!isNum(width) || width <= 0 || !isNum(depth) || depth <= 0) fail("'lot' needs width and depth in meters");
    const setback = lot.setback === undefined ? 0 : lot.setback;
    if (!isNum(setback) || setback < 0) fail("'lot.setback' must be 0 or more");
    out.lot = { width, depth, setback };
  }
  if (a.apartments !== undefined) {
    const raw = isObj(a.apartments) ? a.apartments : fail("'apartments' must be an object {level name: count}");
    const apartments: Record<string, number> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (!isStr(name)) fail("'apartments' needs level names");
      if (!isNum(value) || !Number.isInteger(value) || value < 0) fail(`'apartments.${name}' must be a whole number of apartments`);
      apartments[name] = value;
    }
    out.apartments = apartments;
  }
  if (a.limits !== undefined) {
    const raw = isObj(a.limits) ? a.limits : fail("'limits' must be an object");
    const limits: Partial<ReviewLimits> = {};
    for (const key of ['maxTravel', 'maxTravelToStair', 'minPassage', 'minCorridor'] as const) {
      const v = raw[key];
      if (v === undefined) continue;
      if (!isNum(v) || v <= 0) fail(`'limits.${key}' must be a positive number`);
      limits[key] = v;
    }
    out.limits = limits;
  }
  return out;
}

/**
 * Applies the plan to a new document and reviews it. `assets`: the files of the doors already read.
 * It never throws because of a review failure: it reports it in `review.checks`.
 */
export function reviewPlan(plan: Plan, assets: Map<string, AssetRef>): PlanReview {
  const doc: StudioDoc = newDocument();
  const failures: Review['checks'] = [];
  try {
    applyBuild(doc, plan.build);
  } catch (e) {
    return {
      review: {
        ok: false,
        checks: [{ id: 'rooms-access', ok: false, detail: e instanceof Error ? e.message : String(e) }],
        exits: 0,
        levels: [],
      },
      stairs: [],
      buildKey: plan.buildKey,
    };
  }

  if (plan.doors) {
    try {
      applyPlace(doc, plan.doors, assets);
    } catch (e) {
      failures.push({ id: 'rooms-access', ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  const stairs: StairItem[] = [];
  for (const ask of plan.stairs) {
    const base = doc.levels.find((l) => nameKey(l.name) === nameKey(ask.from));
    const top = doc.levels.find((l) => nameKey(l.name) === nameKey(ask.to));
    if (!base || !top) {
      const missing = !base ? ask.from : ask.to;
      failures.push({
        id: 'stairs',
        ok: false,
        detail: `no valid place for a ${ask.shape} stair between ${ask.from} and ${ask.to}: no level named '${missing}'`,
      });
      continue;
    }
    const spots = findStairSpots(doc, { baseLevelId: base.id, topLevelId: top.id, shape: ask.shape, width: ask.width }, 20);
    const doorSidePoints: Vec2[] = doorSides(doc, base.id).flatMap((d) => d.sides);
    const probe = roomProbe(doc);
    const center = (pts: Vec2[]): Vec2 => {
      let x = 0;
      let y = 0;
      for (const p of pts) {
        x += p[0];
        y += p[1];
      }
      return [x / pts.length, y / pts.length];
    };
    // exterior points of the doors of the lowest level: the stair is preferred near the entrance
    const lowest = doc.levels.reduce((a, b) => (b.elevation < a.elevation ? b : a));
    const lowFloors = doc.floors.filter((f) => f.levelId === lowest.id).map((f) => f.boundary);
    const entrances: Vec2[] = doorSides(doc, lowest.id).flatMap((d) =>
      d.sides.filter((p) => !lowFloors.some((poly) => pointInPolygon(p, poly))),
    );
    const nearEntrance = (p: Vec2): number =>
      entrances.length ? Math.min(...entrances.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1]))) : 0;
    let chosen: StairItem | null = null;
    let bestScore = -1;
    let bestDistance = Infinity;
    for (const spot of spots.spots) {
      const params: StairParams = {
        id: 'plan',
        baseLevelId: base.id,
        topLevelId: top.id,
        shape: ask.shape,
        origin: [spot.origin[0], spot.origin[1]],
        angle: spot.angle,
        width: ask.width,
        ...(spot.turn ? { turn: spot.turn } : {}),
      };
      let placed;
      try {
        placed = placeStair(doc, params);
      } catch {
        continue;
      }
      if (doorSidePoints.some((p) => pointInPolygon(p, placed.footprint))) continue;
      // a stair goes where there are more doors around (corridor or core), not inside an apartment,
      // y entre esos sitios, cerca de la entrada y sin invadir el paso del pasillo
      const rb = probe.roomAt(base.id, center(placed.bottomClear));
      const rt = probe.roomAt(top.id, center(placed.topClear));
      const score = (spot.stacked ? 1000 : 0) + (rb?.doors ?? -1) + (rt?.doors ?? -1);
      const distance = nearEntrance(center(placed.bottomClear));
      if (score > bestScore || (score === bestScore && distance < bestDistance - 1e-9)) {
        bestScore = score;
        bestDistance = distance;
        chosen = {
          from: ask.from,
          to: ask.to,
          shape: ask.shape,
          at: [spot.origin[0], spot.origin[1]],
          rotation: spot.angle,
          width: ask.width,
          ...(spot.turn ? { turn: spot.turn } : {}),
        };
      }
    }
    if (!chosen) {
      const reason = spots.reason ?? 'no spot found';
      failures.push({
        id: 'stairs',
        ok: false,
        detail: `no valid place for a ${ask.shape} stair between ${ask.from} and ${ask.to}: ${reason}`,
      });
      continue;
    }
    try {
      applyStairs(doc, { items: [chosen] });
      stairs.push(chosen);
    } catch (e) {
      const reason = (e instanceof Error ? e.message : String(e)).replace(/^place_stairs: /, '');
      failures.push({
        id: 'stairs',
        ok: false,
        detail: `no valid place for a ${ask.shape} stair between ${ask.from} and ${ask.to}: ${reason}`,
      });
    }
  }

  const review = reviewDoc(doc, {
    lot: plan.lot,
    ...(Object.keys(plan.apartments).length ? { apartments: plan.apartments } : {}),
    ...(Object.keys(plan.limits).length ? { limits: plan.limits } : {}),
  });
  if (failures.length) {
    review.checks = [...failures, ...review.checks];
    review.ok = false;
  }
  return { review, stairs, buildKey: plan.buildKey };
}
