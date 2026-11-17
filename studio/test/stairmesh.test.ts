import { describe, expect, it } from 'vitest';
import { newDocument, type StudioDoc } from '../src/modeling/document';
import { placeStair } from '../src/modeling/staircheck';
import { flightMesh, landingMesh, railMesh } from '../src/modeling/stairmesh';
import type { StairShape } from '../src/modeling/stairlayout';

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

function doc(shape: StairShape = 'straight'): StudioDoc {
  const d = newDocument();
  d.levels.push({ id: 'l2', name: 'Level 2', elevation: 3 });
  d.stairs.push({ id: 's', baseLevelId: d.levels[0].id, topLevelId: 'l2', shape, origin: [0, 0], angle: 0, width: 1.1 });
  return d;
}

describe('stairmesh', () => {
  it('el tramo recto es una caja envolvente de 0 a 4,48 y hasta 16·3/17', async () => {
    const d = doc('straight');
    const m = await flightMesh(placeStair(d, d.stairs[0]), 0);
    const xs = m.points.map((p) => p[0]);
    const zs = m.points.map((p) => p[2]);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(4.48);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo((16 * 3) / 17);
    expect(volumen(m.points, m.faceVertexIndices)).toBeGreaterThan(0);
  });

  it('the landing is null in a straight one and is at 9·3/17 in a U', async () => {
    const straight = doc('straight');
    expect(await landingMesh(placeStair(straight, straight.stairs[0]))).toBeNull();
    const u = doc('u');
    const m = await landingMesh(placeStair(u, u.stairs[0]));
    expect(m).not.toBeNull();
    const zs = m!.points.map((p) => p[2]);
    expect(Math.max(...zs)).toBeCloseTo((9 * 3) / 17);
  });

  it('the railing reaches 1.02 above the highest end and the handrail 0.86', async () => {
    const rail = { from: [0, 0, 0.5] as [number, number, number], to: [2, 0, 1.5] as [number, number, number], where: 'flight' as const };
    const guard = await railMesh({ ...rail, kind: 'guard' });
    expect(Math.max(...guard.points.map((p) => p[2]))).toBeCloseTo(1.5 + 1.02);
    const hand = await railMesh({ ...rail, kind: 'handrail' });
    expect(Math.max(...hand.points.map((p) => p[2]))).toBeCloseTo(1.5 + 0.86);
  });
});
