// Pasa el trazado de una escalera al mundo y lo valida contra niveles, muros, suelos y otras escaleras.
import {
  DOOR_MIN_HEIGHT,
  FLOOR_THICKNESS,
  STAIR_CLEAR,
} from './constants';
import {
  levelById, sortedLevels, type StairParams, type StudioDoc,
} from './document';
import type { Vec2 } from './footprint';
import { wallFootprints } from './footprint';
import { hostedOrigin, wallAngle } from './hosting';
import { convexOverlap, pointInPolygon, polygonContains, rectPolygon } from './plan2d';
import { stairLayout, type StairLayout } from './stairlayout';
import type { Vec3 } from '../composer/xform';

export interface PlacedStair {
  layout: StairLayout;
  baseZ: number;
  origin: Vec2;
  angle: number;
  footprint: Vec2[];
  bottomClear: Vec2[];
  topClear: Vec2[];
  opening: Vec2[];
  rails: { from: Vec3; to: Vec3; kind: 'guard' | 'handrail'; where: 'flight' | 'landing' | 'opening' }[];
}

const DEG = Math.PI / 180;
/** Tolerancia angular para considerar un lado paralelo a un muro (±1°). */
const PARALLEL_TOL = Math.sin(1 * DEG);
/** Slack of the wall-adjacency check, in meters. */
const WALL_GAP = 0.05;

const worldPoint = (p: Vec3, s: StairParams, baseZ: number): Vec3 => {
  const a = s.angle * DEG;
  const c = Math.cos(a);
  const t = Math.sin(a);
  return [s.origin[0] + p[0] * c - p[1] * t, s.origin[1] + p[0] * t + p[1] * c, baseZ + p[2]];
};

const worldRect = (r: { x0: number; x1: number; y0: number; y1: number }, s: StairParams): Vec2[] =>
  rectPolygon(r, s.origin, s.angle);

/** Elevation of the base level and of the arrival one, or the reason why they are not consecutive. */
function levelsOf(doc: StudioDoc, s: StairParams): { base: { id: string; name: string; elevation: number }; top: { id: string; name: string; elevation: number } } {
  const base = levelById(doc.levels, s.baseLevelId);
  const top = levelById(doc.levels, s.topLevelId);
  const ordered = sortedLevels(doc.levels);
  const pairs: string[] = [];
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i + 1].elevation > ordered[i].elevation) pairs.push(`${ordered[i].name} → ${ordered[i + 1].name}`);
  }
  const next = base ? ordered.find((l) => l.elevation > base.elevation) : undefined;
  if (!base || !top || !next || next.id !== top.id) {
    throw new Error(`stairs connect a level with the next one above (${pairs.length ? pairs.join(', ') : 'none'})`);
  }
  return { base, top };
}

/** Layout with the thickness of the arrival floor that contains the opening (or the generic one if there is none). */
function layoutFor(doc: StudioDoc, s: StairParams, topId: string, rise: number): StairLayout {
  let slab = FLOOR_THICKNESS;
  let layout = stairLayout(rise, s.shape, s.width, slab, s.turn);
  for (let i = 0; i < 2; i++) {
    const opening = worldRect(layout.opening, s);
    const floor = doc.floors.find((f) => f.levelId === topId && polygonContains(f.boundary, opening));
    const thickness = floor?.thickness ?? FLOOR_THICKNESS;
    if (thickness === slab) break;
    slab = thickness;
    layout = stairLayout(rise, s.shape, s.width, slab, s.turn);
  }
  return layout;
}

/** Does the plan segment lie entirely against (within <= thickness/2 + 5 cm) a parallel wall? */
function alongWall(from: Vec2, to: Vec2, walls: { start: Vec2; end: Vec2; thickness: number }[]): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return false;
  const dir: Vec2 = [dx / len, dy / len];
  for (const w of walls) {
    const wx = w.end[0] - w.start[0];
    const wy = w.end[1] - w.start[1];
    const wl = Math.hypot(wx, wy);
    if (wl < 1e-9) continue;
    const wd: Vec2 = [wx / wl, wy / wl];
    if (Math.abs(dir[0] * wd[1] - dir[1] * wd[0]) > PARALLEL_TOL) continue;
    const limit = w.thickness / 2 + WALL_GAP + 1e-9;
    const projection = (p: Vec2) => ((p[0] - w.start[0]) * wd[0] + (p[1] - w.start[1]) * wd[1]);
    const distance = (p: Vec2) => Math.abs((p[0] - w.start[0]) * wd[1] - (p[1] - w.start[1]) * wd[0]);
    if (distance(from) > limit || distance(to) > limit) continue;
    if (Math.min(projection(from), projection(to)) < -WALL_GAP) continue;
    if (Math.max(projection(from), projection(to)) > wl + WALL_GAP) continue;
    return true;
  }
  return false;
}

