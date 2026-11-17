// Edit session: Studio document, path and change state. No DOM.
import type { IfcxFile } from '../ifcx/types';
import { fileName, writeTextFile } from '../model/open';
import { FLOOR_THICKNESS, JOIN_TOLERANCE, UNTITLED, WALL_HEIGHT, WALL_THICKNESS } from './constants';
import { fromIfcx, levelById, newDocument, sortedLevels, stairOf, toIfcx, wallHeight, type FloorParams, type LevelParams, type Placement, type StairParams, type StudioDoc, type WallParams } from './document';
import { polygonArea, type Vec2 } from './footprint';
import { type WallHost } from './hosting';
import { checkStair } from './staircheck';
import { fail, OK, type EditResult, type FloorPatch, type WallPatch } from './session/result';
import { addPlacement, isPlaceTarget, movePlacement, placeFile, placementOf, removePlacement, unplaceFile } from './session/placements';

export type { EditError, WallPatch, FloorPatch, EditResult } from './session/result';

export class EditSession {
  path: string | null = null;
  dirty = false;
  /** When opened, its saved linked layers could not be read (they will be lost on save). */
  composerDamaged = false;

  constructor(public doc: StudioDoc) {}

  get name(): string {
    return this.path ? fileName(this.path) : UNTITLED;
  }

