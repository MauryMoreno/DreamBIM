import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LevelInfo } from '../src/render/levels';
import {
  levelMarks, loadLevelsStyle, pickLevelEdge, pickLevelPlane, saveLevelsStyle,
} from '../src/workspace/levelmarks-geom';

const L1: LevelInfo = { path: '/l1', name: 'Level 1', minZ: 0, maxZ: 3 };
const L2: LevelInfo = { path: '/l2', name: 'Level 2', minZ: 3, maxZ: 6 };

describe('levelMarks', () => {
  it('footprint + 2 m margin per side; head 1 m outside the minimum corner; label with elevation', () => {
    const marks = levelMarks([L1, L2], { minX: 0, minY: 0, maxX: 10, maxY: 4 });
    expect(marks.map((m) => m.path)).toEqual(['/l1', '/l2']);
    expect(marks[0].corners).toEqual([[-2, -2], [12, -2], [12, 6], [-2, 6]]);
    expect(marks[0].head).toEqual([-3, -2]);
    expect(marks.map((m) => m.label)).toEqual(['Level 1 0.000', 'Level 2 3.000']);
    expect(marks.map((m) => m.z)).toEqual([0, 3]);
  });

  it('empty model: a fixed 10 x 10 m rectangle centered at the origin', () => {
    const [m] = levelMarks([L1], null);
    expect(m.corners).toEqual([[-5, -5], [5, -5], [5, 5], [-5, 5]]);
    expect(m.head).toEqual([-6, -5]);
  });
});

// Front elevation: each level is seen as a horizontal line; plan: the rectangle is seen
const alzado = (x: number, _y: number, z: number) => ({ x: x * 10, y: -z * 10 });
const planta = (x: number, y: number, _z: number) => ({ x: x * 10, y: -y * 10 });

describe('pickLevelEdge', () => {
  const marks = levelMarks([L1, L2], { minX: 0, minY: 0, maxX: 10, maxY: 4 });

  it('at 5 px from the Level 2 line it picks it; at 7 px it does not', () => {
    expect(pickLevelEdge(marks, alzado, { x: 50, y: -35 })).toBe('/l2');
    expect(pickLevelEdge(marks, alzado, { x: 50, y: -37 })).toBeNull();
  });

  it('between two very close levels it picks the nearest', () => {
    const cerca = levelMarks([{ ...L1, path: '/a', minZ: 0 }, { ...L2, path: '/b', minZ: 0.4 }], null);
    expect(pickLevelEdge(cerca, alzado, { x: 0, y: -4 })).toBe('/b');
    expect(pickLevelEdge(cerca, alzado, { x: 0, y: -1 })).toBe('/a');
  });

  it('un lado con un extremo no proyectable se ignora', () => {
    const sinProyeccion = () => null;
    expect(pickLevelEdge(marks, sinProyeccion, { x: 0, y: 0 })).toBeNull();
  });
});

describe('pickLevelPlane', () => {
  const marks = levelMarks([L1, L2], { minX: 0, minY: 0, maxX: 10, maxY: 4 });

  it('inside the projected quadrilateral it returns the level; outside, null', () => {
    expect(pickLevelPlane([marks[0]], planta, { x: 50, y: -20 })).toBe('/l1');
    expect(pickLevelPlane([marks[0]], planta, { x: 500, y: 0 })).toBeNull();
  });

  it('with two overlapping ones the one with the higher elevation wins', () => {
    expect(pickLevelPlane(marks, planta, { x: 50, y: -20 })).toBe('/l2');
  });
});

describe('estilo guardado', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('por defecto selected; recuerda plane y outline; un valor basura vuelve a selected', () => {
    localStorage.clear();
    expect(loadLevelsStyle()).toBe('selected');
    saveLevelsStyle('plane');
    expect(loadLevelsStyle()).toBe('plane');
    saveLevelsStyle('outline');
    expect(loadLevelsStyle()).toBe('outline');
    localStorage.setItem('ifcx-studio.levels-style', 'raro');
    expect(loadLevelsStyle()).toBe('selected');
  });

  it('con localStorage inaccesible no lanza y vale selected', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
    });
    expect(loadLevelsStyle()).toBe('selected');
    expect(() => saveLevelsStyle('off')).not.toThrow();
  });
});
