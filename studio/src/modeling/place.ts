// Assistant placement request: it is read and validated whole before touching the document, it is
// summarized for the approval card and applied at once to a StudioDoc. Pure, no DOM.
import { hostsOf, wallHeight, type Placement, type StudioDoc } from './document';
import type { Vec2 } from './footprint';
import { checkHost, wallLength, type WallHost } from './hosting';

/** Cap on the pieces that can be requested in a single call. */
export const MAX_PIECES = 200;
/** Default sill of a window, in meters. */
export const DEFAULT_SILL = 0.9;
/** Maximum coordinate, in absolute value, in meters. */
const MAX_COORD = 10000;

/** Piece in a wall: by wall id and distance, or by level and a point on the axis of the wall. */
export type WallPiece = { asset: string; sill?: number } & (
  | { wall: string; offset: number }
  | { level: string; at: Vec2 }
);

export interface FloorPiece {
  asset: string;
  level: string;
  at: Vec2;
  rotation: number;
}

export type PlaceRequest = { kind: 'wall'; items: WallPiece[] } | { kind: 'floor'; items: FloorPiece[] };

/** What is known about an already read library file. Measurements of the root (bsi::ifc::prop::Width/Depth/Height). */
export interface AssetRef {
  layerUri: string;
  roots: string[];
  name: string;
  ifcClass: string | null;
  width?: number;
  depth?: number;
  height?: number;
}

export interface PlaceSummary {
  total: number;
  /** Muros o niveles distintos que reciben piezas. */
  targets: number;
  pieces: { name: string; ifc_class: string | null; count: number; width?: number; depth?: number; height?: number }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const MM = 1000;
const nameKey = (name: string): string => name.trim().toLowerCase();

/** Length rounded to the millimeter; -0 is normalized to 0. */
const mm = (v: number): number => {
  const r = Math.round(v * MM) / MM;
  return r === 0 ? 0 : r;
};

function bad(cmd: string, message: string): never {
  throw new Error(`${cmd}: ${message}`);
}

/** Point `[x, y]` within the limits, rounded to the millimeter. */
function point(cmd: string, v: unknown, at: string): Vec2 {
  if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) bad(cmd, `${at}: 'at' must be [x, y]`);
  const p: Vec2 = [mm(v[0] as number), mm(v[1] as number)];
  if (Math.abs(p[0]) > MAX_COORD || Math.abs(p[1]) > MAX_COORD) bad(cmd, `${at}: coordinates must be within ±10000`);
  return p;
}

function itemsOf(cmd: string, args: unknown): [number, Record<string, unknown>][] {
  if (!isObj(args)) bad(cmd, 'args must be an object');
  const raw = args.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PIECES) {
    bad(cmd, `'items' must be an array of 1 to ${MAX_PIECES} pieces`);
  }
  return raw.map((item, i) => {
    if (!isObj(item)) bad(cmd, `items[${i}] must be an object`);
    return [i, item];
  });
}

function assetOf(cmd: string, item: Record<string, unknown>, i: number): string {
  const asset = item.asset;
  if (typeof asset !== 'string' || !asset.toLowerCase().endsWith('.ifcx')) {
    bad(cmd, `items[${i}]: 'asset' must be a library .ifcx path`);
  }
  return asset;
}

/** Lee y valida `place_in_wall`. */
export function parsePlaceInWall(args: unknown): Extract<PlaceRequest, { kind: 'wall' }> {
  const cmd = 'place_in_wall';
  const items: WallPiece[] = [];
  for (const [i, item] of itemsOf(cmd, args)) {
    const asset = assetOf(cmd, item, i);
    if (item.sill !== undefined && !isNum(item.sill)) bad(cmd, `items[${i}]: 'sill' must be a finite number`);
    const wallForm = item.wall !== undefined || item.offset !== undefined;
    const pointForm = item.level !== undefined || item.at !== undefined;
    if (wallForm === pointForm) {
      bad(cmd, `items[${i}]: give 'wall' with 'offset', or 'level' with 'at'`);
    }
    const sill = item.sill !== undefined ? { sill: mm(item.sill as number) } : {};
    if (wallForm) {
      if (!isStr(item.wall)) bad(cmd, `items[${i}]: 'wall' must be a string`);
      if (!isNum(item.offset)) bad(cmd, `items[${i}]: 'offset' must be a finite number`);
      items.push({ asset, wall: item.wall, offset: mm(item.offset), ...sill });
    } else {
      if (!isStr(item.level)) bad(cmd, `items[${i}]: 'level' must be a string`);
      const at = point(cmd, item.at, `items[${i}]`);
      items.push({ asset, level: item.level, at, ...sill });
    }
  }
  return { kind: 'wall', items };
}

/** Lee y valida `place_furniture`. */
export function parsePlaceFurniture(args: unknown): Extract<PlaceRequest, { kind: 'floor' }> {
  const cmd = 'place_furniture';
  const items: FloorPiece[] = [];
  for (const [i, item] of itemsOf(cmd, args)) {
    const asset = assetOf(cmd, item, i);
    if (!isStr(item.level)) bad(cmd, `items[${i}]: 'level' must be a string`);
    const at = point(cmd, item.at, `items[${i}]`);
    if (item.rotation !== undefined && !isNum(item.rotation)) bad(cmd, `items[${i}]: 'rotation' must be a finite number`);
    items.push({ asset, level: item.level, at, rotation: item.rotation === undefined ? 0 : (item.rotation as number) });
  }
  return { kind: 'floor', items };
}

