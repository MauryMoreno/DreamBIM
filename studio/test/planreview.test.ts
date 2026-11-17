// The building plan as an object: reading, stable key and whole review before building.
import { describe, expect, it } from 'vitest';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { newDocument } from '../src/modeling/document';
import { applyPlace, type AssetRef } from '../src/modeling/place';
import { applyStairs } from '../src/modeling/stairplace';
import { parsePlan, reviewPlan, stableKey } from '../src/modeling/planreview';

const DOOR = '/lib/door.ifcx';
const ASSETS = new Map<string, AssetRef>([
  [DOOR, { layerUri: './door.ifcx', roots: ['D'], name: 'Door', ifcClass: 'IfcDoor', width: 0.9, height: 2.1 }],
]);

const walls = [
  { from: [0.15, 0.15], to: [11.85, 0.15], thickness: 0.3 },
  { from: [11.85, 0.15], to: [11.85, 9.85], thickness: 0.3 },
  { from: [11.85, 9.85], to: [0.15, 9.85], thickness: 0.3 },
  { from: [0.15, 9.85], to: [0.15, 0.15], thickness: 0.3 },
  { from: [0.15, 4.25], to: [5.25, 4.25], thickness: 0.15 },
  { from: [6.75, 4.25], to: [11.85, 4.25], thickness: 0.15 },
  { from: [0.15, 5.75], to: [4.7, 5.75], thickness: 0.15 },
  { from: [7.3, 5.75], to: [11.85, 5.75], thickness: 0.15 },
  { from: [5.25, 0.15], to: [5.25, 4.25], thickness: 0.15 },
  { from: [6.75, 0.15], to: [6.75, 4.25], thickness: 0.15 },
  { from: [4.7, 5.75], to: [4.7, 9.85], thickness: 0.15 },
  { from: [7.3, 5.75], to: [7.3, 9.85], thickness: 0.15 },
];

const build = {
  levels: [
    { name: 'Level 1', elevation: 0, layout: 'a' },
    { name: 'Level 2', elevation: 3, layout: 'a' },
  ],
  layouts: { a: { walls, floors: [[[0, 0], [12, 0], [12, 10], [0, 10]]] } },
};

const doors = [
  { asset: DOOR, level: 'Level 1', at: [6, 0.15] },
  { asset: DOOR, level: 'Level 1', at: [2.5, 4.25] },
  { asset: DOOR, level: 'Level 1', at: [9.5, 4.25] },
  { asset: DOOR, level: 'Level 1', at: [2.5, 5.75] },
  { asset: DOOR, level: 'Level 1', at: [9.5, 5.75] },
  { asset: DOOR, level: 'Level 2', at: [2.5, 4.25] },
  { asset: DOOR, level: 'Level 2', at: [9.5, 4.25] },
  { asset: DOOR, level: 'Level 2', at: [2.5, 5.75] },
  { asset: DOOR, level: 'Level 2', at: [9.5, 5.75] },
];

const bPlan = (over: Record<string, unknown> = {}) => ({
  lot: { width: 14, depth: 12 },
  apartments: { 'Level 1': 4, 'Level 2': 4 },
  build,
  doors,
  stairs: [{ from: 'Level 1', to: 'Level 2', shape: 'u' }],
  ...over,
});

describe('stableKey', () => {
  it('it ignores the order of the keys and distinguishes the values', () => {
    expect(stableKey({ b: 1, a: 2 })).toBe(stableKey({ a: 2, b: 1 }));
    expect(stableKey({ a: 1 })).not.toBe(stableKey({ a: 2 }));
    expect(stableKey([{ b: 1, a: 2 }])).toBe(stableKey([{ a: 2, b: 1 }]));
  });
});

