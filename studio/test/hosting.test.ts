import { describe, expect, it } from 'vitest';
import {
  OPENING_MARGIN, checkHost, hostedOrigin, wallAngle, wallHoles, wallLength, type WallHost,
} from '../src/modeling/hosting';
import type { Vec2 } from '../src/modeling/footprint';

const wall = { id: 'w', start: [1, 1] as Vec2, end: [1, 5] as Vec2, thickness: 0.2 }; // 4 m hacia +Y
const door: WallHost = { along: 2, sill: 0, width: 1, height: 2.1 };

describe('piezas alojadas en un muro', () => {
  it('marco del muro', () => {
    expect(OPENING_MARGIN).toBe(0.1);
    expect(wallLength(wall)).toBeCloseTo(4);
    expect(wallAngle(wall)).toBeCloseTo(90);
    expect(hostedOrigin(wall, 2)).toEqual([1, 3]);
  });

  it('cabe', () => expect(checkHost(4, 3, door, [])).toBeNull());

  it('se sale por un extremo', () => {
    expect(checkHost(4, 3, { ...door, along: 0.5 }, [])).toBe(
      "does not fit: 'offset' must be between 0.6 and 3.4 on this 4 m wall",
    );
  });

  it('justo en el margen cabe', () => expect(checkHost(4, 3, { ...door, along: 0.6 }, [])).toBeNull());

  it('muro demasiado corto', () => {
    expect(checkHost(1, 3, door, [])).toBe('the wall (1 m) is too short for a 1 m wide piece');
  });

  it('antepecho negativo', () => expect(checkHost(4, 3, { ...door, sill: -0.1 }, [])).toBe("'sill' must be 0 or more"));

  it('taller than the wall', () => {
    expect(checkHost(4, 3, { ...door, sill: 1 }, [])).toBe(
      "too tall: 'sill' can be at most 0.9 on this 3 m high wall",
    );
    expect(checkHost(4, 2, door, [])).toBe('the piece (2.1 m) is taller than the wall (2 m)');
  });

  it('solapa otra pieza solo si coinciden en planta y en altura', () => {
    expect(checkHost(4, 3, door, [{ along: 2.9, sill: 0, width: 1, height: 2 }])).toBe(
      'overlaps another piece in the same wall',
    );
    expect(
      checkHost(4, 3, { along: 2, sill: 0, width: 1, height: 1 }, [{ along: 2, sill: 1.5, width: 1, height: 1 }]),
    ).toBeNull();
  });

  it('huecos en el mundo, recortados al muro', () => {
    expect(wallHoles(wall, 10, 3, [{ along: 2, sill: 2.5, width: 1, height: 1 }])).toEqual([
      { center: [1, 3], angle: 90, width: 1, z0: 12.5, z1: 13 },
    ]);
  });
});
