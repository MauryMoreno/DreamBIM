// Assistant build request: reading, summary and application to a Studio document.
import { describe, expect, it } from 'vitest';
import { applyBuild, parseBuildRequest, summarizeBuild } from '../src/modeling/build';
import { fromIfcx, newDocument, toIfcx } from '../src/modeling/document';

interface Over {
  wall0?: unknown;
  topHeight?: number;
  levels?: unknown;
  layouts?: unknown;
  extraWalls?: unknown[];
  extraFloors?: unknown[];
}

/** Minimal valid request: 2 levels (0 and 3) with a floor plan `a` of 4 walls and a floor. */
function req(over: Over = {}) {
  const walls: unknown[] = [
    { from: [0, 0], to: [10, 0], thickness: 0.3 },
    { from: [10, 0], to: [10, 6], thickness: 0.3 },
    { from: [10, 6], to: [0, 6], thickness: 0.3 },
    { from: [0, 6], to: [0, 0], thickness: 0.3 },
    ...(over.extraWalls ?? []),
  ];
  if (over.wall0 !== undefined) walls[0] = over.wall0;
  const floors = [[[0, 0], [10, 0], [10, 6], [0, 6]], ...(over.extraFloors ?? [])];
  return {
    levels: over.levels ?? [
      { name: 'L1', elevation: 0, layout: 'a' },
      { name: 'L2', elevation: 3, height: over.topHeight ?? 3, layout: 'a' },
    ],
    layouts: over.layouts ?? { a: { walls, floors } },
  };
}

const parse = (args: unknown) => parseBuildRequest(args);

describe('build_model: read the request', () => {
  it('it reads a valid request and applies the default values', () => {
    const r = parseBuildRequest({ levels: [{ name: 'L1', elevation: 0, layout: 'a' }], layouts: { a: {} } });
    expect(r.fresh).toBe(true);
    expect(r.levels[0].height).toBe(3);
    expect(r.layouts.a).toEqual({ walls: [], floors: [] });
  });

  it('it rounds the coordinates to the millimeter', () => {
    const r = parse(req({ wall0: { from: [0.00049, 0], to: [10.0004, 0] } }));
    expect(r.layouts.a.walls[0]).toEqual({ from: [0, 0], to: [10, 0], thickness: 0.2 });
  });

  it.each([
    [{ levels: 'x' }, "build_model: 'levels' must be a non-empty array"],
    [{ levels: [], layouts: {} }, "build_model: 'levels' must be a non-empty array"],
    [{ levels: [{ name: 'L1', elevation: '0', layout: 'a' }], layouts: { a: {} } }, "build_model: levels[0]: 'elevation' must be a finite number"],
    [{ levels: [{ name: 'L1', elevation: 0, layout: 'zz' }], layouts: { a: {} } }, "build_model: levels[0]: unknown layout 'zz'"],
    [{ levels: [{ name: 'L1', elevation: 0, layout: 'a' }] }, "build_model: 'layouts' must be an object"],
  ])('rechaza %j', (args, message) => {
    expect(() => parse(args)).toThrow(message);
  });

  it('rechaza elevaciones no crecientes', () => {
    const levels = [
      { name: 'L1', elevation: 0, layout: 'a' },
      { name: 'L2', elevation: 0, layout: 'a' },
    ];
    expect(() => parse(req({ levels }))).toThrow("levels[1]: 'elevation' must be greater than the level below");
  });

  it('it rejects repeated names ignoring case', () => {
    const levels = [
      { name: 'l1', elevation: 0, layout: 'a' },
      { name: 'L1', elevation: 3, layout: 'a' },
    ];
    expect(() => parse(req({ levels }))).toThrow('levels[1]: duplicate level name');
  });

  it('it rejects a wall shorter than the joint tolerance', () => {
    expect(() => parse(req({ wall0: { from: [0, 0], to: [0.0005, 0] } }))).toThrow(
      'layouts.a.walls[0]: shorter than 0.001 m',
    );
  });

  it('rechaza un muro duplicado en sentido contrario', () => {
    expect(() => parse(req({ extraWalls: [{ from: [10, 0], to: [0, 0] }] }))).toThrow(
      'layouts.a.walls[4]: duplicate of walls[0]',
    );
  });

  it('rechaza un grosor fuera del rango', () => {
    expect(() => parse(req({ wall0: { from: [0, 0], to: [10, 0], thickness: 2 } }))).toThrow(
      "layouts.a.walls[0]: 'thickness' must be between 0.05 and 1",
    );
  });

  it('rechaza un suelo con menos de 3 puntos', () => {
    const layouts = { a: { walls: [], floors: [[[0, 0], [1, 1]]] } };
    expect(() => parse(req({ layouts }))).toThrow('layouts.a.floors[0]: needs at least 3 points');
  });

  it('it rejects a floor of null area', () => {
    const layouts = { a: { walls: [], floors: [[[0, 0], [1, 0], [2, 0]]] } };
    expect(() => parse(req({ layouts }))).toThrow('layouts.a.floors[0]: area is zero');
  });

  it('it rejects coordinates outside the limit', () => {
    expect(() => parse(req({ wall0: { from: [1e9, 0], to: [10, 0] } }))).toThrow(
      'layouts.a.walls[0]: coordinates must be within ±10000',
    );
  });

  it('it rejects more than 60 levels', () => {
    const levels = Array.from({ length: 61 }, (_, i) => ({ name: `L${i}`, elevation: i * 3, layout: 'a' }));
    expect(() => parse(req({ levels }))).toThrow('at most 60 levels');
  });

  it('it rejects more than 5000 walls already expanded per level', () => {
    const walls = Array.from({ length: 1001 }, (_, i) => ({ from: [i, 0], to: [i, 1] }));
    const levels = Array.from({ length: 5 }, (_, i) => ({ name: `L${i}`, elevation: i * 3, layout: 'a' }));
    expect(() => parse({ levels, layouts: { a: { walls } } })).toThrow('at most 5000 walls');
  });
});