describe('parsePlan', () => {
  it('it reads a minimal plan and normalizes the build with fresh', () => {
    const p = parsePlan({
      lot: { width: 10, depth: 20 },
      build: { levels: [{ name: 'Level 1', elevation: 0, layout: 'a' }], layouts: { a: { walls: [], floors: [] } } },
    });
    expect(p.lot).toEqual({ width: 10, depth: 20, setback: 0 });
    expect(p.build.fresh).toBe(true);
    expect(p.doors).toBeNull();
    expect(p.stairs).toEqual([]);
    expect(p.apartments).toEqual({});
    expect(p.buildKey).toBe(stableKey({ levels: [{ name: 'Level 1', elevation: 0, layout: 'a' }], layouts: { a: { walls: [], floors: [] } } }));
  });

  it('it rejects what is missing and what is wrong', () => {
    expect(() => parsePlan({ build: {} })).toThrow("review_plan: 'lot' needs width and depth in meters");
    expect(() => parsePlan({ lot: { width: 1, depth: 1 } })).toThrow("review_plan: 'build' is required");
    expect(() => parsePlan({ lot: { width: 0, depth: 1 }, build: build })).toThrow(/lot/);
    expect(() =>
      parsePlan({ lot: { width: 1, depth: 1 }, build: { levels: [] } }),
    ).toThrow(/review_plan: 'levels' must be a non-empty array/);
    expect(() =>
      parsePlan({ lot: { width: 1, depth: 1 }, build, doors: [{ asset: DOOR, wall: 'w', offset: 1 }] }),
    ).toThrow(/level' with 'at'/);
  });

  it('the doors are read only by level and point', () => {
    const p = parsePlan(bPlan());
    expect(p.doors?.items[0]).toEqual({ asset: DOOR, level: 'Level 1', at: [6, 0.15] });
  });
});

describe('reviewPlan', () => {
  it('the plan of building B is reviewed whole and the returned stairs are applied as they are', () => {
    const out = reviewPlan(parsePlan(bPlan()), ASSETS);
    expect(out.review.ok, JSON.stringify(out.review.checks.filter((c) => !c.ok), null, 2)).toBe(true);
    expect(out.stairs).toHaveLength(1);
    const stair = out.stairs[0];

    const doc = newDocument();
    applyBuild(doc, parseBuildRequest(build));
    applyPlace(doc, parsePlan(bPlan()).doors!, ASSETS);
    applyStairs(doc, { items: [stair] });
    expect(doc.stairs[0]).toMatchObject({
      shape: 'u',
      origin: stair.at,
      angle: stair.rotation,
      width: stair.width,
    });
  });

  it('una puerta en un punto sin muro se informa sin construir', () => {
    const out = reviewPlan(parsePlan(bPlan({ doors: [{ asset: DOOR, level: 'Level 1', at: [1, 1] }] })), ASSETS);
    expect(out.review.ok).toBe(false);
    expect(out.review.checks[0]).toMatchObject({ id: 'rooms-access', ok: false });
    expect(out.review.checks[0].detail).toContain('no wall of Level 1 passes through [1, 1]');
  });

  it('si no cabe una escalera lo dice y no devuelve ninguna', () => {
    const tiny = {
      levels: [
        { name: 'Level 1', elevation: 0, layout: 'a' },
        { name: 'Level 2', elevation: 3, layout: 'a' },
      ],
      layouts: {
        a: {
          walls: [
            { from: [0.15, 0.15], to: [3.85, 0.15], thickness: 0.3 },
            { from: [3.85, 0.15], to: [3.85, 2.85], thickness: 0.3 },
            { from: [3.85, 2.85], to: [0.15, 2.85], thickness: 0.3 },
            { from: [0.15, 2.85], to: [0.15, 0.15], thickness: 0.3 },
          ],
          floors: [[[0, 0], [4, 0], [4, 3], [0, 3]]],
        },
      },
    };
    const out = reviewPlan(parsePlan({
      lot: { width: 6, depth: 5 },
      build: tiny,
      stairs: [{ from: 'Level 1', to: 'Level 2', shape: 'u' }],
    }), ASSETS);
    expect(out.review.ok).toBe(false);
    expect(out.stairs).toHaveLength(0);
    const stairs = out.review.checks.filter((c) => c.id === 'stairs');
    expect(stairs[0].detail).toContain('no valid place for a u stair between Level 1 and Level 2');
  });

  it('buildKey changes with a coordinate of the build and not with the doors', () => {
    const a = parsePlan(bPlan());
    const moved = JSON.parse(JSON.stringify(build));
    moved.layouts.a.walls[0].from = [0.2, 0.15];
    const b = parsePlan(bPlan({ build: moved }));
    const c = parsePlan(bPlan({ doors: doors.slice(0, 1) }));
    expect(a.buildKey).not.toBe(b.buildKey);
    expect(a.buildKey).toBe(c.buildKey);
  });
});
