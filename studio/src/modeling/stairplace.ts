// Assistant stairs request: it is read and validated whole before touching the document, it is
// summarized for the approval card and applied at once to a StudioDoc. Pure, no DOM.
import { STAIR_WIDTH } from './constants';
import { levelById, stairOf, type LevelParams, type StairParams, type StudioDoc } from './document';
import type { Vec2 } from './footprint';
import { checkStair, placeStair } from './staircheck';
import type { StairShape, StairTurn } from './stairlayout';

/** Cap on the stairs that can be requested in a single call. */
export const MAX_STAIRS = 20;
/** Maximum coordinate, in absolute value, in meters. */
const MAX_COORD = 10000;
/** Tope de sitios que devuelve `stair_spots`. */
const MAX_SPOTS = 20;

export interface StairItem {
  from: string;
  to: string;
  shape: StairShape;
  at: Vec2;
  rotation: number;
  width: number;
  turn?: StairTurn;
}

export interface StairRequest {
  items: StairItem[];
}

export interface StairSummary {
  total: number;
  stairs: {
    from: string;
    to: string;
    shape: StairShape;
    risers: number;
    riser: number;
    width: number;
    railings: number;
    handrails: number;
  }[];
  openings: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const mm = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

function bad(cmd: string, message: string): never {
  throw new Error(`${cmd}: ${message}`);
}

function shapeOf(cmd: string, v: unknown): StairShape {
  if (v !== 'straight' && v !== 'u') bad(cmd, "'shape' must be 'straight' or 'u'");
  return v;
}

function turnOf(cmd: string, v: unknown): StairTurn | undefined {
  if (v === undefined) return undefined;
  if (v !== 'left' && v !== 'right') bad(cmd, "'turn' must be 'left' or 'right'");
  return v;
}

function pointOf(cmd: string, v: unknown): Vec2 {
  if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) bad(cmd, "'at' must be [x, y]");
  const p: Vec2 = [mm(v[0] as number), mm(v[1] as number)];
  if (Math.abs(p[0]) > MAX_COORD || Math.abs(p[1]) > MAX_COORD) bad(cmd, 'coordinates must be within ±10000');
  return p;
}

/** Level by name (ignoring case and spaces); an error listing the ones that exist. */
export function levelByName(doc: StudioDoc, name: string, cmd: string, at: string): LevelParams {
  const key = name.trim().toLowerCase();
  const level = doc.levels.find((l) => l.name.trim().toLowerCase() === key);
  if (!level) bad(cmd, `${at ? `${at}: ` : ''}no level named '${name}' (levels: ${doc.levels.map((l) => l.name).join(', ')})`);
  return level;
}

/** Lee y valida `place_stairs`. */
export function parsePlaceStairs(args: unknown): StairRequest {
  const cmd = 'place_stairs';
  if (!isObj(args)) bad(cmd, 'args must be an object');
  const raw = args.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STAIRS) {
    bad(cmd, `'items' must be an array of 1 to ${MAX_STAIRS} stairs`);
  }
  const items: StairItem[] = raw.map((item, i) => {
    const at = `items[${i}]`;
    if (!isObj(item)) bad(cmd, `${at} must be an object`);
    if (!isStr(item.from)) bad(cmd, `${at}: 'from' must be a level name`);
    if (!isStr(item.to)) bad(cmd, `${at}: 'to' must be a level name`);
    const shape = shapeOf(cmd, item.shape);
    const origin = pointOf(cmd, item.at);
    if (item.rotation !== undefined && !isNum(item.rotation)) bad(cmd, `${at}: 'rotation' must be a finite number`);
    if (item.width !== undefined && !isNum(item.width)) bad(cmd, `${at}: 'width' must be a finite number`);
    return {
      from: item.from,
      to: item.to,
      shape,
      at: origin,
      rotation: item.rotation === undefined ? 0 : (item.rotation as number),
      width: item.width === undefined ? STAIR_WIDTH : (item.width as number),
      ...(item.turn !== undefined ? { turn: turnOf(cmd, item.turn) } : {}),
    };
  });
  return { items };
}

/** Lee y valida los argumentos de `stair_spots`. */
export function parseStairSpots(args: unknown): { from: string; to: string; shape: StairShape; width: number; limit: number } {
  const cmd = 'stair_spots';
  if (!isObj(args)) bad(cmd, 'args must be an object');
  if (!isStr(args.from)) bad(cmd, "'from' must be a level name");
  if (!isStr(args.to)) bad(cmd, "'to' must be a level name");
  const shape = shapeOf(cmd, args.shape);
  if (args.width !== undefined && !isNum(args.width)) bad(cmd, "'width' must be a finite number");
  if (args.limit !== undefined && !isNum(args.limit)) bad(cmd, "'limit' must be a number");
  const limit = args.limit === undefined ? 10 : Math.min(MAX_SPOTS, Math.max(1, Math.floor(args.limit as number)));
  return { from: args.from, to: args.to, shape, width: args.width === undefined ? STAIR_WIDTH : (args.width as number), limit };
}

/**
 * Applies the request to `doc` and returns the new ids, in order. Each stair sees the previous ones
 * (para apilar). Valida TODO antes de mutar: un Error no deja el documento a medias.
 */
export function applyStairs(doc: StudioDoc, req: StairRequest): string[] {
  const cmd = 'place_stairs';
  const next = structuredClone(doc);
  const created: StairParams[] = [];
  req.items.forEach((item, i) => {
    const at = `items[${i}]`;
    const base = levelByName(next, item.from, cmd, at);
    const top = levelByName(next, item.to, cmd, at);
    const stair: StairParams = {
      id: crypto.randomUUID(),
      baseLevelId: base.id,
      topLevelId: top.id,
      shape: item.shape,
      origin: [item.at[0], item.at[1]],
      angle: item.rotation,
      width: item.width,
      ...(item.turn ? { turn: item.turn } : {}),
    };
    const reason = checkStair(next, stair);
    if (reason) bad(cmd, `${at}: ${reason}`);
    next.stairs.push(stair);
    created.push(stair);
  });
  doc.stairs.push(...created);
  return created.map((s) => s.id);
}

/** What is shown on the approval card. */
export function summarizeStairs(doc: StudioDoc, ids: string[]): StairSummary {
  const stairs = ids.flatMap((id) => {
    const stair = stairOf(doc, id);
    if (!stair) return [];
    const placed = placeStair(doc, stair);
    const base = levelById(doc.levels, stair.baseLevelId);
    const top = levelById(doc.levels, stair.topLevelId);
    return [{
      from: base?.name ?? '',
      to: top?.name ?? '',
      shape: stair.shape,
      risers: placed.layout.risers,
      riser: placed.layout.riser,
      width: stair.width,
      railings: placed.rails.filter((r) => r.kind === 'guard').length,
      handrails: placed.rails.filter((r) => r.kind === 'handrail').length,
    }];
  });
  return { total: ids.length, stairs, openings: stairs.length };
}
