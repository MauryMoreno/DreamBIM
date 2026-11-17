import { LEVEL_NAME } from '../constants';
import { polygonArea, type Vec2 } from '../footprint';
import { LevelParams, WallParams, FloorParams, StairParams, Placement, StudioDoc } from './types';
import { uuid } from './keys';

export const levelById = (levels: LevelParams[], id: string): LevelParams | undefined => levels.find((l) => l.id === id);

/** Copy sorted by elevation; at equal elevation it keeps the creation order. */
export function sortedLevels(levels: LevelParams[]): LevelParams[] {
  return levels.map((l, i) => ({ l, i })).sort((a, b) => a.l.elevation - b.l.elevation || a.i - b.i).map((x) => x.l);
}

/** Cota de la base del muro: cota del nivel base + Base Offset. NaN si el nivel no existe. */
export function wallBaseZ(levels: LevelParams[], w: WallParams): number {
  const base = levelById(levels, w.baseLevelId);
  return base ? base.elevation + w.baseOffset : NaN;
}

/** Altura resultante del muro. NaN si apunta a un nivel inexistente. */
export function wallHeight(levels: LevelParams[], w: WallParams): number {
  if (w.topLevelId === null) return w.height;
  const top = levelById(levels, w.topLevelId);
  return top ? top.elevation + w.topOffset - wallBaseZ(levels, w) : NaN;
}

/** Cota de la cara superior del suelo: cota del nivel + offset. NaN si el nivel no existe. */
export function floorTopZ(levels: LevelParams[], f: FloorParams): number {
  const level = levelById(levels, f.levelId);
  return level ? level.elevation + f.offset : NaN;
}

/** Area, perimeter and volume of a floor. */
export function floorQuantities(f: FloorParams): { area: number; perimeter: number; volume: number } {
  const area = Math.abs(polygonArea(f.boundary));
  let perimeter = 0;
  f.boundary.forEach((p, i) => {
    const q = f.boundary[(i + 1) % f.boundary.length];
    perimeter += Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  return { area, perimeter, volume: area * f.thickness };
}

export function newDocument(): StudioDoc {
  return {
    ids: { root: uuid(), project: uuid(), site: uuid(), building: uuid() },
    levels: [{ id: uuid(), name: LEVEL_NAME, elevation: 0 }],
    walls: [],
    floors: [],
    stairs: [],
    composer: { layers: [], placements: [] },
    overs: [],
    imports: [],
  };
}

/** Length, area and volume of a wall; `height` is the resulting height. */
export function wallQuantities(
  w: WallParams,
  footprint: Vec2[],
  height: number,
): { length: number; area: number; volume: number } {
  const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
  return { length, area: length * height, volume: polygonArea(footprint) * height };
}

/** Colocaciones alojadas en un muro del documento. */
export const hostsOf = (doc: Pick<StudioDoc, 'composer'>, wallId: string): Placement[] =>
  doc.composer.placements.filter((p) => p.parentId === wallId && p.host !== undefined);

/** The stair with that id, or the owner of one of its sub-ids (flights, landing and rails). */
export function stairOf(doc: Pick<StudioDoc, 'stairs'>, id: string): StairParams | undefined {
  return doc.stairs.find((s) => s.id === id || id.startsWith(`${s.id}-`));
}

/** Ids of the children of a stair: flights, landing and rails (their bodies hang from them). */
export function stairNodeIds(s: StairParams, flights: number, landing: boolean, rails: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < flights; i++) ids.push(`${s.id}-f${i + 1}`);
  if (landing) ids.push(`${s.id}-l`);
  for (let i = 0; i < rails; i++) ids.push(`${s.id}-r${i + 1}`);
  return ids;
}
