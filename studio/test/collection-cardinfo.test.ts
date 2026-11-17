import { describe, expect, it } from 'vitest';
import { packMeshes } from '../src/ifcx/packed';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import { cardInfo } from '../src/collection/cardinfo';

const tris = (n: number) => ({ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faceVertexIndices: Array.from({ length: n * 3 }, (_, i) => i % 3) });
const lod = (n: number, error: number) => ({ error, ...tris(n) });

function mesh(n: number, color: number[], lods?: Record<string, ReturnType<typeof lod>>): IfcxNode {
  return {
    path: `m${n}${color[0]}`,
    attributes: {
      'usd::usdgeom::mesh': tris(n),
      'bsi::ifc::presentation::diffuseColor': color,
      ...(lods ? { 'studio::lod': lods } : {}),
    },
  };
}

function file(nodes: IfcxNode[], root: Record<string, unknown> = {}): IfcxFile {
  return {
    header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' },
    imports: [],
    schemas: {},
    data: [
      {
        path: 'root',
        attributes: {
          'bsi::ifc::class': { code: 'IfcFurniture' },
          'bsi::ifc::prop::Name': 'Banquette - Double',
          'bsi::ifc::prop::Reference': 'Banquette - Double',
          'bsi::ifc::prop::Description': 'Un banco',
          'bsi::ifc::prop::Width': 1.4519,
          'bsi::ifc::prop::Depth': 1.1176,
          'bsi::ifc::prop::Height': 0.9335,
          'bsi::ifc::prop::Material': 'Oak',
          ...root,
        },
      },
      ...nodes,
    ],
  };
}

const PATH = 'C:\\lib\\fontaneria\\Elbow\\Elbow 89.ifcx';

describe('cardInfo', () => {
  it('it uses the cache and does not read the file again', () => {
    const i = cardInfo(file([mesh(2, [1, 0, 0]), mesh(3, [0, 1, 0])]), PATH, 'C:\\lib');
    expect(i.name).toBe('Banquette - Double');
    expect(i.ifcClass).toBe('IfcFurniture');
    expect(i.reference).toBe('Banquette - Double');
    expect(i.description).toBe('Un banco');
    expect(i.dims).toEqual({ width: 1.4519, depth: 1.1176, height: 0.9335 });
    expect(i.extra).toEqual([['Material', 'Oak']]);
    expect(i.meshes).toBe(2);
    expect(i.materials).toBe(2);
  });

  it('disciplina y tipo desde la ruta, con \ o con /', () => {
    const a = cardInfo(file([]), PATH, 'C:\\lib');
    expect(a.discipline).toBe('fontaneria');
    expect(a.typeFolder).toBe('fontaneria\\Elbow');
    const b = cardInfo(file([]), '/lib/hvac/Grille/g.ifcx', '/lib');
    expect(b.discipline).toBe('hvac');
    expect(b.typeFolder).toBe('hvac/Grille');
    expect(cardInfo(file([]), '/lib/g.ifcx', '/lib').discipline).toBe('');
  });

  it('sin Name usa el nombre del archivo', () => {
    const i = cardInfo(file([], { 'bsi::ifc::prop::Name': undefined }), PATH, 'C:\\lib');
    expect(i.name).toBe('Elbow 89');
  });

  it('sin LOD solo hay nivel 0', () => {
    const i = cardInfo(file([mesh(2, [1, 0, 0]), mesh(3, [0, 1, 0])]), PATH, 'C:\\lib');
    expect(i.lods).toEqual([{ level: 0, triangles: 5, error: 0 }]);
  });

  it('LOD con mallas incompletas: la que no tiene nivel cuenta el inferior', () => {
    const a = mesh(100, [1, 0, 0], { '1': lod(40, 0.002), '2': lod(10, 0.007) });
    const b = mesh(30, [0, 1, 0]);
    const i = cardInfo(file([a, b]), PATH, 'C:\\lib');
    expect(i.lods).toEqual([
      { level: 0, triangles: 130, error: 0 },
      { level: 1, triangles: 70, error: 0.002 },
      { level: 2, triangles: 40, error: 0.007 },
    ]);
  });

  it('mallas empaquetadas dan el mismo resultado', () => {
    const f = file([mesh(100, [1, 0, 0], { '1': lod(40, 0.002) })]);
    const plain = cardInfo(JSON.parse(JSON.stringify(f)), PATH, 'C:\\lib');
    packMeshes(f);
    expect(cardInfo(f, PATH, 'C:\\lib').lods).toEqual(plain.lods);
  });

  it('an unreadable root rejects the promise', () => {
    const a = mesh(100, [1, 0, 0], { '-1': lod(400, 0.001), '1': lod(40, 0.002) });
    const b = mesh(30, [0, 1, 0]);
    const i = cardInfo(file([a, b]), PATH, 'C:\\lib');
    expect(i.lods).toEqual([
      { level: -1, triangles: 430, error: 0.001 },
      { level: 0, triangles: 130, error: 0 },
      { level: 1, triangles: 70, error: 0.002 },
    ]);
  });
});
