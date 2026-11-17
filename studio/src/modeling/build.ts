// Assistant build request: it is read and validated whole before touching the document, it is
// summarized for the approval card and applied at once to a StudioDoc. Pure, no DOM.
import { FLOOR_THICKNESS, JOIN_TOLERANCE, WALL_HEIGHT, WALL_THICKNESS } from './constants';
import { sortedLevels, type LevelParams, type StudioDoc } from './document';
import { polygonArea, type Vec2 } from './footprint';

/** Cap on the levels that can be requested in a single call. */
export const MAX_LEVELS = 60;
/** Tope de muros ya expandidos por nivel. */
export const MAX_WALLS = 5000;
/** Tope de suelos ya expandidos por nivel. */
export const MAX_FLOORS = 600;
/** Maximum coordinate, in absolute value, in meters. */
const MAX_COORD = 10000;
const MIN_THICKNESS = 0.05;
const MAX_THICKNESS = 1;
const MM = 1000;

export interface BuildWall {
  from: Vec2;
  to: Vec2;
  thickness: number;
}

export interface BuildLayout {
  walls: BuildWall[];
  floors: Vec2[][];
}

export interface BuildLevel {
  name: string;
  elevation: number;
  height: number;
  layout: string;
}

export interface BuildRequest {
  fresh: boolean;
  levels: BuildLevel[];
  layouts: Record<string, BuildLayout>;
}

export interface BuildSummary {
  new: boolean;
  levels: { name: string; elevation: number; walls: number; floors: number }[];
  totals: { levels: number; walls: number; floors: number };
  footprint: { width: number; depth: number };
}

export interface BuildCounts {
  levels: number;
  walls: number;
  floors: number;
  levelIds: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function bad(message: string): never {
  throw new Error(`build_model: ${message}`);
}

/** Coordinate rounded to the millimeter; -0 is normalized to 0 so that comparisons are stable. */
const mm = (v: number): number => {
  const r = Math.round(v * MM) / MM;
  return r === 0 ? 0 : r;
};

/** Point `[x, y]` within the limits, rounded to the millimeter. `at` is the element in the errors. */
function point(v: unknown, field: string, at: string): Vec2 {
  if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) bad(`${field} must be [x, y]`);
  const p: Vec2 = [mm(v[0] as number), mm(v[1] as number)];
  if (Math.abs(p[0]) > MAX_COORD || Math.abs(p[1]) > MAX_COORD) bad(`${at}: coordinates must be within ±10000`);
  return p;
}

const nameKey = (name: string): string => name.trim().toLowerCase();

/** Reads and validates the whole request; it throws an Error with the field and the reason. */
export function parseBuildRequest(args: unknown): BuildRequest {
  if (!isObj(args)) bad('args must be an object');

  const fresh = args.new === undefined ? true : args.new;
  if (typeof fresh !== 'boolean') bad("'new' must be a boolean");

  const rawLevels = args.levels;
  if (!Array.isArray(rawLevels) || rawLevels.length === 0) bad("'levels' must be a non-empty array");
  if (rawLevels.length > MAX_LEVELS) bad(`'levels': at most ${MAX_LEVELS} levels`);

  const levels: BuildLevel[] = [];
  let previous = -Infinity;
  const names = new Set<string>();
  rawLevels.forEach((raw, i) => {
    const at = `levels[${i}]`;
    if (!isObj(raw)) bad(`${at} must be an object`);
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) bad(`${at}: 'name' must be a non-empty string`);
    if (!isNum(raw.elevation)) bad(`${at}: 'elevation' must be a finite number`);
    if (raw.elevation <= previous) bad(`${at}: 'elevation' must be greater than the level below`);
    const height = raw.height === undefined ? WALL_HEIGHT : raw.height;
    if (!isNum(height) || height <= 0) bad(`${at}: 'height' must be a positive number`);
    const layout = raw.layout;
    if (typeof layout !== 'string' || !layout) bad(`${at}: 'layout' must be a non-empty string`);
    const key = nameKey(name);
    if (names.has(key)) bad(`${at}: duplicate level name`);
    names.add(key);
    previous = raw.elevation;
    levels.push({ name, elevation: raw.elevation, height, layout });
  });

  const rawLayouts = args.layouts;
  if (!isObj(rawLayouts)) bad("'layouts' must be an object");
  const layouts: Record<string, BuildLayout> = {};
  for (const [id, value] of Object.entries(rawLayouts)) {
    if (!isObj(value)) bad(`layouts.${id} must be an object`);
    layouts[id] = parseLayout(id, value);
  }

  for (const [i, level] of levels.entries()) {
    if (!layouts[level.layout]) bad(`levels[${i}]: unknown layout '${level.layout}'`);
  }

  const walls = levels.reduce((n, l) => n + layouts[l.layout].walls.length, 0);
  if (walls > MAX_WALLS) bad(`'levels': at most ${MAX_WALLS} walls`);
  const floors = levels.reduce((n, l) => n + layouts[l.layout].floors.length, 0);
  if (floors > MAX_FLOORS) bad(`'levels': at most ${MAX_FLOORS} floors`);

  return { fresh, levels, layouts };
}

