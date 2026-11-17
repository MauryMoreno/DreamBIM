import { describe, it, expect } from 'vitest';
import { extrudeFootprint, extrudeWall, extrudeWithHoles } from '../src/modeling/wallmesh';
import type { Vec2 } from '../src/modeling/footprint';

const rect: Vec2[] = [[0, -0.1], [4, -0.1], [4, 0.1], [0, 0.1]];

function volumen(points: number[][], idx: number[]): number {
  let v = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = points[idx[i]], b = points[idx[i + 1]], c = points[idx[i + 2]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe('extrudeFootprint', () => {
  it('4×0.2 rectangle extruded 3 m from z=0', async () => {
    const m = await extrudeFootprint(rect, 0, 3);
    expect(m.faceVertexIndices.length % 3).toBe(0);
    for (const p of m.points) {
      expect(p[2]).toBeGreaterThanOrEqual(-1e-9);
      expect(p[2]).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(Math.abs(volumen(m.points, m.faceVertexIndices))).toBeCloseTo(2.4, 5);
    const xs = m.points.map((p) => p[0]), ys = m.points.map((p) => p[1]), zs = m.points.map((p) => p[2]);
    expect([Math.min(...xs), Math.min(...ys), Math.min(...zs)]).toEqual([0, -0.1, 0]);
    expect([Math.max(...xs), Math.max(...ys), Math.max(...zs)]).toEqual([4, 0.1, 3]);
  });

  it('baseZ desplaza', async () => {
    const m = await extrudeFootprint(rect, 2.5, 3);
    const zs = m.points.map((p) => p[2]);
    expect(Math.min(...zs)).toBe(2.5);
    expect(Math.max(...zs)).toBe(5.5);
  });

  it('unshared vertices', async () => {
    const m = await extrudeFootprint(rect, 0, 3);
    expect(m.points.length).toBe(m.faceVertexIndices.length);
    m.faceVertexIndices.forEach((v, i) => expect(v).toBe(i));
  });

  it('redondeo a 6 decimales', async () => {
    const m = await extrudeFootprint([[0, 0], [1 / 3, 0], [1 / 3, 1 / 7], [0, 1 / 7]], 0.123456789, 2 / 3);
    for (const p of m.points) for (const c of p) expect(Math.abs(c - Math.round(c * 1e6) / 1e6)).toBeLessThan(1e-12);
  });
});

describe('extrudeWithHoles', () => {
  const slab: Vec2[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
  const hole: Vec2[] = [[3, 3], [6, 3], [6, 5], [3, 5]];
  const volume = (m: { points: number[][]; faceVertexIndices: number[] }) => volumen(m.points, m.faceVertexIndices);

  it('un suelo 10 × 8 × 0,2 con un hueco 3 × 2', async () => {
    const m = await extrudeWithHoles(slab, 0, 0.2, [hole]);
    expect(volume(m)).toBeCloseTo((80 - 6) * 0.2, 5);
  });

  it('sin huecos es igual a extrudeFootprint', async () => {
    expect(await extrudeWithHoles(slab, 0, 0.2, [])).toEqual(await extrudeFootprint(slab, 0, 0.2));
  });
});

describe('extrudeWall', () => {
  const fp: Vec2[] = [[0, -0.1], [4, -0.1], [4, 0.1], [0, 0.1]];
  const volume = (m: { points: number[][]; faceVertexIndices: number[] }) => volumen(m.points, m.faceVertexIndices);

  it('sin huecos da lo mismo que extrudeFootprint', async () => {
    expect(await extrudeWall(fp, 0, 3, [], 1)).toEqual(await extrudeFootprint(fp, 0, 3));
  });

  it('resta el hueco', async () => {
    const m = await extrudeWall(fp, 0, 3, [{ center: [2, 0], angle: 0, width: 1, z0: 0, z1: 2 }], 1);
    expect(volume(m)).toBeCloseTo(4 * 0.2 * 3 - 1 * 0.2 * 2, 5);
  });

  it('un hueco girado 90° en un muro vertical', async () => {
    const v: Vec2[] = [[-0.1, 0], [0.1, 0], [0.1, 4], [-0.1, 4]];
    const m = await extrudeWall(v, 0, 3, [{ center: [0, 2], angle: 90, width: 1, z0: 1, z1: 2 }], 1);
    expect(volume(m)).toBeCloseTo(4 * 0.2 * 3 - 1 * 0.2 * 1, 5);
  });
});