describe('build_model: summary and application', () => {
  it('resume niveles, totales y huella', () => {
    expect(summarizeBuild(parseBuildRequest(req()))).toEqual({
      new: true,
      levels: [
        { name: 'L1', elevation: 0, walls: 4, floors: 1 },
        { name: 'L2', elevation: 3, walls: 4, floors: 1 },
      ],
      totals: { levels: 2, walls: 8, floors: 2 },
      footprint: { width: 10, depth: 6 },
    });
  });

  it('en un documento nuevo, el nivel por defecto pasa a ser el primero pedido', () => {
    const doc = newDocument();
    const id = doc.levels[0].id;
    const c = applyBuild(doc, parseBuildRequest(req()));
    expect(doc.levels.map((l) => l.name)).toEqual(['L1', 'L2']);
    expect(doc.levels[0].id).toBe(id);
    expect(c).toMatchObject({ levels: 2, walls: 8, floors: 2 });
    expect(c.levelIds).toEqual(doc.levels.map((l) => l.id));
  });

  it('it ties the walls to the level above and leaves the last one with its height', () => {
    const doc = newDocument();
    applyBuild(doc, parseBuildRequest(req({ topHeight: 3.5 })));
    const [l1, l2] = doc.levels;
    expect(doc.walls.filter((w) => w.baseLevelId === l1.id).every((w) => w.topLevelId === l2.id)).toBe(true);
    expect(
      doc.walls.filter((w) => w.baseLevelId === l2.id).every((w) => w.topLevelId === null && w.height === 3.5),
    ).toBe(true);
  });

  it('without `new`, it reuses an existing level by name and adds the others', () => {
    const doc = newDocument();
    doc.levels[0].name = 'L1';
    const id = doc.levels[0].id;
    const c = applyBuild(doc, parseBuildRequest({ ...req(), new: false }));
    expect(doc.levels.map((l) => l.name)).toEqual(['L1', 'L2']);
    expect(doc.levels[0].id).toBe(id);
    expect(c.levelIds[0]).toBe(id);
    expect(doc.walls).toHaveLength(8);
  });

  it('without `new`, it refuses if the level exists with another elevation and does not change the document', () => {
    const doc = newDocument();
    doc.levels[0].name = 'L1';
    doc.levels[0].elevation = 1;
    const before = structuredClone(doc);
    expect(() => applyBuild(doc, parseBuildRequest({ ...req(), new: false }))).toThrow('already exists at elevation 1');
    expect(doc).toEqual(before);
  });
});