/** Una planta: sus muros y suelos, ya redondeados y comprobados. */
function parseLayout(id: string, value: Record<string, unknown>): BuildLayout {
  const at = `layouts.${id}`;
  const rawWalls = value.walls === undefined ? [] : value.walls;
  if (!Array.isArray(rawWalls)) bad(`${at}: 'walls' must be an array`);
  const walls: BuildWall[] = [];
  rawWalls.forEach((raw, i) => {
    const wAt = `${at}.walls[${i}]`;
    if (!isObj(raw)) bad(`${wAt} must be an object`);
    const from = point(raw.from, `${wAt}.from`, wAt);
    const to = point(raw.to, `${wAt}.to`, wAt);
    const thickness = raw.thickness === undefined ? WALL_THICKNESS : raw.thickness;
    if (!isNum(thickness) || thickness < MIN_THICKNESS || thickness > MAX_THICKNESS) {
      bad(`${wAt}: 'thickness' must be between ${MIN_THICKNESS} and ${MAX_THICKNESS}`);
    }
    // la longitud se mide con los valores pedidos: 0,0005 m es demasiado corto aunque redondee a 1 mm
    const [rx0, ry0] = raw.from as Vec2;
    const [rx1, ry1] = raw.to as Vec2;
    if (Math.hypot(rx1 - rx0, ry1 - ry0) < JOIN_TOLERANCE) {
      bad(`${wAt}: shorter than ${JOIN_TOLERANCE} m`);
    }
    const dup = walls.findIndex(
      (o) =>
        (o.from[0] === from[0] && o.from[1] === from[1] && o.to[0] === to[0] && o.to[1] === to[1]) ||
        (o.from[0] === to[0] && o.from[1] === to[1] && o.to[0] === from[0] && o.to[1] === from[1]),
    );
    if (dup >= 0) bad(`${wAt}: duplicate of walls[${dup}]`);
    walls.push({ from, to, thickness });
  });

  const rawFloors = value.floors === undefined ? [] : value.floors;
  if (!Array.isArray(rawFloors)) bad(`${at}: 'floors' must be an array`);
  const floors: Vec2[][] = [];
  rawFloors.forEach((raw, i) => {
    const fAt = `${at}.floors[${i}]`;
    if (!Array.isArray(raw)) bad(`${fAt} must be an array of [x, y] points`);
    if (raw.length < 3) bad(`${fAt}: needs at least 3 points`);
    const boundary = raw.map((p, j) => point(p, `${fAt}[${j}]`, fAt));
    if (!(Math.abs(polygonArea(boundary)) >= 1e-6)) bad(`${fAt}: area is zero`);
    floors.push(boundary);
  });

  return { walls, floors };
}

