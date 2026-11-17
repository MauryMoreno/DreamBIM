import { describe, expect, it } from 'vitest';
import { polygonArea, wallFootprints, type Vec2, type WallAxis } from '../src/modeling/footprint';
import { JOIN_TOLERANCE, WALL_THICKNESS } from '../src/modeling/constants';

const T = 0.2;
const wall = (id: string, start: Vec2, end: Vec2): WallAxis => ({ id, start, end, thickness: T });
const has = (p: Vec2[], x: number, y: number) =>
  p.some((v) => Math.abs(v[0] - x) < 1e-6 && Math.abs(v[1] - y) < 1e-6);
const totalArea = (m: Map<string, Vec2[]>) => [...m.values()].reduce((s, p) => s + polygonArea(p), 0);
const allCcw = (m: Map<string, Vec2[]>) => [...m.values()].every((p) => p.length === 4 && polygonArea(p) > 0);

describe('constantes', () => {
  it('valores de referencia', () => {
    expect(WALL_THICKNESS).toBe(0.2);
    expect(JOIN_TOLERANCE).toBe(0.001);
  });
});

describe('wallFootprints', () => {
  it('a lone wall is a rectangle', () => {
    const m = wallFootprints([wall('a', [0, 0], [4, 0])]);
    const p = m.get('a')!;
    for (const [x, y] of [[0, -0.1], [4, -0.1], [4, 0.1], [0, 0.1]]) expect(has(p, x, y)).toBe(true);
    expect(polygonArea(p)).toBeCloseTo(0.8, 9);
    expect(allCcw(m)).toBe(true);
  });

  it('esquina en L a 90°', () => {
    const m = wallFootprints([wall('a', [0, 0], [4, 0]), wall('b', [4, 0], [4, 3])]);
    for (const id of ['a', 'b']) {
      expect(has(m.get(id)!, 4.1, -0.1)).toBe(true);
      expect(has(m.get(id)!, 3.9, 0.1)).toBe(true);
    }
    expect(totalArea(m)).toBeCloseTo(1.4, 9);
    expect(allCcw(m)).toBe(true);
  });

  it('tramos colineales', () => {
    const m = wallFootprints([wall('a', [0, 0], [2, 0]), wall('b', [2, 0], [5, 0])]);
    expect(has(m.get('a')!, 2, -0.1)).toBe(true);
    expect(has(m.get('a')!, 2, 0.1)).toBe(true);
    expect(has(m.get('b')!, 2, -0.1)).toBe(true);
    expect(has(m.get('b')!, 2, 0.1)).toBe(true);
    expect(totalArea(m)).toBeCloseTo(1.0, 9);
    expect(allCcw(m)).toBe(true);
  });

  it('cadena cerrada', () => {
    const m = wallFootprints([
      wall('a', [0, 0], [4, 0]),
      wall('b', [4, 0], [4, 3]),
      wall('c', [4, 3], [0, 3]),
      wall('d', [0, 3], [0, 0]),
    ]);
    const all = [...m.values()].flat();
    for (const [cx, cy] of [[0, 0], [4, 0], [4, 3], [0, 3]]) {
      const ox = cx === 0 ? -1 : 1;
      const oy = cy === 0 ? -1 : 1;
      // outer and inner vertex of the corner, at ±0.1 on both axes
      for (const k of [1, -1]) {
        const ok = all.some(
          (v) => Math.abs(v[0] - (cx + ox * k * 0.1)) < 1e-6 && Math.abs(v[1] - (cy + oy * k * 0.1)) < 1e-6,
        );
        expect(ok).toBe(true);
      }
    }
    // area = outer perimeter 4.2x3.2 minus inner 3.8x2.8
    expect(totalArea(m)).toBeCloseTo(4.2 * 3.2 - 3.8 * 2.8, 9);
    expect(allCcw(m)).toBe(true);
  });

  it('very acute angle', () => {
    const m = wallFootprints([wall('a', [0, 0], [4, 0]), wall('b', [4, 0], [0, 0.2])]);
    for (const p of m.values()) {
      for (const v of p) {
        const d = Math.min(Math.hypot(v[0] - 4, v[1]), Math.hypot(v[0], v[1]), Math.hypot(v[0], v[1] - 0.2));
        expect(d).toBeLessThanOrEqual(2 * T);
      }
    }
    expect(allCcw(m)).toBe(true);
  });

  it('tres muros en un punto', () => {
    const m = wallFootprints([
      wall('a', [0, 0], [4, 0]),
      wall('b', [4, 0], [4, 3]),
      wall('c', [4, 0], [6, -1]),
    ]);
    // a: extremo recto en x=4
    expect(has(m.get('a')!, 4, -0.1)).toBe(true);
    expect(has(m.get('a')!, 4, 0.1)).toBe(true);
    // b: extremo recto en y=0
    expect(has(m.get('b')!, 3.9, 0)).toBe(true);
    expect(has(m.get('b')!, 4.1, 0)).toBe(true);
    // c: extremo recto, perpendicular a su eje
    const n = [1 / Math.sqrt(5), 2 / Math.sqrt(5)];
    expect(has(m.get('c')!, 4 + n[0] * 0.1, n[1] * 0.1)).toBe(true);
    expect(has(m.get('c')!, 4 - n[0] * 0.1, -n[1] * 0.1)).toBe(true);
    expect(allCcw(m)).toBe(true);
  });

  it('tolerancia', () => {
    const near = wallFootprints([wall('a', [0, 0], [4, 0]), wall('b', [4.0005, 0], [4.0005, 3])]);
    expect(has(near.get('a')!, 4.1, -0.1)).toBe(true);
    const far = wallFootprints([wall('a', [0, 0], [4, 0]), wall('b', [4.002, 0], [4.002, 3])]);
    expect(has(far.get('a')!, 4, -0.1)).toBe(true);
    expect(allCcw(near) && allCcw(far)).toBe(true);
  });
});