/** What is shown on the approval card: how many pieces go and which ones. */
export function summarizePlace(req: PlaceRequest, assets: Map<string, AssetRef>): PlaceSummary {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const item of req.items) {
    if (!counts.has(item.asset)) order.push(item.asset);
    counts.set(item.asset, (counts.get(item.asset) ?? 0) + 1);
  }
  const targets = new Set(
    req.kind === 'wall'
      ? req.items.map((i) => ('wall' in i ? i.wall : nameKey(i.level)))
      : req.items.map((i) => nameKey(i.level)),
  );
  const pieces = order.map((asset) => {
    const a = assets.get(asset);
    return {
      name: a?.name ?? asset,
      ifc_class: a?.ifcClass ?? null,
      count: counts.get(asset) as number,
      ...(a?.width !== undefined ? { width: a.width } : {}),
      ...(a?.depth !== undefined ? { depth: a.depth } : {}),
      ...(a?.height !== undefined ? { height: a.height } : {}),
    };
  });
  return { total: req.items.length, targets: targets.size, pieces };
}

/**
 * Wall of `level` whose axis passes within ≤ 0.1 m of `at` (the nearest one) and the distance from its
 * start to the projection of the point. It throws an Error if there is none.
 */
export function resolveWallPiece(doc: StudioDoc, level: string, at: Vec2): { wallId: string; offset: number } {
  const levelId = doc.levels.find((l) => nameKey(l.name) === nameKey(level))?.id;
  let best: { wallId: string; offset: number; distance: number } | null = null;
  if (levelId) {
    for (const w of doc.walls) {
      if (w.baseLevelId !== levelId) continue;
      const dx = w.end[0] - w.start[0];
      const dy = w.end[1] - w.start[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const ux = dx / len;
      const uy = dy / len;
      const along = (at[0] - w.start[0]) * ux + (at[1] - w.start[1]) * uy;
      if (along < -1e-9 || along > len + 1e-9) continue;
      const distance = Math.abs((at[0] - w.start[0]) * uy - (at[1] - w.start[1]) * ux);
      if (distance > 0.1 + 1e-9) continue;
      if (!best || distance < best.distance) best = { wallId: w.id, offset: mm(along), distance };
    }
  }
  if (!best) {
    throw new Error(`no wall of ${level} passes through [${+mm(at[0])}, ${+mm(at[1])}]`);
  }
  return { wallId: best.wallId, offset: best.offset };
}

/**
 * Applies to `doc` and returns the ids of the new placements, in the order of `items`. It validates EVERYTHING
 * antes de mutar: un Error no deja el documento a medias.
 */
export function applyPlace(doc: StudioDoc, req: PlaceRequest, assets: Map<string, AssetRef>): string[] {
  return req.kind === 'wall' ? applyWall(doc, req.items, assets) : applyFloor(doc, req.items, assets);
}

function applyWall(doc: StudioDoc, items: WallPiece[], assets: Map<string, AssetRef>): string[] {
  const cmd = 'place_in_wall';
  const nuevas: Placement[] = [];
  const ids: string[] = [];
  items.forEach((item, i) => {
    const at = `items[${i}]`;
    const a = assets.get(item.asset);
    if (!a) bad(cmd, `${at}: unknown asset '${item.asset}'`);
    let wallId: string;
    let offset: number;
    if ('wall' in item) {
      wallId = item.wall;
      offset = item.offset;
    } else {
      try {
        const r = resolveWallPiece(doc, item.level, item.at);
        wallId = r.wallId;
        offset = r.offset;
      } catch (e) {
        bad(cmd, `${at}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const wall = doc.walls.find((w) => w.id === wallId);
    if (!wall) bad(cmd, `${at}: no wall '${wallId}' in the model`);
    if (a.width === undefined || a.height === undefined) {
      bad(cmd, `${at}: '${a.name}' has no Width/Height, it cannot cut an opening`);
    }
    const sill = item.sill ?? (a.ifcClass === 'IfcWindow' ? DEFAULT_SILL : 0);
    const host: WallHost = { along: offset, sill, width: a.width, height: a.height };
    const others = [
      ...hostsOf(doc, wall.id).flatMap((p) => (p.host ? [p.host] : [])),
      ...nuevas.flatMap((p) => (p.parentId === wall.id && p.host ? [p.host] : [])),
    ];
    const reason = checkHost(wallLength(wall), wallHeight(doc.levels, wall), host, others);
    if (reason) bad(cmd, `${at}: ${reason}`);
    const p: Placement = {
      id: crypto.randomUUID(), layerUri: a.layerUri, parentId: wall.id, roots: [...a.roots], offset: [0, 0, 0], host,
    };
    nuevas.push(p);
    ids.push(p.id);
  });
  doc.composer.placements.push(...nuevas);
  return ids;
}

function applyFloor(doc: StudioDoc, items: FloorPiece[], assets: Map<string, AssetRef>): string[] {
  const cmd = 'place_furniture';
  const nuevas: Placement[] = [];
  const ids: string[] = [];
  items.forEach((item, i) => {
    const at = `items[${i}]`;
    const a = assets.get(item.asset);
    if (!a) bad(cmd, `${at}: unknown asset '${item.asset}'`);
    const level = doc.levels.find((l) => nameKey(l.name) === nameKey(item.level));
    if (!level) {
      bad(cmd, `${at}: no level named '${item.level}' (levels: ${doc.levels.map((l) => l.name).join(', ')})`);
    }
    const p: Placement = {
      id: crypto.randomUUID(), layerUri: a.layerUri, parentId: level.id, roots: [...a.roots],
      offset: [item.at[0], item.at[1], 0],
      ...(item.rotation !== 0 ? { rotation: [0, 0, item.rotation] as [number, number, number] } : {}),
    };
    nuevas.push(p);
    ids.push(p.id);
  });
  doc.composer.placements.push(...nuevas);
  return ids;
}
