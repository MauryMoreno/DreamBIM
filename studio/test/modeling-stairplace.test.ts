import { describe, expect, it } from 'vitest';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { newDocument, type StudioDoc } from '../src/modeling/document';
import { placeStair } from '../src/modeling/staircheck';
import {
  applyStairs, levelByName, parsePlaceStairs, parseStairSpots, summarizeStairs, MAX_STAIRS,
} from '../src/modeling/stairplace';

function plan(levels = 2): StudioDoc {
  const d = newDocument();
  const order = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}`, elevation: i * 3, layout: 'a' }));
  applyBuild(d, parseBuildRequest({
    levels: order,
    layouts: {
      a: {
        walls: [
          { from: [0, 0], to: [10, 0], thickness: 0.3 },
          { from: [10, 0], to: [10, 8], thickness: 0.3 },
          { from: [10, 8], to: [0, 8], thickness: 0.3 },
          { from: [0, 8], to: [0, 0], thickness: 0.3 },
        ],
        floors: [[[0, 0], [10, 0], [10, 8], [0, 8]]],
      },
    },
  }));
  return d;
}

const item = (from = 'Level 1', to = 'Level 2', at: [number, number] = [3, 3]) => ({
  from, to, shape: 'u' as const, at, rotation: 0, width: 1.1,
});

describe('Assistant stairs request', () => {
  it('it reads place_stairs with the default values', () => {
    const req = parsePlaceStairs({ items: [{ from: 'Level 1', to: 'Level 2', shape: 'straight', at: [1.2345, 2] }] });
    expect(req.items[0]).toEqual({
      from: 'Level 1', to: 'Level 2', shape: 'straight', at: [1.235, 2], rotation: 0, width: 1.1,
    });
    expect(parsePlaceStairs({ items: [{ ...item(), width: 1.5, rotation: 90, turn: 'right' }] }).items[0])
      .toMatchObject({ width: 1.5, rotation: 90, turn: 'right' });
  });

  it('it rejects empty items, more than 20 or with wrong fields', () => {
    expect(() => parsePlaceStairs({ items: [] })).toThrow("place_stairs: 'items' must be an array of 1 to 20 stairs");
    const many = Array.from({ length: MAX_STAIRS + 1 }, () => item());
    expect(() => parsePlaceStairs({ items: many })).toThrow(/place_stairs: 'items'/);
    expect(() => parsePlaceStairs({ items: [{ ...item(), shape: 'L' }] })).toThrow(/'shape'/);
    expect(() => parsePlaceStairs({ items: [{ ...item(), at: [1, 2, 3] }] })).toThrow(/'at'/);
    expect(() => parsePlaceStairs({ items: [{ ...item(), turn: 'up' }] })).toThrow(/'turn'/);
    expect(() => parsePlaceStairs({ items: [{ ...item(), at: [20000, 0] }] })).toThrow(/±10000/);
  });

  it('it reads stair_spots and limits the number of sites', () => {
    expect(parseStairSpots({ from: 'Level 1', to: 'Level 2', shape: 'u' })).toEqual({
      from: 'Level 1', to: 'Level 2', shape: 'u', width: 1.1, limit: 10,
    });
    expect(parseStairSpots({ from: 'Level 1', to: 'Level 2', shape: 'u', limit: 99 }).limit).toBe(20);
    expect(parseStairSpots({ from: 'Level 1', to: 'Level 2', shape: 'u', limit: 0 }).limit).toBe(1);
    expect(() => parseStairSpots({ from: 'Level 1', to: 'Level 2', shape: 'x' })).toThrow(/'shape'/);
  });

  it('a nonexistent level lists the ones that exist', () => {
    const d = plan();
    expect(() => levelByName(d, 'N9', 'place_stairs', 'items[0]'))
      .toThrow("place_stairs: items[0]: no level named 'N9' (levels: Level 1, Level 2)");
    expect(() => applyStairs(d, { items: [item('Level 1', 'N9')] }))
      .toThrow("place_stairs: items[0]: no level named 'N9'");
  });

  it('a valid U is added and the summary describes railings and opening', () => {
    const d = plan();
    const ids = applyStairs(d, { items: [item()] });
    expect(ids).toHaveLength(1);
    expect(d.stairs).toHaveLength(1);
    const placed = placeStair(d, d.stairs[0]);
    const s = summarizeStairs(d, ids);
    expect(s.total).toBe(1);
    expect(s.stairs[0]).toMatchObject({
      from: 'Level 1', to: 'Level 2', shape: 'u', risers: 17, width: 1.1,
    });
    expect(s.stairs[0].riser).toBeCloseTo(3 / 17);
    expect(s.openings).toBe(1);
    expect(s.stairs[0].railings + s.stairs[0].handrails).toBe(placed.rails.length);
  });

  it('two stacked Us in the same request are accepted', () => {
    const d = plan(3);
    const ids = applyStairs(d, { items: [item('Level 1', 'Level 2'), item('Level 2', 'Level 3')] });
    expect(ids).toHaveLength(2);
    expect(d.stairs).toHaveLength(2);
    expect(d.stairs[0].origin).toEqual(d.stairs[1].origin);
  });

  it('si la segunda falla, el documento no cambia', () => {
    const d = plan(3);
    const before = JSON.stringify(d);
    expect(() => applyStairs(d, { items: [item('Level 1', 'Level 2'), item('Level 2', 'Level 3', [20, 20])] }))
      .toThrow(/place_stairs: items\[1\]:/);
    expect(JSON.stringify(d)).toBe(before);
  });
});
