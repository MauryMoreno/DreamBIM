import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SCHEMAS, offlineFetcher } from '../src/model/schemas';
import { loadModel } from '../src/model/load';
import {
  newDocument, toIfcx, fromIfcx, wallQuantities, sortedLevels, wallHeight, wallBaseZ,
  floorQuantities, floorTopZ, hostsOf, hostedTransform, parseComposer,
  K_STAIR, stairNodeIds, stairOf,
  type FloorParams, type StairParams, type StudioDoc, type WallParams,
} from '../src/modeling/document';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { wallFootprints } from '../src/modeling/footprint';
import { FLOOR_TYPE_NAME, WALL_TYPE_NAME } from '../src/modeling/constants';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';

const T = '2026-01-01T00:00:00.000Z';

const muro = (over: Partial<WallParams> = {}): WallParams => ({
  id: crypto.randomUUID(), start: [0, 0], end: [4, 0], thickness: 0.2,
  bodyId: crypto.randomUUID(), axisId: crypto.randomUUID(), baseLevelId: 'sin-nivel', topLevelId: null, topOffset: 0,
  height: 3, baseOffset: 0, ...over,
});
const conMuro = (over: Partial<WallParams> = {}, elevation = 0): StudioDoc => {
  const d = newDocument();
  d.levels[0].elevation = elevation;
  d.walls.push(muro({ baseLevelId: d.levels[0].id, ...over }));
  return d;
};
const nodo = (f: IfcxFile, path: string): IfcxNode => f.data.find((n) => n.path === path)!;
const attr = (f: IfcxFile, path: string, k: string): any => nodo(f, path).attributes?.[k];

