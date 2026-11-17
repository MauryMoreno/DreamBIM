import { describe, expect, it } from 'vitest';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { newDocument, type LevelParams, type StairParams, type StudioDoc, type WallParams } from '../src/modeling/document';
import { checkStair, placeStair, sameStack } from '../src/modeling/staircheck';
import { stairLayout } from '../src/modeling/stairlayout';

const FACADE = 0.3;

function baseDoc(levels = 2): { doc: StudioDoc; levels: LevelParams[] } {
  const d = newDocument();
  const order = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}`, elevation: i * 3, layout: 'a' }));
  const plan = (x: number, y: number) => [[x, y], [x + 10, y], [x + 10, y + 8], [x, y + 8]];
  const walls = [
    { from: [0, 0], to: [10, 0], thickness: FACADE },
    { from: [10, 0], to: [10, 8], thickness: FACADE },
    { from: [10, 8], to: [0, 8], thickness: FACADE },
    { from: [0, 8], to: [0, 0], thickness: FACADE },
  ];
  applyBuild(d, parseBuildRequest({ levels: order, layouts: { a: { walls, floors: [plan(0, 0)] } } }));
  return { doc: d, levels: d.levels };
}

function addWall(doc: StudioDoc, levelId: string, start: [number, number], end: [number, number], thickness = 0.15): WallParams {
  const w: WallParams = {
    id: crypto.randomUUID(), start, end, thickness, bodyId: crypto.randomUUID(), axisId: crypto.randomUUID(),
    baseLevelId: levelId, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
  };
  doc.walls.push(w);
  return w;
}

/** A 0.9 × 2.1 m door hosted at `along` from the start of the wall. */
function addDoor(doc: StudioDoc, wallId: string, along: number): void {
  doc.composer.placements.push({
    id: crypto.randomUUID(), layerUri: './door.ifcx', parentId: wallId, roots: ['Door'], offset: [0, 0, 0],
    host: { along, sill: 0, width: 0.9, height: 2.1 },
  });
}

const stair = (doc: StudioDoc, over: Partial<StairParams> = {}): StairParams => ({
  id: crypto.randomUUID(), baseLevelId: doc.levels[0].id, topLevelId: doc.levels[1].id,
  shape: 'u', origin: [3, 3], angle: 0, width: 1.1, ...over,
});

describe('checkStair', () => {
  it('a U in the center passes all the rules', () => {
    const { doc } = baseDoc();
    expect(checkStair(doc, stair(doc))).toBeNull();
  });

  it('una U pegada al muro oeste subiendo al norte pasa y lleva pasamanos', () => {
    const { doc } = baseDoc();
    const s = stair(doc, { origin: [0.7, 1.5], angle: 90, turn: 'right' });
    expect(checkStair(doc, s)).toBeNull();
    const placed = placeStair(doc, s);
    const kinds = placed.rails.map((r) => r.kind);
    expect(kinds).toContain('handrail');
    expect(kinds).toContain('guard');
  });

  it('a straight one that ends 0.5 m from the arrival wall collides', () => {
    const { doc } = baseDoc();
    addWall(doc, doc.levels[1].id, [7, 3], [7, 5]);
    const s = stair(doc, { shape: 'straight', origin: [2, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, s)).toMatch(/arrives against a wall/);
  });

  it('a straight one that starts 0.5 m from a wall has no space at the foot', () => {
    const { doc } = baseDoc();
    addWall(doc, doc.levels[0].id, [1, 3], [1, 5]);
    const s = stair(doc, { shape: 'straight', origin: [2, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, s)).toMatch(/bottom of the stair faces a wall/);
  });

  it('un tabique que atraviesa la escalera', () => {
    const { doc } = baseDoc();
    addWall(doc, doc.levels[0].id, [4, 3], [4, 5]);
    const s = stair(doc, { shape: 'straight', origin: [2, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, s)).toMatch(/runs into a wall/);
  });

  it('fuera del suelo', () => {
    const { doc } = baseDoc();
    const s = stair(doc, { shape: 'straight', origin: [20, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, s)).toMatch(/must stand on a floor/);
  });

  it('the opening would cut a partition of the upper level', () => {
    const { doc } = baseDoc();
    addWall(doc, doc.levels[1].id, [5, 3], [5, 5]);
    const s = stair(doc, { shape: 'straight', origin: [2, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, s)).toMatch(/would cut a wall/);
  });

  it('niveles que no son consecutivos', () => {
    const { doc } = baseDoc(3);
    const s = stair(doc, { baseLevelId: doc.levels[0].id, topLevelId: doc.levels[2].id });
    expect(checkStair(doc, s)).toMatch(/next one above/);
    expect(checkStair(doc, s)).toContain('Level 1 → Level 2');
  });

  it('dos escaleras solapadas', () => {
    const { doc } = baseDoc();
    const first = stair(doc, { shape: 'straight', origin: [2, 4], angle: 0, turn: undefined });
    doc.stairs.push(first);
    const second = stair(doc, { shape: 'straight', origin: [3, 4], angle: 0, turn: undefined });
    expect(checkStair(doc, second)).toMatch(/overlaps another stair/);
  });

  it('dos U apiladas en tres niveles se aceptan', () => {
    const { doc } = baseDoc(3);
    const first = stair(doc, { baseLevelId: doc.levels[0].id, topLevelId: doc.levels[1].id });
    expect(checkStair(doc, first)).toBeNull();
    doc.stairs.push(first);
    const second = stair(doc, { baseLevelId: doc.levels[1].id, topLevelId: doc.levels[2].id });
    expect(sameStack(first, second)).toBe(true);
    expect(checkStair(doc, second)).toBeNull();
  });

  it('la baranda del hueco no cruza el tramo de la escalera apilada encima', () => {
    for (const shape of ['u', 'straight'] as const) {
      const { doc } = baseDoc(3);
      const a = stair(doc, { shape, origin: [3, 3] });
      const alone = placeStair(doc, a).rails.filter((r) => r.where === 'opening').length;
      doc.stairs.push(a);
      doc.stairs.push(stair(doc, { shape, origin: [3, 3], baseLevelId: doc.levels[1].id, topLevelId: doc.levels[2].id }));
      const rails = placeStair(doc, a).rails.filter((r) => r.where === 'opening');
      // se quita solo el borde que atravesaba el primer tramo de la de arriba
      expect(rails).toHaveLength(alone - 1);
      const run = placeStair(doc, doc.stairs[1]).layout.flights[0].treads * 0.28;
      for (const r of rails) {
        const mx = (r.from[0] + r.to[0]) / 2 - 3;
        const my = (r.from[1] + r.to[1]) / 2 - 3;
        expect(mx > 1e-6 && mx < run - 1e-6 && Math.abs(my) < 0.55 - 1e-6).toBe(false);
      }
    }
  });

  it('una pieza colocada donde va el hueco estorba', () => {
    const { doc } = baseDoc();
    const s = stair(doc);
    const o = placeStair(doc, s).opening;
    const cx = (o[0][0] + o[2][0]) / 2;
    const cy = (o[0][1] + o[2][1]) / 2;
    doc.composer.placements.push({ id: 'p', layerUri: './x.ifcx', parentId: doc.levels[1].id, roots: ['r'], offset: [cx, cy, 0] });
    expect(checkStair(doc, s)).toBe('a placed piece is in the way');
  });

  it('una silla en la zona de llegada estorba', () => {
    const { doc } = baseDoc();
    doc.composer.placements.push({
      id: 'c', layerUri: './chair.ifcx', parentId: doc.levels[1].id, roots: ['C'], offset: [2.7, 4.2, 0],
    });
    expect(checkStair(doc, stair(doc))).toBe('a placed piece is in the way');
  });

  it('un borde del hueco pegado a la fachada no lleva baranda', () => {
    const { doc } = baseDoc();
    const s = stair(doc, { origin: [0.7, 1.5], angle: 90, turn: 'right' });
    const opening = placeStair(doc, s).rails.filter((r) => r.where === 'opening');
    expect(opening.length).toBeGreaterThan(0);
    const alongFacade = opening.some((r) => Math.abs(r.from[0] - 0.15) < 0.01 && Math.abs(r.to[0] - 0.15) < 0.01);
    expect(alongFacade).toBe(false);
  });

  it('the layout of a valid U matches stairLayout', () => {
    const { doc } = baseDoc();
    const s = stair(doc);
    expect(placeStair(doc, s).layout).toEqual(stairLayout(3, 'u', 1.1, 0.3));
  });

  it('a door facing the steps is not valid', () => {
    const { doc } = baseDoc();
    const wall = addWall(doc, doc.levels[0].id, [2, 5], [7, 5], 0.2);
    addDoor(doc, wall.id, 2);
    expect(checkStair(doc, stair(doc))).toBe('a door opens onto the stair');
  });

  it('the same door facing the clear zone at the foot is valid', () => {
    const { doc } = baseDoc();
    const wall = addWall(doc, doc.levels[0].id, [1.7, 2], [1.7, 5], 0.2);
    addDoor(doc, wall.id, 1);
    expect(checkStair(doc, stair(doc))).toBeNull();
  });
});