/** El edificio del ejemplo: 5 niveles (0, 4, 7, 10, 13), planta baja y planta tipo de 30 x 15. */
function fiveStoreyRequest() {
  const facade = 0.3;
  const inner = 0.15;
  const ground = {
    walls: [
      { from: [0, 0], to: [15, 0], thickness: facade },
      { from: [15, 0], to: [30, 0], thickness: facade },
      { from: [30, 0], to: [30, 15], thickness: facade },
      { from: [30, 15], to: [15, 15], thickness: facade },
      { from: [15, 15], to: [0, 15], thickness: facade },
      { from: [0, 15], to: [0, 0], thickness: facade },
      { from: [15, 0], to: [15, 15], thickness: inner },
    ],
    floors: [[[0, 0], [30, 0], [30, 15], [0, 15]]],
  };
  const typical = {
    walls: [
      { from: [0, 0], to: [15, 0], thickness: facade },
      { from: [15, 0], to: [30, 0], thickness: facade },
      { from: [30, 0], to: [30, 6.5], thickness: facade },
      { from: [30, 6.5], to: [30, 8.5], thickness: facade },
      { from: [30, 8.5], to: [30, 15], thickness: facade },
      { from: [30, 15], to: [20, 15], thickness: facade },
      { from: [20, 15], to: [10, 15], thickness: facade },
      { from: [10, 15], to: [0, 15], thickness: facade },
      { from: [0, 15], to: [0, 8.5], thickness: facade },
      { from: [0, 8.5], to: [0, 6.5], thickness: facade },
      { from: [0, 6.5], to: [0, 0], thickness: facade },
      { from: [0, 6.5], to: [15, 6.5], thickness: inner },
      { from: [15, 6.5], to: [30, 6.5], thickness: inner },
      { from: [0, 8.5], to: [10, 8.5], thickness: inner },
      { from: [10, 8.5], to: [20, 8.5], thickness: inner },
      { from: [20, 8.5], to: [30, 8.5], thickness: inner },
      { from: [10, 8.5], to: [10, 15], thickness: inner },
      { from: [20, 8.5], to: [20, 15], thickness: inner },
      { from: [15, 0], to: [15, 6.5], thickness: inner },
    ],
    floors: [[[0, 0], [30, 0], [30, 15], [0, 15]]],
  };
  return {
    new: true,
    levels: [
      { name: 'L1', elevation: 0, height: 4, layout: 'ground' },
      { name: 'L2', elevation: 4, layout: 'typical' },
      { name: 'L3', elevation: 7, layout: 'typical' },
      { name: 'L4', elevation: 10, layout: 'typical' },
      { name: 'L5', elevation: 13, layout: 'typical' },
    ],
    layouts: { ground, typical },
  };
}

describe('build_model: ida y vuelta', () => {
  it('el edificio construido sobrevive a guardar y abrir', async () => {
    const doc = newDocument();
    applyBuild(doc, parseBuildRequest(fiveStoreyRequest()));
    const file = await toIfcx(doc, '2026-11-13T00:00:00.000Z');
    const back = fromIfcx(file);
    expect(back).not.toBeNull();
    expect(back!.levels.map((l) => [l.name, l.elevation])).toEqual(doc.levels.map((l) => [l.name, l.elevation]));
    expect(back!.walls).toHaveLength(doc.walls.length);
    expect(back!.floors).toHaveLength(doc.floors.length);
  });
});