/** What is shown on the approval card: levels, totals and footprint. */
export function summarizeBuild(req: BuildRequest): BuildSummary {
  const levels = req.levels.map((l) => {
    const layout = req.layouts[l.layout];
    return { name: l.name, elevation: l.elevation, walls: layout.walls.length, floors: layout.floors.length };
  });
  const totals = levels.reduce(
    (t, l) => ({ levels: t.levels + 1, walls: t.walls + l.walls, floors: t.floors + l.floors }),
    { levels: 0, walls: 0, floors: 0 },
  );

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (p: Vec2): void => {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  };
  for (const level of req.levels) {
    const layout = req.layouts[level.layout];
    for (const w of layout.walls) {
      grow(w.from);
      grow(w.to);
    }
    for (const f of layout.floors) for (const p of f) grow(p);
  }
  const footprint = minX === Infinity ? { width: 0, depth: 0 } : { width: maxX - minX, depth: maxY - minY };

  return { new: req.fresh, levels, totals, footprint };
}

/**
 * Applies the request to `doc`. `levelIds` follows the order of `req.levels`. Everything that can fail is
 * comprueba antes de mutar: un Error no deja el documento a medias.
 */
export function applyBuild(doc: StudioDoc, req: BuildRequest): BuildCounts {
  if (!req.levels.length) bad("'levels' must be a non-empty array");

  if (req.fresh && (doc.levels.length !== 1 || doc.walls.length || doc.floors.length)) {
    bad('new: true needs a new document with only its default level');
  }

  // Levels: with `fresh`, the only one there is becomes the first one requested; without it, a name that already
  // existe se reutiliza y su cota debe coincidir.
  const resolved: (LevelParams | null)[] = [];
  req.levels.forEach((level, i) => {
    if (req.fresh) return;
    const existing = doc.levels.find((l) => nameKey(l.name) === nameKey(level.name));
    if (existing && existing.elevation !== level.elevation) {
      bad(`levels[${i}]: level '${existing.name}' already exists at elevation ${existing.elevation}`);
    }
    resolved.push(existing ?? null);
  });

  const result: LevelParams[] = [];
  const levelIds: string[] = [];
  req.levels.forEach((level, i) => {
    if (req.fresh && i === 0) {
      const first = doc.levels[0];
      first.name = level.name;
      first.elevation = level.elevation;
      result.push(first);
    } else {
      const existing = resolved[i];
      if (existing) result.push(existing);
      else {
        const created: LevelParams = { id: crypto.randomUUID(), name: level.name, elevation: level.elevation };
        doc.levels.push(created);
        result.push(created);
      }
    }
    levelIds.push(result[i].id);
  });

  // El nivel superior de un muro es el siguiente por encima en el documento resultante (a igual cota,
  // ninguno: un muro no puede tener altura cero).
  const above = (level: LevelParams): LevelParams | null =>
    sortedLevels(doc.levels).find((l) => l.elevation > level.elevation) ?? null;

  let walls = 0;
  let floors = 0;
  for (const [i, level] of req.levels.entries()) {
    const resolvedLevel = result[i];
    const top = above(resolvedLevel);
    for (const w of req.layouts[level.layout].walls) {
      doc.walls.push({
        id: crypto.randomUUID(),
        start: [...w.from],
        end: [...w.to],
        thickness: w.thickness,
        bodyId: crypto.randomUUID(),
        axisId: crypto.randomUUID(),
        baseLevelId: resolvedLevel.id,
        baseOffset: 0,
        topLevelId: top?.id ?? null,
        topOffset: 0,
        height: level.height,
      });
      walls++;
    }
    for (const boundary of req.layouts[level.layout].floors) {
      const pts = boundary.map((p): Vec2 => [p[0], p[1]]);
      doc.floors.push({
        id: crypto.randomUUID(),
        bodyId: crypto.randomUUID(),
        levelId: resolvedLevel.id,
        offset: 0,
        thickness: FLOOR_THICKNESS,
        boundary: polygonArea(pts) > 0 ? pts : pts.reverse(),
      });
      floors++;
    }
  }

  return { levels: req.levels.length, walls, floors, levelIds };
}
