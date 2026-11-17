import type { IfcxFile, IfcxNode } from '../../ifcx/types';
import { BUNDLED_SCHEMAS } from '../../model/schemas';
import { JOIN_TOLERANCE } from '../constants';
import { polygonArea, type Vec2 } from '../footprint';
import { LevelParams, WallParams, FloorParams, StairParams, ComposerMeta, StudioDoc, ReadInfo } from './types';
import { levelById, wallHeight } from './levels';
import { DOC_VERSION, K_CLASS, K_NAME, K_DOC, K_LEVEL, K_WALL, K_FLOOR, K_STAIR, K_COMPOSER } from './keys';
import { placeParents, validParent, hostIsValid, esContenedor, parseComposer } from './composer';

// --- Reading (it never throws: on any anomaly it returns null) ---

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export const vec2 = (v: unknown): Vec2 | null =>
  Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null;

export function parse(file: IfcxFile, info?: ReadInfo): StudioDoc | null {
  if (!isObj(file) || !Array.isArray(file.data)) return null;
  // the last `K_DOC.overs` entries are overrides of the document: they may repeat paths
  const projectEntry = file.data.find((n) => isObj(n) && isObj(n.attributes) && isObj(n.attributes[K_DOC]));
  const oversCount = (projectEntry?.attributes?.[K_DOC] as { overs?: unknown } | undefined)?.overs;
  const nOvers = isNum(oversCount) && oversCount > 0 ? Math.min(Math.floor(oversCount), file.data.length) : 0;
  const body = file.data.slice(0, file.data.length - nOvers);
  const overs = nOvers ? file.data.slice(file.data.length - nOvers).filter((n) => isObj(n) && isStr(n.path)) : [];
  const byPath = new Map<string, IfcxNode>();
  // toIfcx emits a single entry per path; if there are repeated ones the file is not coherent.
  for (const n of body) {
    if (!isObj(n) || !isStr(n.path) || byPath.has(n.path)) return null;
    byPath.set(n.path, n);
  }

  const attrs = (n: IfcxNode | undefined): Record<string, unknown> => (n && isObj(n.attributes) ? n.attributes : {});
  const code = (n: IfcxNode | undefined) => {
    const c = attrs(n)[K_CLASS];
    return isObj(c) ? c.code : undefined;
  };
  const childrenOf = (n: IfcxNode | undefined, wanted: string): string[] => {
    if (!n || !isObj(n.children)) return [];
    return Object.values(n.children).filter((v): v is string => isStr(v) && code(byPath.get(v)) === wanted);
  };
  const childOf = (n: IfcxNode | undefined, wanted: string): string | null => childrenOf(n, wanted)[0] ?? null;

  const projectNode = body.find((n) => isObj(n) && isObj(attrs(n)[K_DOC]));
  if (!projectNode || code(projectNode) !== 'IfcProject') return null;
  const docAttr = attrs(projectNode)[K_DOC] as Record<string, unknown>;
  const version = docAttr.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > DOC_VERSION) return null; // la 1 (fase de muros) se migra al leer

  const root = body.find(
    (n) => isObj(n) && isObj(n.children) && Object.values(n.children).includes(projectNode.path),
  );
  if (!root || !isStr(root.path)) return null;

  const site = childOf(projectNode, 'IfcSite');
  const building = site && childOf(byPath.get(site), 'IfcBuilding');
  if (!site || !building) return null;
  const storeyIds = childrenOf(byPath.get(building), 'IfcBuildingStorey');
  if (!storeyIds.length) return null;

  const seen = new Set<string>([root.path, projectNode.path, site, building]);
  const levels: LevelParams[] = [];
  for (const id of storeyIds) {
    if (seen.has(id)) return null;
    seen.add(id);
    const storeyNode = byPath.get(id)!;
    const lv = attrs(storeyNode)[K_LEVEL];
    const name = attrs(storeyNode)[K_NAME];
    if (!isObj(lv) || !isNum(lv.elevation) || typeof name !== 'string') return null;
    if (storeyNode.children !== undefined && !isObj(storeyNode.children)) return null;
    levels.push({ id, name, elevation: lv.elevation });
  }

  // Before version 4 there was no composer; a malformed one is discarded without invalidating the document.
  const parsed =
    version >= 4
      ? parseComposer(attrs(projectNode)[K_COMPOSER])
      : { layers: [], placements: [], containers: new Set<string>() };
  const composer: ComposerMeta = parsed ? { layers: parsed.layers, placements: parsed.placements } : { layers: [], placements: [] };
  if (info) info.composerDamaged = !parsed && attrs(projectNode)[K_COMPOSER] !== undefined;
  // also the containers of discarded placements (their layer is no longer there): they are not elements
  const placementIds = parsed?.containers ?? new Set<string>();

  const walls: WallParams[] = [];
  const floors: FloorParams[] = [];
  const stairs: StairParams[] = [];
  for (const level of levels) {
    for (const id of Object.values(byPath.get(level.id)!.children ?? {})) {
      if (isStr(id) && placementIds.has(id)) continue; // contenedor de un archivo enlazado, no un elemento
      // Only with a damaged composer do we not know which ids are containers: they are recognized by their shape (without
      // IFC class or wall/floor data, with the name 'Linked · …' and a transformation). With a valid composer
      // its placements are the only authority; any other node without marks invalidates the document.
      const hijo = !parsed && isStr(id) ? byPath.get(id) : undefined;
      if (hijo && esContenedor(attrs(hijo))) continue;
      const wn = isStr(id) ? byPath.get(id) : undefined;
      if (wn && attrs(wn)[K_STAIR] !== undefined) {
        const stair = parseStair(wn, level.id, levels);
        if (!stair) return null;
        stairs.push(stair);
        continue;
      }
      if (wn && code(wn) === 'IfcSlab') {
        const floor = parseFloor(wn, level.id);
        if (!floor) return null;
        for (const x of [floor.id, floor.bodyId]) {
          if (seen.has(x)) return null;
          seen.add(x);
        }
        floors.push(floor);
        continue;
      }
      if (!wn || code(wn) !== 'IfcWall') return null;
      const p = attrs(wn)[K_WALL];
      if (!isObj(p)) return null;
      const start = vec2(p.start);
      const end = vec2(p.end);
      if (!start || !end || !isNum(p.thickness) || !isNum(p.height) || !isNum(p.baseOffset)) return null;
      if (p.thickness <= 0 || p.height <= 0) return null;
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < JOIN_TOLERANCE) return null;
      // version 1 had no top constraint: the wall was free
      const topOffset = version === 1 && p.topOffset === undefined ? 0 : p.topOffset;
      if (!isNum(topOffset)) return null;
      if (p.topLevel !== undefined && (!isStr(p.topLevel) || !levelById(levels, p.topLevel))) return null;
      const ch = wn.children;
      if (!isObj(ch) || !isStr(ch.Body) || !isStr(ch.Axis)) return null;
      if (!isObj(attrs(byPath.get(ch.Body))['usd::usdgeom::mesh'])) return null;
      if (!isObj(attrs(byPath.get(ch.Axis))['usd::usdgeom::basiscurves'])) return null;
      // Unique identities: no repeated walls and no Body/Axis shared or equal among them.
      for (const x of [wn.path, ch.Body, ch.Axis]) {
        if (seen.has(x)) return null;
        seen.add(x);
      }
      const wall: WallParams = {
        id: wn.path,
        start,
        end,
        thickness: p.thickness,
        bodyId: ch.Body,
        axisId: ch.Axis,
        baseLevelId: level.id,
        baseOffset: p.baseOffset,
        topLevelId: p.topLevel ?? null,
        topOffset,
        height: p.height,
      };
      if (!(wallHeight(levels, wall) > 0)) return null;
      walls.push(wall);
    }
  }

  const known = new Set([...Object.keys(BUNDLED_SCHEMAS), ...composer.layers.map((l) => l.uri)]);
  const imports = (Array.isArray(file.imports) ? file.imports : []).map((i) => i?.uri).filter((u): u is string => isStr(u) && !known.has(u));
  const doc: StudioDoc = { ids: { root: root.path, project: projectNode.path, site, building }, levels, walls, floors, stairs, composer, overs, imports };
  // with all the elements read: a placement whose parent is no longer there moves to the project; a hosted
  // piece whose wall is no longer there is discarded (without a wall there is nowhere to host it)
  const uris = new Set(composer.layers.map((l) => l.uri));
  const parents = placeParents(doc);
  composer.placements = composer.placements
    .filter((p) => hostIsValid(doc, p))
    .map((p) => validParent(p, parents, uris, projectNode.path));
  return doc;

  /** Una escalera de Studio; null si le faltan datos o no son coherentes. */
  function parseStair(n: IfcxNode, levelId: string, allLevels: LevelParams[]): StairParams | null {
    if (code(n) !== 'IfcStair') return null;
    const p = attrs(n)[K_STAIR];
    if (!isObj(p)) return null;
    if (!isStr(p.base) || !isStr(p.top) || !levelById(allLevels, p.base) || !levelById(allLevels, p.top)) return null;
    if (p.base !== levelId) return null;
    if (p.shape !== 'straight' && p.shape !== 'u') return null;
    const origin = vec2(p.origin);
    if (!origin || !isNum(p.angle) || !isNum(p.width) || p.width <= 0) return null;
    if (p.turn !== undefined && p.turn !== 'left' && p.turn !== 'right') return null;
    const ch = n.children;
    if (!isObj(ch)) return null;
    const childIds = Object.values(ch);
    if (!childIds.length || !childIds.every(isStr)) return null;
    let flights = 0;
    for (const id of childIds) {
      const child = byPath.get(id);
      if (!isObj(child) || seen.has(id)) return null;
      const cls = code(child);
      if (cls === 'IfcStairFlight') flights++;
      else if (cls !== 'IfcSlab' && cls !== 'IfcRailing') return null;
      const kids = child.children;
      if (!isObj(kids) || !isStr(kids.Body) || seen.has(kids.Body)) return null;
      if (!isObj(attrs(byPath.get(kids.Body))['usd::usdgeom::mesh'])) return null;
      seen.add(id);
      seen.add(kids.Body);
    }
    if (flights !== (p.shape === 'u' ? 2 : 1)) return null;
    if (seen.has(n.path)) return null;
    seen.add(n.path);
    return {
      id: n.path,
      baseLevelId: p.base,
      topLevelId: p.top,
      shape: p.shape,
      origin,
      angle: p.angle,
      width: p.width,
      ...(p.turn === 'left' || p.turn === 'right' ? { turn: p.turn } : {}),
    };
  }

  /** Un IfcSlab de Studio; null si le faltan datos o no son coherentes. */
  function parseFloor(n: IfcxNode, levelId: string): FloorParams | null {
    const p = attrs(n)[K_FLOOR];
    if (!isObj(p) || !Array.isArray(p.boundary) || p.boundary.length < 3) return null;
    if (!isNum(p.thickness) || p.thickness <= 0 || !isNum(p.offset)) return null;
    const boundary: Vec2[] = [];
    for (const v of p.boundary) {
      const pt = vec2(v);
      if (!pt) return null;
      boundary.push(pt);
    }
    const area = polygonArea(boundary);
    if (Math.abs(area) < 1e-6) return null;
    const ch = n.children;
    if (!isObj(ch) || !isStr(ch.Body)) return null;
    if (!isObj(attrs(byPath.get(ch.Body))['usd::usdgeom::mesh'])) return null;
    return { id: n.path, bodyId: ch.Body, levelId, offset: p.offset, thickness: p.thickness, boundary: area > 0 ? boundary : boundary.reverse() };
  }
}

/** Rebuilds the document from a Studio IFCx; null if it is not one or it is damaged. */
export function fromIfcx(file: IfcxFile, info?: ReadInfo): StudioDoc | null {
  try {
    return parse(file, info);
  } catch {
    return null;
  }
}