/**
 * Trazado en el mundo o Error con el motivo (niveles, altura, forma). No valida suelos ni muros;
 * it only decides which sides carry a railing or handrail.
 */
export function placeStair(doc: StudioDoc, s: StairParams): PlacedStair {
  const { base, top } = levelsOf(doc, s);
  const rise = top.elevation - base.elevation;
  const layout = layoutFor(doc, s, top.id, rise);
  const baseZ = base.elevation;
  const baseWalls = doc.walls.filter((w) => w.baseLevelId === base.id);
  const topWalls = doc.walls.filter((w) => w.baseLevelId === top.id);
  // Stair stacked on top (same position, starting where this one arrives): its first flight passes over the
  // opening, so a railing of the opening that crossed it would close its way.
  const above = doc.stairs.find((o) => o.id !== s.id && o.baseLevelId === top.id && sameStack(o, s));
  let aboveRun = 0;
  if (above) {
    const next = sortedLevels(doc.levels).find((l) => l.elevation > top.elevation);
    if (next && next.id === above.topLevelId) {
      try {
        const f = stairLayout(next.elevation - top.elevation, above.shape, above.width, FLOOR_THICKNESS, above.turn).flights[0];
        aboveRun = f.treads * layout.tread;
      } catch {
        aboveRun = 0;
      }
    }
  }
  const crossesAbove = (rail: StairLayout['rails'][number]): boolean => {
    if (!aboveRun) return false;
    const mx = (rail.from[0] + rail.to[0]) / 2;
    const my = (rail.from[1] + rail.to[1]) / 2;
    return mx > 1e-6 && mx < aboveRun - 1e-6 && Math.abs(my) < s.width / 2 - 1e-6;
  };
  const rails: PlacedStair['rails'] = [];
  for (const rail of layout.rails) {
    const from = worldPoint(rail.from, s, baseZ);
    const to = worldPoint(rail.to, s, baseZ);
    const a: Vec2 = [from[0], from[1]];
    const b: Vec2 = [to[0], to[1]];
    if (rail.where === 'opening') {
      if (crossesAbove(rail)) continue;
      if (alongWall(a, b, topWalls)) continue;
      rails.push({ from, to, kind: 'guard', where: rail.where });
    } else {
      rails.push({ from, to, kind: alongWall(a, b, baseWalls) ? 'handrail' : 'guard', where: rail.where });
    }
  }
  return {
    layout,
    baseZ,
    origin: [s.origin[0], s.origin[1]],
    angle: s.angle,
    footprint: worldRect(layout.footprint, s),
    bottomClear: worldRect(layout.bottomClear, s),
    topClear: worldRect(layout.topClear, s),
    opening: worldRect(layout.opening, s),
    rails,
  };
}

/** Same position, rotation, shape, width and flight rotation (the normal stacking). */
export function sameStack(a: StairParams, b: StairParams): boolean {
  const turn = (s: StairParams) => s.turn ?? 'left';
  return (
    Math.abs(a.origin[0] - b.origin[0]) < 1e-9 &&
    Math.abs(a.origin[1] - b.origin[1]) < 1e-9 &&
    Math.abs(a.angle - b.angle) < 1e-9 &&
    a.shape === b.shape &&
    Math.abs(a.width - b.width) < 1e-9 &&
    turn(a) === turn(b)
  );
}

/** Level a non-hosted placement belongs to (by where its point is in plan). */
function placementLevel(doc: StudioDoc, p: { parentId: string; parentLayerUri?: string }): string | null {
  if (p.parentLayerUri !== undefined) return null;
  if (levelById(doc.levels, p.parentId)) return p.parentId;
  return doc.walls.find((w) => w.id === p.parentId)?.baseLevelId ?? doc.floors.find((f) => f.id === p.parentId)?.levelId ?? null;
}

/** A door hosted in a wall of the level: center on the axis and a point on each side (0.3 m from the face). */
export interface DoorSides {
  wallId: string;
  center: Vec2;
  sides: [Vec2, Vec2];
  width: number;
}

/** Puertas (piezas alojadas a ras de piso de al menos DOOR_MIN_HEIGHT) de los muros de un nivel. */
export function doorSides(doc: StudioDoc, levelId: string): DoorSides[] {
  const out: DoorSides[] = [];
  for (const wall of doc.walls) {
    if (wall.baseLevelId !== levelId) continue;
    for (const p of doc.composer.placements) {
      if (p.parentId !== wall.id || !p.host) continue;
      const h = p.host;
      if (!(h.sill <= 0.01 && h.height >= DOOR_MIN_HEIGHT)) continue;
      const [cx, cy] = hostedOrigin(wall, h.along);
      const a = wallAngle(wall) * DEG;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const d = wall.thickness / 2 + 0.3;
      out.push({
        wallId: wall.id,
        center: [cx, cy],
        sides: [[cx + nx * d, cy + ny * d], [cx - nx * d, cy - ny * d]],
        width: h.width,
      });
    }
  }
  return out;
}

