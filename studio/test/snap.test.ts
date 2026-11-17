import { describe, expect, it } from 'vitest';
import { snapOrtho, snapToChainStart, snapWallEnd, wallAngleDeg } from '../src/modeling/snap';

const project = (p: [number, number]) => ({ x: p[0] * 100, y: p[1] * 100 });

describe('snapToChainStart', () => {
  it('within the threshold it returns an exact copy of the start', () => {
    const first: [number, number] = [1, 1];
    const r = snapToChainStart([1.03, 1], first, project, { x: 105, y: 100 });
    expect(r).toEqual([1, 1]);
    expect(r).not.toBe(first);
  });
  it('justo en el umbral (8 px) ajusta; fuera no', () => {
    expect(snapToChainStart([9, 9], [1, 1], project, { x: 108, y: 100 })).toEqual([1, 1]);
    expect(snapToChainStart([9, 9], [1, 1], project, { x: 109, y: 100 })).toEqual([9, 9]);
  });
  it('without chainStart or with a null projection it returns the point', () => {
    expect(snapToChainStart([9, 9], null, project, { x: 100, y: 100 })).toEqual([9, 9]);
    expect(snapToChainStart([9, 9], [1, 1], () => null, { x: 100, y: 100 })).toEqual([9, 9]);
  });
});

describe('snapOrtho', () => {
  it('a ≤ 3° de horizontal se proyecta sobre X', () => {
    expect(snapOrtho([0, 0], [5, 0.2], false)).toEqual({ point: [5, 0], axis: 'x' }); // ~2,29°
  });
  it('within ≤ 3° of vertical (also downwards) it is projected onto Y', () => {
    expect(snapOrtho([1, 1], [1.1, -4], false)).toEqual({ point: [1, -4], axis: 'y' });
  });
  it('beyond 3° it does not snap', () => {
    expect(snapOrtho([0, 0], [5, 0.3], false)).toEqual({ point: [5, 0.3], axis: null }); // ~3,43°
  });
  it('with force it picks the nearest axis at any angle', () => {
    expect(snapOrtho([0, 0], [3, 2], true)).toEqual({ point: [3, 0], axis: 'x' });
    expect(snapOrtho([0, 0], [2, 3], true)).toEqual({ point: [0, 3], axis: 'y' });
  });
  it('segmento nulo: ni ajuste ni eje, aun con force', () => {
    expect(snapOrtho([2, 2], [2, 2], true)).toEqual({ point: [2, 2], axis: null });
  });
});

describe('snapWallEnd', () => {
  const project = (p: [number, number]) => ({ x: p[0] * 100, y: p[1] * 100 });
  it('el cierre de cadena gana al ajuste ortogonal y no da eje', () => {
    const r = snapWallEnd([0.02, 0.0], [4, 0], [0, 0], project, { x: 3, y: 0 }, false);
    expect(r).toEqual({ point: [0, 0], axis: null });
  });
  it('sin cierre aplica el ortogonal; con shift lo fuerza', () => {
    expect(snapWallEnd([3, 0.1], [0, 0], null, project, { x: 300, y: 10 }, false)).toEqual({ point: [3, 0], axis: 'x' });
    expect(snapWallEnd([3, 2], [0, 0], null, project, { x: 300, y: 200 }, true)).toEqual({ point: [3, 0], axis: 'x' });
  });
});

describe('wallAngleDeg', () => {
  it('mide desde +X antihorario en [0, 360)', () => {
    expect(wallAngleDeg([0, 0], [1, 0])).toBe(0);
    expect(wallAngleDeg([0, 0], [0, 1])).toBeCloseTo(90);
    expect(wallAngleDeg([0, 0], [0, -1])).toBeCloseTo(270);
    expect(wallAngleDeg([0, 0], [3, 4])).toBeCloseTo(53.13, 2);
  });
});
