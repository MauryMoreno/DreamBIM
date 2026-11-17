import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { buildObject, transformOf, tryBuildObject } from '../src/render/geometry';
import { packMeshes } from '../src/ifcx/packed';
import type { ComposedNode, IfcxFile } from '../src/ifcx/types';

const MESH = 'usd::usdgeom::mesh';
const node = (mesh: unknown): ComposedNode =>
  ({ name: 'n', path: 'p', origin: 'o', attributes: { [MESH]: mesh }, children: [], parent: null }) as unknown as ComposedNode;
const geom = (n: ComposedNode) => (buildObject(n, 'mesh') as THREE.Mesh).geometry as THREE.BufferGeometry;
/** Devuelve la malla tal cual y su copia empaquetada. */
function both(mesh: any) {
  const f = { header: {}, imports: [], schemas: {}, data: [{ path: 'm', attributes: { [MESH]: structuredClone(mesh) } }] } as unknown as IfcxFile;
  packMeshes(f);
  return [structuredClone(mesh), f.data[0].attributes![MESH]];
}
const quad = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 3, 2], faceVertexCounts: [4] };

describe('meshGeometry', () => {
  it('a quadrilateral is triangulated as a fan, packed or not', () => {
    const [plain, packed] = both(quad);
    const a = geom(node(plain)), b = geom(node(packed));
    for (const g of [a, b]) {
      expect([...g.index!.array]).toEqual([0, 1, 3, 0, 3, 2]);
      expect(g.attributes.position.count).toBe(4);
    }
    expect([...a.attributes.position.array]).toEqual([...b.attributes.position.array]);
    expect([...a.attributes.normal.array]).toEqual([...b.attributes.normal.array]);
    expect(a.boundingSphere!.radius).toBeCloseTo(b.boundingSphere!.radius, 6);
    expect(a.boundingSphere!.center.toArray()).toEqual(b.boundingSphere!.center.toArray());
  });

  it('triangles without faceVertexCounts keep the index as it is', () => {
    const [plain, packed] = both({ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 2, 1, 3, 2] });
    for (const m of [plain, packed]) expect([...geom(node(m)).index!.array]).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it('triangles with faceVertexCounts all 3 keep the index; a 5-sided polygon gives 3 triangles', () => {
    const [plain] = both({ points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0.5, 2, 0], [0, 1, 0]], faceVertexIndices: [0, 1, 2, 3, 4], faceVertexCounts: [5] });
    expect([...geom(node(plain)).index!.array]).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
  });

  it('two nodes with the same points object share a BufferGeometry (also packed)', () => {
    const [plain, packed] = both(quad);
    expect(geom(node(plain))).toBe(geom(node({ ...plain })));
    expect(geom(node(packed))).toBe(geom(node({ ...packed })));
  });

  it('it uses a 16-bit index with few vertices and a 32-bit one with 65,536 or more', () => {
    const [small] = both(quad);
    expect(geom(node(small)).index!.array).toBeInstanceOf(Uint16Array);
    const n = 65536;
    const big = { points: Array.from({ length: n }, (_, i) => [i, 0, 0]), faceVertexIndices: [0, 1, n - 1], faceVertexCounts: [3] };
    expect(geom(node(big)).index!.array).toBeInstanceOf(Uint32Array);
  });
});

describe('bad geometry', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const node = (attributes: Record<string, unknown>) =>
    ({ path: '/n', name: 'n', origin: 'n', attributes, children: [], parent: null }) as ComposedNode;
  const MESH = 'usd::usdgeom::mesh';

  it('an index beyond the vertices is refused', () => {
    const n = node({ [MESH]: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faceVertexIndices: [0, 1, 3] } });
    expect(() => buildObject(n, 'mesh')).toThrow('index out of range');
    expect(tryBuildObject(n, 'mesh')).toBeNull();
  });

  it('face counts that ask for more indices than there are is refused', () => {
    const n = node({ [MESH]: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 2], faceVertexCounts: [4] } });
    expect(tryBuildObject(n, 'mesh')).toBeNull();
  });

  it('a mesh without indices draws nothing and is not a failure', () => {
    const n = node({ [MESH]: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faceVertexIndices: [] } });
    expect(tryBuildObject(n, 'mesh')).toBeInstanceOf(THREE.Mesh);
  });

  it('a point cloud whose base64 is not whole floats is refused', () => {
    expect(tryBuildObject(node({ 'points::base64': { positions: 'AAAAAAA=' } }), 'points')).toBeNull();
  });

  it('a transform that is not 4x4 finite numbers is ignored', () => {
    expect(transformOf({ 'usd::xformop': { transform: [[1, 0, 0], [0, 1, 0]] } })).toBeNull();
    expect(transformOf({ 'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, NaN, 1]] } })).toBeNull();
    expect(transformOf({ 'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [2, 3, 4, 1]] } })?.elements[12]).toBe(2);
  });
});
