import { describe, expect, it } from 'vitest';
import { meshFaceCount, meshVertexCount, packMeshes } from '../src/ifcx/packed';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';

const file = (data: IfcxNode[]): IfcxFile => ({ header: {} as any, imports: [], schemas: {}, data });
const MESH = 'usd::usdgeom::mesh';

describe('packMeshes', () => {
  it('it packs points, indices and counts and returns their buffers', () => {
    const f = file([{ path: 'm', attributes: { [MESH]: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 3, 2], faceVertexCounts: [4] } } }]);
    const bufs = packMeshes(f);
    const m = f.data[0].attributes![MESH] as any;
    expect(m.points).toBeInstanceOf(Float32Array);
    expect([...m.points]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
    expect(m.faceVertexIndices).toBeInstanceOf(Uint32Array);
    expect([...m.faceVertexIndices]).toEqual([0, 1, 3, 2]);
    expect(m.faceVertexCounts).toBeInstanceOf(Uint32Array);
    expect([...m.faceVertexCounts]).toEqual([4]);
    expect(bufs).toHaveLength(3);
    expect(packMeshes(f)).toEqual([]); // idempotente
  });

  it('sin faceVertexCounts no los inventa; ignora nodos sin malla', () => {
    const f = file([
      { path: 'a' },
      { path: 'b', attributes: { other: 1 } },
      { path: 'c', attributes: { [MESH]: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faceVertexIndices: [0, 1, 2] } } },
    ]);
    expect(packMeshes(f)).toHaveLength(2);
    const m = f.data[2].attributes![MESH] as any;
    expect(m.faceVertexCounts).toBeUndefined();
    expect(m.points).toBeInstanceOf(Float32Array);
  });
});

describe('meshVertexCount / meshFaceCount', () => {
  const quad = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 3, 2], faceVertexCounts: [4] };
  const tris = { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], faceVertexIndices: [0, 1, 2, 1, 3, 2] };

  it('dan lo mismo empaquetado o no', () => {
    const f = file([{ path: 'q', attributes: { [MESH]: structuredClone(quad) } }, { path: 't', attributes: { [MESH]: structuredClone(tris) } }]);
    const before = f.data.map((n) => n.attributes![MESH]);
    const plain = before.map((m) => [meshVertexCount(m), meshFaceCount(m)]);
    expect(plain).toEqual([[4, 1], [4, 2]]);
    packMeshes(f);
    const packed = f.data.map((n) => [meshVertexCount(n.attributes![MESH]), meshFaceCount(n.attributes![MESH])]);
    expect(packed).toEqual(plain);
  });

  it('tolera datos ausentes', () => {
    expect(meshVertexCount(undefined)).toBe(0);
    expect(meshVertexCount({})).toBe(0);
    expect(meshFaceCount({})).toBe(0);
    expect(meshFaceCount(null)).toBe(0);
  });
});