function volumen(points: number[][], idx: number[]): number {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = points[idx[i]], b = points[idx[i + 1]], c = points[idx[i + 2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe('documento ↔ IFCx', () => {
  it('empty document', async () => {
    const d = newDocument();
    const f = await toIfcx(d, T);
    const m = await loadModel('x', null, JSON.stringify(f), offlineFetcher);
    expect(m.warnings).toEqual([]);
    expect(attr(f, d.ids.project, 'bsi::ifc::class').code).toBe('IfcProject');
    expect(attr(f, d.ids.site, 'bsi::ifc::class').code).toBe('IfcSite');
    expect(attr(f, d.ids.building, 'bsi::ifc::class').code).toBe('IfcBuilding');
    expect(attr(f, d.ids.site, 'bsi::ifc::prop::Name')).toBe('Site');
    expect(attr(f, d.ids.building, 'bsi::ifc::prop::Name')).toBe('Building');
    expect(attr(f, d.levels[0].id, 'bsi::ifc::class').code).toBe('IfcBuildingStorey');
    expect(attr(f, d.levels[0].id, 'bsi::ifc::prop::Name')).toBe('Level 1');
    expect(attr(f, d.levels[0].id, 'ifcx-studio::level').elevation).toBe(0);
    expect(attr(f, d.ids.project, 'ifcx-studio::document').version).toBe(4);
  });

  it('muro serializado', async () => {
    const d = conMuro();
    const w = d.walls[0];
    const f = await toIfcx(d, T);
    const m = await loadModel('x', null, JSON.stringify(f), offlineFetcher);
    expect(m.warnings).toEqual([]);
    expect(nodo(f, d.levels[0].id).children).toHaveProperty(w.id);
    expect(attr(f, w.id, 'bsi::ifc::class').code).toBe('IfcWall');
    expect(attr(f, w.id, 'bsi::ifc::prop::TypeName')).toBe(WALL_TYPE_NAME);
    expect(attr(f, w.id, 'bsi::ifc::prop::Name')).toBe(WALL_TYPE_NAME);
    expect(attr(f, w.id, 'bsi::ifc::prop::Length')).toBeCloseTo(4);
    expect(attr(f, w.id, 'bsi::ifc::prop::Width')).toBeCloseTo(0.2);
    expect(attr(f, w.id, 'bsi::ifc::prop::Height')).toBeCloseTo(3);
    expect(attr(f, w.id, 'bsi::ifc::prop::NetSideArea')).toBeCloseTo(12);
    expect(attr(f, w.id, 'bsi::ifc::prop::NetVolume')).toBeCloseTo(2.4);
    expect(nodo(f, w.id).children).toEqual({ Body: w.bodyId, Axis: w.axisId });
    const mesh = attr(f, w.bodyId, 'usd::usdgeom::mesh');
    expect(mesh.points.length).toBeGreaterThan(0);
    expect(volumen(mesh.points, mesh.faceVertexIndices)).toBeGreaterThan(0);
    expect(attr(f, w.axisId, 'usd::usdgeom::basiscurves').points).toEqual([[0, 0, 0], [4, 0, 0]]);
  });

  it('cabecera', async () => {
    const f = await toIfcx(newDocument(), T);
    expect(f.header.ifcxVersion).toBe('ifcx_alpha');
    expect(f.header.author).toBe('Dream BIM');
    expect(f.header.timestamp).toBe(T);
    expect(f.imports.map((i) => i.uri)).toEqual(Object.keys(BUNDLED_SCHEMAS));
    expect(Object.keys(f.schemas).sort()).toEqual([
      'bsi::ifc::prop::GrossArea', 'bsi::ifc::prop::Height', 'bsi::ifc::prop::Length',
      'bsi::ifc::prop::NumberOfRiser', 'bsi::ifc::prop::NumberOfTreads', 'bsi::ifc::prop::Perimeter',
      'bsi::ifc::prop::PredefinedType', 'bsi::ifc::prop::RiserHeight', 'bsi::ifc::prop::TreadLength',
      'ifcx-studio::composer', 'ifcx-studio::document', 'ifcx-studio::floor', 'ifcx-studio::level',
      'ifcx-studio::stair', 'ifcx-studio::wall']);
  });

  it('ida y vuelta', async () => {
    const d = conMuro({}, 3);
    d.walls.push(muro({ baseLevelId: d.levels[0].id, start: [4, 0], end: [4, 5], height: 2.5, baseOffset: 0.5 }));
    const f = await toIfcx(d, T);
    const d2 = fromIfcx(JSON.parse(JSON.stringify(f)));
    expect(d2).toEqual(d);
    const f2 = await toIfcx(d2!, T);
    expect(f2).toEqual(f);
  });

  it('no es de Studio', () => {
    const p = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/hello-wall.ifcx');
    expect(fromIfcx(JSON.parse(readFileSync(p, 'utf8')))).toBeNull();
    expect(fromIfcx({} as any)).toBeNull();
    expect(fromIfcx(null as any)).toBeNull();
  });

  it('damaged', async () => {
    const d = conMuro();
    const w = d.walls[0];
    const base = await toIfcx(d, T);
    const copia = () => JSON.parse(JSON.stringify(base)) as IfcxFile;

    const a = copia();
    delete nodo(a, w.id).attributes!['ifcx-studio::wall'];
    expect(() => fromIfcx(a)).not.toThrow();
    expect(fromIfcx(a)).toBeNull();

    const b = copia();
    nodo(b, w.id).attributes!['ifcx-studio::wall'] = { ...(attr(b, w.id, 'ifcx-studio::wall')), start: 'x' };
    expect(fromIfcx(b)).toBeNull();

    const c = copia();
    nodo(c, w.id).attributes!['ifcx-studio::wall'] = { ...(attr(c, w.id, 'ifcx-studio::wall')), end: [1, NaN] };
    expect(fromIfcx(c)).toBeNull();

    const e = copia();
    e.data = e.data.filter((n) => n.path !== d.levels[0].id);
    expect(fromIfcx(e)).toBeNull();
  });

  it('cota', async () => {
    const d = conMuro({}, 3);
    const w = d.walls[0];
    const f = await toIfcx(d, T);
    const pts: number[][] = attr(f, w.bodyId, 'usd::usdgeom::mesh').points;
    expect(Math.min(...pts.map((p) => p[2]))).toBeCloseTo(3);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(6);
    expect(attr(f, w.axisId, 'usd::usdgeom::basiscurves').points.map((p: number[]) => p[2])).toEqual([3, 3]);
  });

  it('wallQuantities', () => {
    const w = muro();
    const fp = wallFootprints([w]).get(w.id)!;
    const q = wallQuantities(w, fp, 3);
    expect(q.length).toBeCloseTo(4);
    expect(q.area).toBeCloseTo(12);
    expect(q.volume).toBeCloseTo(2.4);
  });

  it('locationLine se escribe y es opcional al leer', async () => {
    const d = conMuro();
    const w = d.walls[0];
    const f = await toIfcx(d, T);
    expect(attr(f, w.id, 'ifcx-studio::wall').locationLine).toBe('Wall Centerline');
    expect(f.schemas['ifcx-studio::wall'].value.objectRestrictions!.values.locationLine.dataType).toBe('String');
    const g = JSON.parse(JSON.stringify(f)) as IfcxFile;
    delete attr(g, w.id, 'ifcx-studio::wall').locationLine;
    expect(fromIfcx(g)).toEqual(d);
  });

  it('baseOffset desplaza la malla en z', async () => {
    const d = conMuro({ baseOffset: 0.5 }, 3);
    const f = await toIfcx(d, T);
    const pts: number[][] = attr(f, d.walls[0].bodyId, 'usd::usdgeom::mesh').points;
    expect(Math.min(...pts.map((p) => p[2]))).toBeCloseTo(3.5);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(6.5);
  });

  describe('fromIfcx rechaza datos corruptos', () => {
    const casos: [string, (f: IfcxFile, d: StudioDoc) => void][] = [
      ['sin hijo Body', (f, d) => { delete nodo(f, d.walls[0].id).children!.Body; }],
      ['Body sin malla', (f, d) => { delete nodo(f, d.walls[0].bodyId).attributes!['usd::usdgeom::mesh']; }],
      ['Axis sin curva', (f, d) => { delete nodo(f, d.walls[0].axisId).attributes!['usd::usdgeom::basiscurves']; }],
      ['Body igual a Axis', (f, d) => { nodo(f, d.walls[0].id).children!.Axis = d.walls[0].bodyId; }],
      ['Body igual al muro', (f, d) => { nodo(f, d.walls[0].id).children!.Body = d.walls[0].id; }],
      ['Body compartido', (f, d) => { nodo(f, d.walls[1].id).children!.Body = d.walls[0].bodyId; }],
      ['muro duplicado', (f, d) => {
        const s = nodo(f, d.levels[0].id);
        s.children = { a: d.walls[0].id, b: d.walls[0].id };
      }],
      ['ruta repetida', (f, d) => { f.data.push({ path: d.walls[0].id, attributes: {} }); }],
      ['longitud cero', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').end = [0, 0]; }],
      ['espesor 0', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').thickness = 0; }],
      ['altura negativa', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').height = -1; }],
      ['versión errónea', (f, d) => { attr(f, d.ids.project, 'ifcx-studio::document').version = 6; }],
      ['topLevel que no es un nivel', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').topLevel = 'nope'; }],
      ['topLevel con altura resultante <= 0', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').topLevel = d.levels[0].id; }],
      ['topOffset no numérico', (f, d) => { attr(f, d.walls[0].id, 'ifcx-studio::wall').topOffset = 'x'; }],
      ['storey repetido en el edificio', (f, d) => {
        nodo(f, d.ids.building).children = { a: d.levels[0].id, b: d.levels[0].id };
      }],
      ['children no objeto', (f, d) => { (nodo(f, d.levels[0].id) as any).children = 'x'; }],
    ];
    for (const [nombre, dañar] of casos) {
      it(nombre, async () => {
        const d = conMuro();
        d.walls.push(muro({ baseLevelId: d.levels[0].id, start: [4, 0], end: [4, 5] }));
        const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
        expect(fromIfcx(f)).toEqual(d);
        dañar(f, d);
        expect(() => fromIfcx(f)).not.toThrow();
        expect(fromIfcx(f)).toBeNull();
      });
    }
  });
});

describe('niveles y restricciones de muro', () => {
  const tres = (): StudioDoc => {
    const d = newDocument();
    d.levels.push({ id: crypto.randomUUID(), name: 'Level 2', elevation: 3 });
    d.levels.push({ id: crypto.randomUUID(), name: 'Level 3', elevation: 6 });
    return d;
  };

  it('helpers de niveles', () => {
    const L = [
      { id: 'a', name: 'A', elevation: 3 },
      { id: 'b', name: 'B', elevation: 0 },
      { id: 'c', name: 'C', elevation: 0 },
    ];
    expect(sortedLevels(L).map((l) => l.name)).toEqual(['B', 'C', 'A']);
    expect(wallHeight(L, muro({ baseLevelId: 'b', height: 2.5 }))).toBe(2.5);
    expect(wallHeight(L, muro({ baseLevelId: 'b', baseOffset: 0.25, topLevelId: 'a', topOffset: -0.5 }))).toBeCloseTo(2.25);
    expect(wallHeight(L, muro({ baseLevelId: 'b', topLevelId: 'zz' }))).toBeNaN();
    expect(wallBaseZ(L, muro({ baseLevelId: 'a', baseOffset: 0.5 }))).toBe(3.5);
  });

  it('dos niveles con muros en ambos', async () => {
    const d = tres();
    const [l1, l2] = d.levels;
    d.walls.push(muro({ baseLevelId: l1.id }), muro({ baseLevelId: l2.id, start: [0, 5], end: [4, 5], height: 2.5 }));
    const [w1, w2] = d.walls;
    const f = await toIfcx(d, T);
    expect(Object.keys(nodo(f, d.ids.building).children!)).toEqual(d.levels.map((l) => l.id));
    expect(Object.keys(nodo(f, l1.id).children!)).toEqual([w1.id]);
    expect(Object.keys(nodo(f, l2.id).children!)).toEqual([w2.id]);
    expect(attr(f, w1.id, 'bsi::ifc::prop::Height')).toBeCloseTo(3);
    expect(attr(f, w2.id, 'bsi::ifc::prop::Height')).toBeCloseTo(2.5);
    const pts: number[][] = attr(f, w2.bodyId, 'usd::usdgeom::mesh').points;
    expect(Math.min(...pts.map((p) => p[2]))).toBeCloseTo(3);
    expect(Math.max(...pts.map((p) => p[2]))).toBeCloseTo(5.5);
  });

  it('muro atado a un nivel usa la altura resultante; el libre no escribe topLevel', async () => {
    const d = tres();
    d.walls.push(muro({ baseLevelId: d.levels[0].id, topLevelId: d.levels[1].id, topOffset: -0.5, height: 9 }));
    d.walls.push(muro({ baseLevelId: d.levels[0].id, start: [0, 5], end: [4, 5] }));
    const [atado, libre] = d.walls;
    const f = await toIfcx(d, T);
    expect(attr(f, atado.id, 'bsi::ifc::prop::Height')).toBeCloseTo(2.5);
    const sw = attr(f, atado.id, 'ifcx-studio::wall');
    expect(sw).toMatchObject({ topLevel: d.levels[1].id, topOffset: -0.5, height: 9 });
    const mesh = attr(f, atado.bodyId, 'usd::usdgeom::mesh');
    expect(volumen(mesh.points, mesh.faceVertexIndices)).toBeCloseTo(4 * 0.2 * 2.5);
    expect(attr(f, libre.id, 'ifcx-studio::wall')).not.toHaveProperty('topLevel');
  });

  it('saving, reopening and saving gives an identical file', async () => {
    const d = tres();
    const [l1, l2, l3] = d.levels;
    // interleaved on purpose: the file groups the walls by level
    d.walls.push(
      muro({ baseLevelId: l2.id, topLevelId: l3.id, topOffset: 0.5 }),
      muro({ baseLevelId: l1.id, start: [0, 5], end: [4, 5], baseOffset: 0.2 }),
      muro({ baseLevelId: l2.id, start: [0, 9], end: [4, 9], height: 2 }),
      muro({ baseLevelId: l1.id, start: [9, 0], end: [9, 4], topLevelId: l2.id }),
    );
    const f = await toIfcx(d, T);
    const d2 = fromIfcx(JSON.parse(JSON.stringify(f)));
    expect(d2).not.toBeNull();
    expect(d2!.levels).toEqual(d.levels);
    expect(JSON.stringify(await toIfcx(d2!, T))).toBe(JSON.stringify(f));
    expect(attr(f, d.ids.project, 'ifcx-studio::document').version).toBe(4);
  });

  it('migrates a version 1 file', async () => {
    const d = conMuro({ height: 2.5, baseOffset: 0.5 });
    const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
    attr(f, d.ids.project, 'ifcx-studio::document').version = 1;
    delete attr(f, d.walls[0].id, 'ifcx-studio::wall').topOffset;
    const d2 = fromIfcx(f);
    expect(d2).toEqual(d);
    const f2 = await toIfcx(d2!, T);
    expect(attr(f2, d.ids.project, 'ifcx-studio::document').version).toBe(4);
    expect(attr(f2, d.walls[0].id, 'ifcx-studio::wall').topOffset).toBe(0);
  });
});

describe('huellas por nivel', () => {
  const dosNiveles = () => {
    const d = newDocument();
    d.levels.push({ id: crypto.randomUUID(), name: 'Level 2', elevation: 3 });
    const [l1, l2] = d.levels;
    const A = muro({ baseLevelId: l1.id, start: [0, 0], end: [4, 0] });
    const B = muro({ baseLevelId: l1.id, start: [4, 0], end: [4, 4] });
    const C = muro({ baseLevelId: l2.id, start: [4, 0], end: [8, 0] });
    return { d, A, B, C };
  };
  const puntos = (f: IfcxFile, w: WallParams): number[][] => attr(f, w.bodyId, 'usd::usdgeom::mesh').points;

  it('muros apilados en el mismo XY no se unen en inglete', async () => {
    const { d, A, B, C } = dosNiveles();
    d.walls.push(A, B, C);
    const f = await toIfcx(d, T);

    const solo = newDocument();
    solo.levels[0].id = d.levels[0].id;
    solo.walls.push(A, B);
    const f1 = await toIfcx(solo, T);

    expect(puntos(f, A)).toEqual(puntos(f1, A));
    expect(puntos(f, B)).toEqual(puntos(f1, B));
    const mesh = attr(f, C.bodyId, 'usd::usdgeom::mesh');
    expect(volumen(mesh.points, mesh.faceVertexIndices)).toBeCloseTo(4 * 0.2 * 3); // extremos rectos
  });

  it('dos muros unidos en el mismo nivel siguen con inglete', async () => {
    const { d, A, B } = dosNiveles();
    d.walls.push(A, B);
    const unidos = await toIfcx(d, T);
    const suelto = newDocument();
    suelto.levels[0].id = d.levels[0].id;
    suelto.walls.push(A);
    expect(puntos(unidos, A)).not.toEqual(puntos(await toIfcx(suelto, T), A));
  });
});

describe('suelos', () => {
  const suelo = (over: Partial<FloorParams> = {}): FloorParams => ({
    id: crypto.randomUUID(), bodyId: crypto.randomUUID(), levelId: 'sin-nivel', offset: 0, thickness: 0.3,
    boundary: [[0, 0], [4, 0], [4, 3], [0, 3]], ...over,
  });
  const conSuelo = (over: Partial<FloorParams> = {}, elevation = 3): StudioDoc => {
    const d = conMuro({}, elevation);
    d.floors.push(suelo({ levelId: d.levels[0].id, ...over }));
    return d;
  };

  it('un documento nuevo no tiene suelos', () => {
    expect(newDocument().floors).toEqual([]);
  });

  it('se serializa como IfcSlab FLOOR colgado de su nivel, con cantidades', async () => {
    const d = conSuelo();
    const fl = d.floors[0];
    const f = await toIfcx(d, T);
    expect(Object.values(nodo(f, d.levels[0].id).children!)).toContain(fl.id);
    expect(attr(f, fl.id, 'bsi::ifc::class').code).toBe('IfcSlab');
    expect(attr(f, fl.id, 'bsi::ifc::prop::PredefinedType')).toBe('FLOOR');
    expect(attr(f, fl.id, 'bsi::ifc::prop::Name')).toBe(FLOOR_TYPE_NAME);
    expect(attr(f, fl.id, 'bsi::ifc::prop::TypeName')).toBe(FLOOR_TYPE_NAME);
    expect(attr(f, fl.id, 'bsi::ifc::prop::GrossArea')).toBeCloseTo(12);
    expect(attr(f, fl.id, 'bsi::ifc::prop::NetArea')).toBeCloseTo(12);
    expect(attr(f, fl.id, 'bsi::ifc::prop::Perimeter')).toBeCloseTo(14);
    expect(attr(f, fl.id, 'bsi::ifc::prop::NetVolume')).toBeCloseTo(3.6);
    expect(attr(f, fl.id, 'bsi::ifc::prop::Width')).toBe(0.3);
    expect(attr(f, fl.id, 'ifcx-studio::floor')).toEqual({ boundary: fl.boundary, thickness: 0.3, offset: 0 });
  });

  it('la malla va desde la cara superior (cota + offset) hacia abajo', async () => {
    const d = conSuelo({ offset: 0.1 });
    const f = await toIfcx(d, T);
    const m = attr(f, d.floors[0].bodyId, 'usd::usdgeom::mesh');
    const z = m.points.map((p: number[]) => p[2]);
    expect(Math.min(...z)).toBeCloseTo(2.8);
    expect(Math.max(...z)).toBeCloseTo(3.1);
    expect(volumen(m.points, m.faceVertexIndices)).toBeCloseTo(3.6);
    expect(floorTopZ(d.levels, d.floors[0])).toBeCloseTo(3.1);
    expect(floorTopZ(d.levels, suelo({ levelId: 'nope' }))).toBeNaN();
  });

  it('floorQuantities', () => {
    const q = floorQuantities(suelo());
    expect(q.area).toBeCloseTo(12);
    expect(q.perimeter).toBeCloseTo(14);
    expect(q.volume).toBeCloseTo(3.6);
  });

  it('ida y vuelta con muros y suelos', async () => {
    const d = conSuelo({ offset: -0.05 });
    const f = await toIfcx(d, T);
    const d2 = fromIfcx(JSON.parse(JSON.stringify(f)));
    expect(d2).toEqual(d);
    expect(await toIfcx(d2!, T)).toEqual(f);
  });

  it('a version 2 file (without floors) is still read', async () => {
    const f = JSON.parse(JSON.stringify(await toIfcx(conMuro(), T))) as IfcxFile;
    attr(f, f.data.find((n) => n.attributes?.['ifcx-studio::document'])!.path, 'ifcx-studio::document').version = 2;
    const d2 = fromIfcx(f);
    expect(d2?.walls).toHaveLength(1);
    expect(d2?.floors).toEqual([]);
  });

  describe('fromIfcx rechaza suelos corruptos', () => {
    const casos: [string, (f: IfcxFile, d: StudioDoc) => void][] = [
      ['contorno de 2 puntos', (f, d) => { attr(f, d.floors[0].id, 'ifcx-studio::floor').boundary = [[0, 0], [1, 0]]; }],
      ['contorno con punto no numérico', (f, d) => { attr(f, d.floors[0].id, 'ifcx-studio::floor').boundary[1] = ['x', 0]; }],
      ['contorno de área cero', (f, d) => { attr(f, d.floors[0].id, 'ifcx-studio::floor').boundary = [[0, 0], [1, 0], [2, 0]]; }],
      ['espesor 0', (f, d) => { attr(f, d.floors[0].id, 'ifcx-studio::floor').thickness = 0; }],
      ['offset no numérico', (f, d) => { attr(f, d.floors[0].id, 'ifcx-studio::floor').offset = 'x'; }],
      ['sin atributo de Studio', (f, d) => { delete nodo(f, d.floors[0].id).attributes!['ifcx-studio::floor']; }],
      ['sin hijo Body', (f, d) => { delete nodo(f, d.floors[0].id).children!.Body; }],
      ['Body sin malla', (f, d) => { delete nodo(f, d.floors[0].bodyId).attributes!['usd::usdgeom::mesh']; }],
      ['Body compartido con un muro', (f, d) => { nodo(f, d.floors[0].id).children!.Body = d.walls[0].bodyId; }],
      ['suelo duplicado', (f, d) => {
        nodo(f, d.levels[0].id).children = { a: d.walls[0].id, b: d.floors[0].id, c: d.floors[0].id };
      }],
    ];
    for (const [nombre, dañar] of casos) {
      it(nombre, async () => {
        const d = conSuelo();
        const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
        expect(fromIfcx(f)).toEqual(d);
        dañar(f, d);
        expect(() => fromIfcx(f)).not.toThrow();
        expect(fromIfcx(f)).toBeNull();
      });
    }
  });
});

describe('composer', () => {
  const U1 = 'capas/estructura.ifcx';
  const U2 = 'capas/instalaciones.ifcx';
  /** Document with 2 layers (one with edits) and a placement on a level at elevation 3. */
  const conComposer = (): StudioDoc => {
    const d = newDocument();
    d.levels[0].elevation = 3;
    d.composer = {
      layers: [
        {
          uri: U1, name: 'Estructura', color: '#3182bd', enabled: true, editsEnabled: false,
          edits: [{ path: 'abc', attributes: { 'bsi::ifc::prop::Name': 'Editado' } }],
        },
        { uri: U2, name: 'Instalaciones', color: '#31a354', enabled: false, editsEnabled: true, edits: [] },
      ],
      placements: [
        { id: crypto.randomUUID(), layerUri: U1, parentId: d.levels[0].id, roots: ['r1', 'r2'], offset: [1, 2, 0] },
      ],
    };
    return d;
  };
  const clonar = (f: IfcxFile) => JSON.parse(JSON.stringify(f)) as IfcxFile;

  it('new document: empty composer', () => {
    expect(newDocument().composer).toEqual({ layers: [], placements: [] });
  });

  it('ida y vuelta del composer', async () => {
    const d = conComposer();
    const f = clonar(await toIfcx(d, T));
    expect(attr(f, d.ids.project, 'ifcx-studio::composer')).toEqual(d.composer);
    const d2 = fromIfcx(f);
    expect(d2).not.toBeNull();
    expect(d2!.composer).toEqual(d.composer);
    expect(d2).toEqual(d);
    expect(d2!.walls).toEqual([]);
    expect(JSON.stringify(await toIfcx(d2!, T))).toBe(JSON.stringify(f));
  });

  it('the linked imports go after the schemas, in order', async () => {
    const d = conComposer();
    const f = await toIfcx(d, T);
    const base = Object.keys(BUNDLED_SCHEMAS);
    expect(f.imports.map((i) => i.uri)).toEqual([...base, U1, U2]);
  });

  it('el contenedor sigue a su nivel', async () => {
    const d = conComposer();
    const id = d.composer.placements[0].id;
    let f = await toIfcx(d, T);
    expect(nodo(f, id).children).toEqual({ r1: 'r1', r2: 'r2' });
    expect(attr(f, id, 'bsi::ifc::prop::Name')).toBe('Linked · Estructura');
    expect(nodo(f, d.levels[0].id).children![id]).toBe(id);
    expect(attr(f, id, 'usd::xformop').transform.at(-1)).toEqual([1, 2, 3, 1]);
    d.levels[0].elevation = 5;
    f = await toIfcx(d, T);
    expect(attr(f, id, 'usd::xformop').transform.at(-1)).toEqual([1, 2, 5, 1]);
  });

  it('placement in the project: without a level elevation', async () => {
    const d = conComposer();
    d.composer.placements[0].parentId = d.ids.project;
    const id = d.composer.placements[0].id;
    const f = clonar(await toIfcx(d, T));
    expect(nodo(f, d.ids.project).children![id]).toBe(id);
    expect(attr(f, id, 'usd::xformop').transform).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [1, 2, 0, 1]]);
    expect(fromIfcx(f)).toEqual(d);
  });

  it('a version 3 file opens with an empty composer', async () => {
    const d = conMuro();
    const f = clonar(await toIfcx(d, T));
    attr(f, d.ids.project, 'ifcx-studio::document').version = 3;
    delete f.data.find((n) => n.path === d.ids.project)!.attributes!['ifcx-studio::composer'];
    const d2 = fromIfcx(f);
    expect(d2).toEqual(d);
    expect(d2!.composer).toEqual({ layers: [], placements: [] });
  });

  it('a malformed composer is treated as empty and the document is still valid', async () => {
    const malos: unknown[] = [
      'x', 5, null, [],
      { layers: [{ name: 'sin uri' }], placements: [] },
      { layers: 'x', placements: [] },
    ];
    for (const malo of malos) {
      const d = conMuro();
      const f = clonar(await toIfcx(d, T));
      f.data.find((n) => n.path === d.ids.project)!.attributes!['ifcx-studio::composer'] = malo as never;
      const d2 = fromIfcx(f);
      expect(d2).toEqual(d);
      expect(d2!.composer).toEqual({ layers: [], placements: [] });
    }
  });

  it('damaged composer with containers on a level: the document is still valid', async () => {
    const d = conComposer();
    d.walls.push(muro({ baseLevelId: d.levels[0].id }));
    const f = clonar(await toIfcx(d, T));
    expect(nodo(f, d.levels[0].id).children![d.composer.placements[0].id]).toBeDefined();
    attr(f, d.ids.project, 'ifcx-studio::composer').layers = [{ name: 'sin uri' }];
    const d2 = fromIfcx(f);
    expect(d2).not.toBeNull();
    expect(d2!.composer).toEqual({ layers: [], placements: [] });
    expect(d2!.walls).toEqual(d.walls);
  });

  it('un hijo de nivel sin marcas que no es contenedor invalida el documento', async () => {
    const d = conComposer();
    d.walls.push(muro({ baseLevelId: d.levels[0].id }));
    const f = clonar(await toIfcx(d, T));
    expect(fromIfcx(clonar(f))).toEqual(d);
    // a wall that lost its class and its data, with a valid composer
    const w = nodo(f, d.walls[0].id);
    w.attributes = { [`bsi::ifc::prop::Name`]: 'Basic Wall' };
    expect(fromIfcx(f)).toBeNull();
    // the same with a damaged composer: it is not a container either
    attr(f, d.ids.project, 'ifcx-studio::composer').layers = [{ name: 'sin uri' }];
    expect(fromIfcx(f)).toBeNull();
  });

  it('with a valid composer, a child shaped like a container that is not listed invalidates the document', async () => {
    const d = conComposer();
    const f = clonar(await toIfcx(d, T));
    const intruso = crypto.randomUUID();
    f.data.push({
      path: intruso,
      attributes: { 'bsi::ifc::prop::Name': 'Linked · intruso', 'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] } },
    });
    nodo(f, d.levels[0].id).children![intruso] = intruso;
    expect(fromIfcx(f)).toBeNull();
  });

  it('session fields of the layers (id) are not serialized', async () => {
    const d = conComposer();
    (d.composer.layers[0] as unknown as { id: string }).id = 'sesion-1';
    const f = await toIfcx(d, T);
    const guardado = attr(f, d.ids.project, 'ifcx-studio::composer');
    expect(guardado.layers[0]).not.toHaveProperty('id');
    expect(Object.keys(guardado.layers[0]).sort()).toEqual(['color', 'edits', 'editsEnabled', 'enabled', 'name', 'uri']);
  });

  it('placements do not count as Studio elements', async () => {
    const d = conComposer();
    const f = clonar(await toIfcx(d, T));
    const d2 = fromIfcx(f)!;
    expect(d2.walls).toEqual([]);
    expect(d2.floors).toEqual([]);
    expect(d2.levels).toEqual(d.levels);
  });

  it('a placement whose level no longer exists moves to the project on save (the document is still valid)', async () => {
    const d = conComposer();
    const p = d.composer.placements[0];
    p.parentId = 'nivel-borrado';
    const f = clonar(await toIfcx(d, T));
    expect(nodo(f, d.ids.project).children![p.id]).toBe(p.id);
    expect(attr(f, p.id, 'usd::xformop').transform.at(-1)).toEqual([1, 2, 0, 1]);
    const d2 = fromIfcx(f);
    expect(d2).not.toBeNull();
    expect(d2!.composer.layers).toEqual(d.composer.layers);
    expect(d2!.composer.placements).toEqual([{ ...p, parentId: d.ids.project }]);
  });

  it('a placement of a layer that is no longer there is not saved', async () => {
    const d = conComposer();
    d.composer.placements[0].layerUri = 'capas/quitada.ifcx';
    const id = d.composer.placements[0].id;
    const f = clonar(await toIfcx(d, T));
    expect(f.data.some((n) => n.path === id)).toBe(false);
    expect(nodo(f, d.levels[0].id).children![id]).toBeUndefined();
    expect(attr(f, d.ids.project, 'ifcx-studio::composer').placements).toEqual([]);
    expect(fromIfcx(f)!.composer.layers).toEqual(d.composer.layers);
  });

  it('when reading, a placement with an invalid parent or layer does not discard the composer', async () => {
    const d = conComposer();
    const f = clonar(await toIfcx(d, T));
    const p = d.composer.placements[0];
    // a mano: el padre no existe (pasa al proyecto)
    attr(f, d.ids.project, 'ifcx-studio::composer').placements[0].parentId = 'otro';
    let d2 = fromIfcx(clonar(f));
    expect(d2).not.toBeNull();
    expect(d2!.composer.layers).toEqual(d.composer.layers);
    expect(d2!.composer.placements).toEqual([{ ...p, parentId: d.ids.project }]);
    // the layer does not exist: the placement is removed, but its container on the level does not invalidate the document
    attr(f, d.ids.project, 'ifcx-studio::composer').placements[0].parentId = p.parentId;
    attr(f, d.ids.project, 'ifcx-studio::composer').placements[0].layerUri = 'nada.ifcx';
    d2 = fromIfcx(f);
    expect(d2).not.toBeNull();
    expect(d2!.composer.layers).toEqual(d.composer.layers);
    expect(d2!.composer.placements).toEqual([]);
  });

  it('the container of a disabled layer does not carry its roots', async () => {
    const d = conComposer();
    d.composer.layers[0].enabled = false;
    const f = clonar(await toIfcx(d, T));
    expect(nodo(f, d.composer.placements[0].id).children).toEqual({});
    expect(fromIfcx(f)).toEqual(d);
  });
});

describe('piezas alojadas en muros', () => {
  const U = './door.ifcx';
  const conPieza = (over: Partial<WallParams> = {}) => {
    const d = newDocument();
    const w = muro({ baseLevelId: d.levels[0].id, ...over });
    d.walls.push(w);
    d.composer = {
      layers: [{ uri: U, name: 'door.ifcx', color: '', enabled: true, editsEnabled: true, edits: [] }],
      placements: [
        {
          id: 'c1', layerUri: U, parentId: w.id, roots: ['r'], offset: [0, 0, 0],
          host: { along: 2, sill: 0, width: 1, height: 2 },
        },
      ],
    };
    return { d, w };
  };
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]));

  it('the hosted container is placed on the axis of the wall, rotated with it', async () => {
    let f = await toIfcx(conPieza().d, T);
    let t = attr(f, 'c1', 'usd::xformop').transform;
    near(t[3], [2, 0, 0, 1]);
    near(t[0], [1, 0, 0, 0]);
    const vertical = conPieza({ start: [0, 0], end: [0, 4] }).d;
    f = await toIfcx(vertical, T);
    t = attr(f, 'c1', 'usd::xformop').transform;
    near(t[0], [0, 1, 0, 0]);
    near(t[3], [0, 2, 0, 1]);
  });

  it('hostedTransform usa el antepecho y la base del muro', () => {
    const { d, w } = conPieza({ baseOffset: 3 });
    near(hostedTransform(w, 3, { along: 1, sill: 0.9, width: 1, height: 1 })[3], [1, 0, 3.9, 1]);
    expect(hostsOf(d, w.id)).toHaveLength(1);
    expect(hostsOf(d, d.levels[0].id)).toEqual([]);
  });

  it('el muro pierde el volumen del hueco', async () => {
    const { d, w } = conPieza();
    const f = await toIfcx(d, T);
    expect(attr(f, w.id, 'bsi::ifc::prop::NetVolume')).toBeCloseTo(4 * 0.2 * 3 - 1 * 0.2 * 2);
    expect(attr(f, w.id, 'bsi::ifc::prop::NetSideArea')).toBeCloseTo(12 - 2);
    expect(Object.values(nodo(f, w.id).children!)).toContain('c1');
    const mesh = attr(f, w.bodyId, 'usd::usdgeom::mesh');
    expect(Math.abs(volumen(mesh.points, mesh.faceVertexIndices))).toBeCloseTo(4 * 0.2 * 3 - 1 * 0.2 * 2, 5);
  });

  it('ida y vuelta: fromIfcx(toIfcx(doc)) conserva host', async () => {
    const { d } = conPieza();
    const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
    const d2 = fromIfcx(f)!;
    expect(d2.composer.placements[0].host).toEqual({ along: 2, sill: 0, width: 1, height: 2 });
    expect(await toIfcx(d2, T)).toEqual(f);
  });

  it('sin muro, la pieza alojada no se guarda', async () => {
    const { d } = conPieza();
    d.walls = [];
    const f = await toIfcx(d, T);
    expect(f.data.some((n) => n.path === 'c1')).toBe(false);
    expect(attr(f, d.ids.project, 'ifcx-studio::composer').placements).toEqual([]);
    expect(fromIfcx(JSON.parse(JSON.stringify(f)))!.composer.placements).toEqual([]);
  });

  it('a malformed host damages the composer', () => {
    const layer = { uri: U };
    const base = { id: 'c1', layerUri: U, parentId: 'w', roots: ['r'], offset: [0, 0, 0] };
    expect(parseComposer({ layers: [layer], placements: [{ ...base, host: { along: 2, sill: 0, width: 1, height: 2 } }] })).not.toBeNull();
    expect(parseComposer({ layers: [layer], placements: [{ ...base, host: { along: 'x', sill: 0, width: 1, height: 2 } }] })).toBeNull();
    expect(parseComposer({ layers: [layer], placements: [{ ...base, host: { along: 2, sill: 0, width: 0, height: 2 } }] })).toBeNull();
    expect(parseComposer({ layers: [layer], placements: [{ ...base, host: { along: 2, sill: 0, width: 1, height: 0 } }] })).toBeNull();
  });

  it('un documento sin host se lee como antes', async () => {
    const d = newDocument();
    d.composer = {
      layers: [{ uri: U, name: 'door.ifcx', color: '', enabled: true, editsEnabled: true, edits: [] }],
      placements: [{ id: 'c1', layerUri: U, parentId: d.levels[0].id, roots: ['r'], offset: [1, 2, 0] }],
    };
    const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
    const d2 = fromIfcx(f)!;
    expect(d2.composer.placements[0]).toEqual(d.composer.placements[0]);
    expect(d2.composer.placements[0]).not.toHaveProperty('host');
  });
});

describe('capa over e imports del documento', () => {
  it('ida y vuelta: los overs y los imports propios se guardan y se leen', async () => {
    const d = conMuro();
    const wall = d.walls[0].id;
    d.overs = [
      { path: 'M1', attributes: { 'bsi::ifc::material': { code: 'X' } } },
      { path: wall, inherits: { material: 'M1' } },
    ];
    d.imports = ['../materiales.ifcx'];
    const file = await toIfcx(d, T);
    expect(file.imports?.map((i) => i.uri)).toContain('../materiales.ifcx');
    const back = fromIfcx(JSON.parse(JSON.stringify(file)))!;
    expect(back.overs).toEqual(d.overs);
    expect(back.imports).toEqual(['../materiales.ifcx']);
    expect(back.walls.map((w) => w.id)).toEqual([wall]);
  });

  it('a document saved without these fields is read with empty lists', async () => {
    const back = fromIfcx(JSON.parse(JSON.stringify(await toIfcx(conMuro(), T))))!;
    expect(back.overs).toEqual([]);
    expect(back.imports).toEqual([]);
  });

  it('an over on a document node is composed on top of it', async () => {
    const d = conMuro();
    const wall = d.walls[0].id;
    d.overs = [{ path: wall, attributes: { 'bsi::ifc::prop::Name': 'Otro' } }];
    const file = await toIfcx(d, T);
    const model = await loadModel('t', null, JSON.stringify(file), offlineFetcher);
    expect(model.result.byOrigin.get(wall)![0].attributes['bsi::ifc::prop::Name']).toBe('Otro');
  });
});

describe('escaleras', () => {
  const conEscalera = (shape: 'straight' | 'u' = 'u', levels = 2) => {
    const d = newDocument();
    const order = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}`, elevation: i * 3, layout: 'a' }));
    const walls = [
      { from: [0, 0], to: [10, 0], thickness: 0.3 },
      { from: [10, 0], to: [10, 8], thickness: 0.3 },
      { from: [10, 8], to: [0, 8], thickness: 0.3 },
      { from: [0, 8], to: [0, 0], thickness: 0.3 },
    ];
    applyBuild(d, parseBuildRequest({ levels: order, layouts: { a: { walls, floors: [[[0, 0], [10, 0], [10, 8], [0, 8]]] } } }));
    const stair: StairParams = {
      id: 's', baseLevelId: d.levels[0].id, topLevelId: d.levels[1].id, shape,
      origin: [3, 3], angle: 0, width: 1.1, ...(shape === 'u' ? { turn: 'left' as const } : {}),
    };
    d.stairs.push(stair);
    return { d, stair };
  };
  const byClass = (f: IfcxFile, code: string) =>
    f.data.filter((n) => (n.attributes?.['bsi::ifc::class'] as { code?: string } | undefined)?.code === code);

  it('una U emite IfcStair, dos tramos, descanso y barandas', async () => {
    const { d } = conEscalera();
    const f = await toIfcx(d, T);
    expect(byClass(f, 'IfcStair')).toHaveLength(1);
    expect(byClass(f, 'IfcStairFlight')).toHaveLength(2);
    expect(byClass(f, 'IfcRailing').length).toBeGreaterThanOrEqual(6);
    const landing = byClass(f, 'IfcSlab').filter((n) => attr(f, n.path!, 'bsi::ifc::prop::PredefinedType') === 'LANDING');
    expect(landing).toHaveLength(1);
  });

  it('el suelo superior pierde el volumen del hueco', async () => {
    const { d } = conEscalera();
    const f = await toIfcx(d, T);
    const upper = d.floors.find((x) => x.levelId === d.levels[1].id)!;
    const area = 3.06 * 2.3; // opening of the U: from xa to L1+w, with the width of the two flights
    expect(attr(f, upper.id, 'bsi::ifc::prop::NetVolume')).toBeCloseTo((80 - area) * 0.3);
    expect(attr(f, upper.id, 'bsi::ifc::prop::NetArea')).toBeCloseTo(80 - area);
    const lower = d.floors.find((x) => x.levelId === d.levels[0].id)!;
    expect(attr(f, lower.id, 'bsi::ifc::prop::NetVolume')).toBeCloseTo(80 * 0.3);
  });

  it('ida y vuelta conserva la escalera', async () => {
    const { d } = conEscalera();
    const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
    const d2 = fromIfcx(f)!;
    expect(d2.stairs).toEqual(d.stairs);
    expect(await toIfcx(d2, T)).toEqual(f);
  });

  it('the version is 5 with stairs and 4 without them', async () => {
    const { d } = conEscalera();
    expect(attr(await toIfcx(d, T), d.ids.project, 'ifcx-studio::document').version).toBe(5);
    d.stairs = [];
    expect(attr(await toIfcx(d, T), d.ids.project, 'ifcx-studio::document').version).toBe(4);
  });

  it('stairOf resuelve sub-ids y stairNodeIds deriva los hijos', async () => {
    const { d, stair } = conEscalera();
    expect(stairOf(d, 's-f2')?.id).toBe('s');
    expect(stairNodeIds(stair, 2, true, 3)).toEqual(['s-f1', 's-f2', 's-l', 's-r1', 's-r2', 's-r3']);
    const f = await toIfcx(d, T);
    expect(f.data.some((n) => n.path === 's-f2')).toBe(true);
  });

  it('a straight one emits one flight and no landing', async () => {
    const { d } = conEscalera('straight');
    const f = await toIfcx(d, T);
    expect(byClass(f, 'IfcStairFlight')).toHaveLength(1);
    const landing = byClass(f, 'IfcSlab').filter((n) => attr(f, n.path!, 'bsi::ifc::prop::PredefinedType') === 'LANDING');
    expect(landing).toHaveLength(0);
  });

  it('una escalera con un nivel borrado no se escribe', async () => {
    const { d } = conEscalera();
    d.levels.splice(1, 1);
    const f = await toIfcx(d, T);
    expect(byClass(f, 'IfcStair')).toHaveLength(0);
  });

  it('un K_STAIR mal formado invalida el documento', async () => {
    const { d } = conEscalera();
    const f = JSON.parse(JSON.stringify(await toIfcx(d, T))) as IfcxFile;
    (nodo(f, 's').attributes![K_STAIR] as { shape: string }).shape = 'x';
    expect(fromIfcx(f)).toBeNull();
  });
});
