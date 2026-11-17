import { describe, expect, it } from 'vitest';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { newDocument, type StairParams, type StudioDoc } from '../src/modeling/document';
import { checkStair } from '../src/modeling/staircheck';
import { findStairSpots, type SpotQuery } from '../src/modeling/stairspots';

function plan(w = 10, h = 8, levels = 2, extraWalls = 0): StudioDoc {
  const d = newDocument();
  const order = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}`, elevation: i * 3, layout: 'a' }));
  const walls = [
    { from: [0, 0], to: [w, 0], thickness: 0.3 },
    { from: [w, 0], to: [w, h], thickness: 0.3 },
    { from: [w, h], to: [0, h], thickness: 0.3 },
    { from: [0, h], to: [0, 0], thickness: 0.3 },
  ];
  for (let i = 0; i < extraWalls; i++) {
    const x = 1 + (i % 8);
    const y = 1 + Math.floor(i / 8) * 1.2;
    walls.push({ from: [x, y], to: [x + 2, y], thickness: 0.15 });
  }
  applyBuild(d, parseBuildRequest({ levels: order, layouts: { a: { walls, floors: [[[0, 0], [w, 0], [w, h], [0, h]]] } } }));
  return d;
}

const q = (d: StudioDoc, shape: 'straight' | 'u' = 'u', width = 1.1): SpotQuery => ({
  baseLevelId: d.levels[0].id, topLevelId: d.levels[1].id, shape, width,
});

describe('findStairSpots', () => {
  it('it finds valid sites for U and for straight', () => {
    const d = plan();
    for (const shape of ['u', 'straight'] as const) {
      const res = findStairSpots(d, q(d, shape));
      expect(res.risers).toBe(17);
      expect(res.spots.length).toBeGreaterThan(0);
      for (const s of res.spots) {
        const stair: StairParams = {
          id: 'x', baseLevelId: d.levels[0].id, topLevelId: d.levels[1].id, shape,
          origin: s.origin, angle: s.angle, width: 1.1, ...(s.turn ? { turn: s.turn } : {}),
        };
        expect(checkStair(d, stair)).toBeNull();
      }
      expect(res.spots[0].walls).toBeGreaterThanOrEqual(1);
    }
  });

  it('on a 3 × 3 plan there is no site and it explains why', () => {
    const d = plan(3, 3);
    const res = findStairSpots(d, q(d, 'straight'));
    expect(res.spots).toEqual([]);
    expect(res.reason).toBeTruthy();
    expect(res.reason!.length).toBeGreaterThan(10);
  });

  it('en 3 niveles el primer sitio de 1→2 es el apilado sobre la U de 0→1', () => {
    const d = plan(10, 8, 3);
    const first = findStairSpots(d, q(d, 'u')).spots[0];
    d.stairs.push({
      id: 's1', baseLevelId: d.levels[0].id, topLevelId: d.levels[1].id,
      shape: 'u', origin: first.origin, angle: first.angle, width: 1.1, ...(first.turn ? { turn: first.turn } : {}),
    });
    const res = findStairSpots(d, { ...q(d, 'u'), baseLevelId: d.levels[1].id, topLevelId: d.levels[2].id });
    expect(res.spots[0].stacked).toBe(true);
    expect(res.spots[0].origin).toEqual(first.origin);
    expect(res.spots[0].angle).toBe(first.angle);
    expect(res.spots[0].turn).toBe(first.turn);
  });

  it('it respects the limit', () => {
    const d = plan();
    expect(findStairSpots(d, q(d), 3).spots).toHaveLength(3);
  });

  it('termina en menos de 500 ms con 40 muros', () => {
    const d = plan(10, 8, 2, 40);
    const t0 = performance.now();
    findStairSpots(d, q(d));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