  /**
   * Adds a free wall hanging from `baseLevelId` (the lowest level by default); null (without making it dirty)
   * if it is shorter than JOIN_TOLERANCE or the level does not exist.
   */
  addWall(start: Vec2, end: Vec2, baseLevelId?: string): WallParams | null {
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < JOIN_TOLERANCE) return null;
    const base = baseLevelId === undefined ? sortedLevels(this.doc.levels)[0] : levelById(this.doc.levels, baseLevelId);
    if (!base) return null;
    const wall: WallParams = {
      id: crypto.randomUUID(),
      start: [...start],
      end: [...end],
      thickness: WALL_THICKNESS,
      bodyId: crypto.randomUUID(),
      axisId: crypto.randomUUID(),
      baseLevelId: base.id,
      baseOffset: 0,
      topLevelId: null,
      topOffset: 0,
      height: WALL_HEIGHT,
    };
    this.doc.walls.push(wall);
    this.dirty = true;
    return wall;
  }

  removeWall(id: string): boolean {
    const i = this.doc.walls.findIndex((w) => w.id === id);
    if (i < 0) return false;
    this.doc.walls.splice(i, 1);
    // without a wall there is nowhere to host its pieces: they go with it (and with them their openings)
    this.doc.composer.placements = this.doc.composer.placements.filter((p) => !(p.host && p.parentId === id));
    this.dirty = true;
    return true;
  }

  hasWall(id: string): boolean {
    return this.doc.walls.some((w) => w.id === id);
  }

  /**
   * Adds a floor on `levelId` with that boundary (saved counterclockwise); null (without making it dirty) if it has
   * fewer than 3 points, the area is almost null or the level does not exist.
   */
  addFloor(boundary: Vec2[], levelId: string): FloorParams | null {
    if (boundary.length < 3 || !levelById(this.doc.levels, levelId)) return null;
    const area = polygonArea(boundary);
    if (!(Math.abs(area) >= 1e-6)) return null;
    const pts = boundary.map((p): Vec2 => [p[0], p[1]]);
    const floor: FloorParams = {
      id: crypto.randomUUID(),
      bodyId: crypto.randomUUID(),
      levelId,
      offset: 0,
      thickness: FLOOR_THICKNESS,
      boundary: area > 0 ? pts : pts.reverse(),
    };
    this.doc.floors.push(floor);
    this.dirty = true;
    return floor;
  }

  removeFloor(id: string): boolean {
    const i = this.doc.floors.findIndex((f) => f.id === id);
    if (i < 0) return false;
    this.doc.floors.splice(i, 1);
    this.dirty = true;
    return true;
  }

  hasFloor(id: string): boolean {
    return this.doc.floors.some((f) => f.id === id);
  }

  /** Adds a stair (without validating that it fits); null if its levels do not exist. */
  addStair(p: Omit<StairParams, 'id'>): StairParams | null {
    if (!levelById(this.doc.levels, p.baseLevelId) || !levelById(this.doc.levels, p.topLevelId)) return null;
    const stair: StairParams = {
      id: crypto.randomUUID(),
      baseLevelId: p.baseLevelId,
      topLevelId: p.topLevelId,
      shape: p.shape,
      origin: [p.origin[0], p.origin[1]],
      angle: p.angle,
      width: p.width,
      ...(p.turn ? { turn: p.turn } : {}),
    };
    this.doc.stairs.push(stair);
    this.dirty = true;
    return stair;
  }

  removeStair(id: string): boolean {
    const stair = stairOf(this.doc, id);
    if (!stair) return false;
    const i = this.doc.stairs.findIndex((s) => s.id === stair.id);
    if (i < 0) return false;
    this.doc.stairs.splice(i, 1);
    this.dirty = true;
    return true;
  }

  hasStair(id: string): boolean {
    return stairOf(this.doc, id) !== undefined;
  }

  /** Moves the start in plan; if the site stops being valid nothing changes. */
  moveStair(id: string, dx: number, dy: number): EditResult {
    const stair = stairOf(this.doc, id);
    if (!stair) return fail('unknown');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return fail('bad-number');
    if (dx === 0 && dy === 0) return OK;
    const next: StairParams = { ...stair, origin: [stair.origin[0] + dx, stair.origin[1] + dy] };
    if (checkStair(this.doc, next)) return fail('stair');
    stair.origin = next.origin;
    this.dirty = true;
    return OK;
  }

  /** Cambia el nivel y/o el offset del suelo: todo el parche o nada. */
  setFloorConstraints(id: string, patch: FloorPatch): EditResult {
    const f = this.doc.floors.find((x) => x.id === id);
    if (!f) return fail('unknown');
    if (patch.levelId !== undefined && !levelById(this.doc.levels, patch.levelId)) return fail('unknown');
    if (patch.offset !== undefined && !Number.isFinite(patch.offset)) return fail('bad-number');
    const levelId = patch.levelId ?? f.levelId;
    const offset = patch.offset ?? f.offset;
    if (levelId === f.levelId && offset === f.offset) return OK;
    f.levelId = levelId;
    f.offset = offset;
    this.dirty = true;
    return OK;
  }

  /** Desplaza el muro en planta (sus dos extremos); Z la gobiernan su nivel y sus desfases. */
  moveWall(id: string, dx: number, dy: number): EditResult {
    const w = this.doc.walls.find((x) => x.id === id);
    if (!w) return fail('unknown');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return fail('bad-number');
    if (dx === 0 && dy === 0) return OK;
    w.start = [w.start[0] + dx, w.start[1] + dy];
    w.end = [w.end[0] + dx, w.end[1] + dy];
    this.dirty = true;
    return OK;
  }

  /** Desplaza el contorno del suelo en planta. */
  moveFloor(id: string, dx: number, dy: number): EditResult {
    const f = this.doc.floors.find((x) => x.id === id);
    if (!f) return fail('unknown');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return fail('bad-number');
    if (dx === 0 && dy === 0) return OK;
    f.boundary = f.boundary.map((p): Vec2 => [p[0] + dx, p[1] + dy]);
    this.dirty = true;
    return OK;
  }

  /** Rotates the wall in plan around its start point until its direction measures `deg` degrees. */
  rotateWall(id: string, deg: number): EditResult {
    const w = this.doc.walls.find((x) => x.id === id);
    if (!w) return fail('unknown');
    if (!Number.isFinite(deg)) return fail('bad-number');
    const len = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
    const a = (deg * Math.PI) / 180;
    const end: Vec2 = [w.start[0] + len * Math.cos(a), w.start[1] + len * Math.sin(a)];
    if (Math.abs(end[0] - w.end[0]) < 1e-9 && Math.abs(end[1] - w.end[1]) < 1e-9) return OK;
    w.end = end;
    this.dirty = true;
    return OK;
  }

  /** Rotates the boundary of the floor in plan `deg` degrees around its first vertex. */
  rotateFloor(id: string, deg: number): EditResult {
    const f = this.doc.floors.find((x) => x.id === id);
    if (!f) return fail('unknown');
    if (!Number.isFinite(deg)) return fail('bad-number');
    if (Math.abs(deg) < 1e-9) return OK;
    const a = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const [ox, oy] = f.boundary[0];
    f.boundary = f.boundary.map(([x, y]): Vec2 => [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c]);
    this.dirty = true;
    return OK;
  }

  /** Own rotation (degrees, Euler XYZ) and scale of the container of a placement; what is missing does not change. */
  setPlacementRotScale(id: string, rs: { rotation?: [number, number, number]; scale?: [number, number, number] }): EditResult {
    const p = this.doc.composer.placements.find((x) => x.id === id);
    if (!p) return fail('unknown');
    // a hosted piece rotates with its wall and is not scaled: its position comes from the wall
    if (p.host) return fail('opening');
    if ([...(rs.rotation ?? []), ...(rs.scale ?? [])].some((v) => !Number.isFinite(v))) return fail('bad-number');
    if (rs.scale?.some((v) => v === 0)) return fail('bad-number');
    const same = (a: number[] | undefined, b: number[] | undefined, def: number) =>
      [0, 1, 2].every((i) => Math.abs((a?.[i] ?? def) - (b?.[i] ?? def)) < 1e-9);
    const rotation = rs.rotation ?? p.rotation;
    const scale = rs.scale ?? p.scale;
    if (same(rotation, p.rotation, 0) && same(scale, p.scale, 1)) return OK;
    // neutral values are not saved: the file stays the same as without rotation or scale
    if (rotation && !same(rotation, undefined, 0)) p.rotation = [...rotation];
    else delete p.rotation;
    if (scale && !same(scale, undefined, 1)) p.scale = [...scale];
    else delete p.scale;
    this.dirty = true;
    return OK;
  }

  /** New level 3 m above the highest one, with the lowest free `Level N`. */
  addLevel(): LevelParams {
    const top = Math.max(...this.doc.levels.map((l) => l.elevation));
    const names = new Set(this.doc.levels.map((l) => l.name));
    let n = 1;
    while (names.has(`Level ${n}`)) n++;
    const level: LevelParams = { id: crypto.randomUUID(), name: `Level ${n}`, elevation: top + WALL_HEIGHT };
    this.doc.levels.push(level);
    this.dirty = true;
    return level;
  }

  renameLevel(id: string, name: string): EditResult {
    const level = levelById(this.doc.levels, id);
    if (!level) return fail('unknown');
    const next = name.trim();
    if (!next) return fail('empty-name');
    if (this.doc.levels.some((l) => l.id !== id && l.name === next)) return fail('duplicate-name');
    if (next !== level.name) {
      level.name = next;
      this.dirty = true;
    }
    return OK;
  }

  /** Changes the elevation; if some wall would end up with height <= 0 nothing changes. */
  setLevelElevation(id: string, elevation: number): EditResult {
    const level = levelById(this.doc.levels, id);
    if (!level) return fail('unknown');
    if (!Number.isFinite(elevation)) return fail('bad-number');
    if (elevation === level.elevation) return OK;
    const after = this.doc.levels.map((l) => (l.id === id ? { ...l, elevation } : l));
    if (this.doc.walls.some((w) => !(wallHeight(after, w) > 0))) return fail('wall-height');
    level.elevation = elevation;
    this.dirty = true;
    return OK;
  }

  /**
   * Cambia restricciones del muro: todo el parche o nada. Al pasar de nivel a Unconnected el muro
   * conserva su altura actual; al pasar a un nivel, Top Offset empieza en 0.
   */
  setWallConstraints(id: string, patch: WallPatch): EditResult {
    const w = this.doc.walls.find((x) => x.id === id);
    if (!w) return fail('unknown');
    const levels = this.doc.levels;
    for (const k of ['baseLevelId', 'topLevelId'] as const) {
      const v = patch[k];
      if (v != null && !levelById(levels, v)) return fail('unknown');
    }
    for (const k of ['baseOffset', 'topOffset', 'height'] as const) {
      const v = patch[k];
      if (v !== undefined && !Number.isFinite(v)) return fail('bad-number');
    }
    if (patch.height !== undefined && patch.height <= 0) return fail('bad-number');

    const next: WallParams = { ...w, ...patch };
    if (patch.topLevelId !== undefined) {
      if (w.topLevelId !== null && patch.topLevelId === null && patch.height === undefined) next.height = wallHeight(levels, w);
      if (w.topLevelId === null && patch.topLevelId !== null && patch.topOffset === undefined) next.topOffset = 0;
    }
    if (!(wallHeight(levels, next) > 0)) return fail('wall-height');

    const keys = ['baseLevelId', 'baseOffset', 'topLevelId', 'topOffset', 'height'] as const;
    if (keys.every((k) => next[k] === w[k])) return OK;
    Object.assign(w, next);
    this.dirty = true;
    return OK;
  }

  // --- Placements of linked files (the logic is in session/placements.ts) -------------------

  /** Is `id` an element of the document that can contain a linked file? */
  isPlaceTarget(id: string): boolean {
    return isPlaceTarget(this.doc, id);
  }

  placementOf(layerUri: string): Placement | undefined {
    return placementOf(this.doc, layerUri);
  }

  /** Always adds a NEW placement; null if the parent is not valid, there are no roots, or the host is not a wall. */
  addPlacement(
    layerUri: string,
    parentId: string,
    roots: string[],
    at?: { offset?: [number, number, number]; rotation?: [number, number, number]; host?: WallHost },
  ): Placement | null {
    const p = addPlacement(this.doc, layerUri, parentId, roots, at);
    if (p) this.dirty = true;
    return p;
  }

  /** Removes a placement by its id; false if it does not exist. */
  removePlacement(id: string): boolean {
    const removed = removePlacement(this.doc, id);
    if (removed) this.dirty = true;
    return removed;
  }

  /** Places the file under a parent: null if invalid, false if nothing changes, true if it changed. */
  place(layerUri: string, parentId: string, roots: string[], parentLayerUri?: string): boolean | null {
    const changed = placeFile(this.doc, layerUri, parentId, roots, parentLayerUri);
    if (changed) this.dirty = true;
    return changed;
  }

  /** Removes every placement of the file; false if there was none. */
  unplace(layerUri: string): boolean {
    const removed = unplaceFile(this.doc, layerUri);
    if (removed) this.dirty = true;
    return removed;
  }

  /** Moves the container of a placement (a hosted piece slides along its wall). */
  movePlacement(id: string, d: [number, number, number]): EditResult {
    const { result, changed } = movePlacement(this.doc, id, d);
    if (changed) this.dirty = true;
    return result;
  }

  async serialize(now: Date = new Date()): Promise<string> {
    return JSON.stringify(await toIfcx(this.doc, now.toISOString()), null, 2);
  }

  /** Text of the document the viewer composes (in a Studio document, what is saved). */
  async modelText(): Promise<string> {
    return this.serialize();
  }

  /** Escribe y solo entonces fija la ruta y limpia dirty; si falla, no cambia nada. */
  async saveTo(path: string): Promise<void> {
    await writeTextFile(path, await this.serialize());
    this.path = path;
    this.dirty = false;
  }
}

export function newSession(): EditSession {
  return new EditSession(newDocument());
}

/** Session from a Studio file; null if it is not one or it is damaged. It never throws. */
export function sessionFromFile(file: IfcxFile, path: string): EditSession | null {
  const info = { composerDamaged: false };
  const doc = fromIfcx(file, info);
  if (!doc) return null;
  const s = new EditSession(doc);
  s.path = path;
  s.composerDamaged = info.composerDamaged;
  return s;
}

export { documentModel, sessionModel } from './session/model';
