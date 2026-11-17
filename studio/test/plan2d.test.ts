import { describe, expect, it } from 'vitest';
import { convexOverlap, pointInPolygon, polygonContains, rectPolygon } from '../src/modeling/plan2d';
import type { Vec2 } from '../src/modeling/footprint';

const square = (x: number, y: number, s = 1): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

describe('plan2d', () => {
  it('rectPolygon rotates a rectangle 90°', () => {
    const p = rectPolygon({ x0: 0, x1: 2, y0: -1, y1: 1 }, [1, 1], 90);
    expect(p).toHaveLength(4);
    expect(p[0][0]).toBeCloseTo(2);
    expect(p[0][1]).toBeCloseTo(1);
    expect(p[1][0]).toBeCloseTo(2);
    expect(p[1][1]).toBeCloseTo(3);
  });

  it('two squares that touch do not overlap; with 1 cm they do', () => {
    expect(convexOverlap(square(0, 0), square(1, 0))).toBe(false);
    expect(convexOverlap(square(0, 0), square(0.99, 0))).toBe(true);
  });

  it('pointInPolygon incluye el borde', () => {
    const s = square(0, 0);
    expect(pointInPolygon([0.5, 0.5], s)).toBe(true);
    expect(pointInPolygon([0, 0.5], s)).toBe(true);
    expect(pointInPolygon([-0.001, 0.5], s)).toBe(false);
  });

  it('polygonContains: dentro, fuera y cruzando el borde de una L', () => {
    const L: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
    expect(polygonContains(L, square(0.5, 0.5))).toBe(true);
    expect(polygonContains(L, square(5, 0.5))).toBe(false);
    // it crosses the concave edge of the L: all its vertices are inside, but one side goes out
    expect(polygonContains(L, square(1.5, 1.5, 1))).toBe(false);
  });
});