/** null if it meets all the rules; otherwise, the first reason in English. */
export function checkStair(doc: StudioDoc, s: StairParams): string | null {
  let placed: PlacedStair;
  let base: { id: string; name: string; elevation: number };
  let top: { id: string; name: string; elevation: number };
  try {
    const levels = levelsOf(doc, s);
    base = levels.base;
    top = levels.top;
    placed = placeStair(doc, s);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const C = Math.max(s.width, STAIR_CLEAR);
  const c = Number(C.toFixed(3));

  // 2 y 3: la escalera y sus zonas libres se apoyan en suelos de los dos niveles
  const baseFloors = doc.floors.filter((f) => f.levelId === base.id);
  if (!baseFloors.some((f) => polygonContains(f.boundary, placed.footprint) && polygonContains(f.boundary, placed.bottomClear))) {
    return `the stair and its landing space at the bottom must stand on a floor of ${base.name}`;
  }
  const topFloors = doc.floors.filter((f) => f.levelId === top.id);
  if (!topFloors.some((f) => polygonContains(f.boundary, placed.topClear) && polygonContains(f.boundary, placed.opening))) {
    return `the arrival space and the opening must be inside a floor of ${top.name}`;
  }

  // 4: la huella y el pie no se cruzan con muros del nivel base
  const baseFootprints = [...wallFootprints(doc.walls.filter((w) => w.baseLevelId === base.id)).values()];
  for (const fp of baseFootprints) if (convexOverlap(fp, placed.footprint)) return 'the stair runs into a wall';
  for (const fp of baseFootprints) {
    if (convexOverlap(fp, placed.bottomClear)) return `the bottom of the stair faces a wall: it needs ${c} m of clear floor`;
  }

  // 5: la llegada y el hueco no se cruzan con muros del nivel de llegada
  const topFootprints = [...wallFootprints(doc.walls.filter((w) => w.baseLevelId === top.id)).values()];
  for (const fp of topFootprints) {
    if (convexOverlap(fp, placed.topClear)) return `the stair arrives against a wall: it needs ${c} m of clear floor`;
  }
  for (const fp of topFootprints) if (convexOverlap(fp, placed.opening)) return `the floor opening would cut a wall of ${top.name}`;

  // 6: no se solapa con otra escalera (salvo el apilado normal entre niveles consecutivos)
  for (const other of doc.stairs) {
    if (other.id === s.id) continue;
    if (sameStack(s, other) && (other.topLevelId === s.baseLevelId || other.baseLevelId === s.topLevelId)) continue;
    let o: PlacedStair;
    try {
      o = placeStair(doc, other);
    } catch {
      continue;
    }
    const mineAt = (levelId: string) => [
      ...(levelId === base.id ? [placed.footprint, placed.bottomClear] : []),
      ...(levelId === top.id ? [placed.opening, placed.topClear] : []),
    ];
    const otherAt = (levelId: string) => [
      ...(other.baseLevelId === levelId ? [o.footprint, o.bottomClear] : []),
      ...(other.topLevelId === levelId ? [o.opening, o.topClear] : []),
    ];
    for (const levelId of new Set([base.id, top.id])) {
      const theirs = otherAt(levelId);
      if (!theirs.length) continue;
      if (mineAt(levelId).some((p) => theirs.some((q) => convexOverlap(p, q)))) return 'overlaps another stair';
    }
  }

  // 7: ninguna pieza colocada en el paso, al pie o a la llegada
  const zones = [
    { levelId: base.id, polys: [placed.footprint, placed.bottomClear] },
    { levelId: top.id, polys: [placed.topClear, placed.opening] },
  ];
  for (const p of doc.composer.placements) {
    if (p.host !== undefined) continue;
    const levelId = placementLevel(doc, p);
    if (!levelId) continue;
    const zone = zones.find((z) => z.levelId === levelId);
    if (!zone) continue;
    const point: Vec2 = [p.offset[0], p.offset[1]];
    if (zone.polys.some((poly) => pointInPolygon(point, poly))) return 'a placed piece is in the way';
  }

  // 8: no door of the base level opens onto the steps (it does onto the clear zone)
  for (const door of doorSides(doc, base.id)) {
    if (door.sides.some((p) => pointInPolygon(p, placed.footprint))) return 'a door opens onto the stair';
  }
  return null;
}
