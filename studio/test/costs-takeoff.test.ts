import { describe, expect, it } from 'vitest';
import type { QuantityRow } from '../src/render/viewer';
import { COST_RAMP, itemColor, rampColor } from '../src/costs/colors';
import { elementMeasures, valueOf, type ElementMeasures } from '../src/costs/takeoff';
import type { MaterialDef } from '../src/materials/state';

const row = (element: string, over: Partial<QuantityRow> = {}): QuantityRow => ({
  element, name: element, cls: 'IfcWall', storey: 'Level 1', material: '', materialCode: null,
  box: [0, 0, 0, 4, 0.2, 3], volume: 2.4, area: 30, ...over,
});
const none: MaterialDef[] = [];
const noWalls = () => null;

describe('elementMeasures', () => {
  it('a wall: the area is length × height of its box and the length is its axis when known', () => {
    const m = elementMeasures([row('/w')], none, (p) => (p === '/w' ? 3.9 : null)).get('/w')!;
    expect(m.area).toBeCloseTo(12, 6);
    expect(m.length).toBeCloseTo(3.9, 6);
    expect(m.volume).toBeCloseTo(2.4, 6);
    expect(m.count).toBe(1);
  });

  it('a slab: the area is its plan and the length the longer side', () => {
    const m = elementMeasures([row('/s', { cls: 'IfcSlab', box: [0, 0, 0, 5, 4, 0.2] })], none, noWalls).get('/s')!;
    expect(m.area).toBeCloseTo(20, 6);
    expect(m.length).toBeCloseTo(5, 6);
  });

  it('an element with two meshes adds the volumes and joins the boxes', () => {
    const m = elementMeasures(
      [row('/e', { box: [0, 0, 0, 1, 1, 1], volume: 1 }), row('/e', { box: [1, 0, 0, 3, 1, 1], volume: 2 })],
      none,
      noWalls,
    ).get('/e')!;
    expect(m.volume).toBe(3);
    expect(m.length).toBeCloseTo(3, 6);
    expect(m.area).toBeCloseTo(3, 6);
  });

  it('el peso es volumen × densidad; sin densidad es null', () => {
    const dense: MaterialDef[] = [{ name: 'C30', code: 'C30', color: '#000000', opacity: 1, density: 2400 }];
    expect(elementMeasures([row('/a', { materialCode: 'C30', volume: 1 })], dense, noWalls).get('/a')!.weight).toBe(2400);
    expect(elementMeasures([row('/a', { materialCode: 'C30', volume: 1 })], none, noWalls).get('/a')!.weight).toBeNull();
    expect(elementMeasures([row('/a')], dense, noWalls).get('/a')!.weight).toBeNull();
  });
});

describe('valueOf', () => {
  const m: ElementMeasures = { path: '/e', count: 1, length: 4, area: 12, volume: 2.4, weight: null };
  it('da la medida pedida y el peso sin densidad cuenta 0', () => {
    expect(valueOf(m, 'count')).toBe(1);
    expect(valueOf(m, 'length')).toBe(4);
    expect(valueOf(m, 'area')).toBe(12);
    expect(valueOf(m, 'volume')).toBe(2.4);
    expect(valueOf(m, 'weight')).toBe(0);
    expect(valueOf({ ...m, weight: 18840 }, 'weight')).toBe(18840);
  });
});

describe('colores', () => {
  it('the ramp gives the first step to the minimum and the last to the maximum', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(rampColor(1, sorted)).toBe(COST_RAMP[0]);
    expect(rampColor(10, sorted)).toBe(COST_RAMP[4]);
    expect(rampColor(5, sorted)).toBe(COST_RAMP[2]);
  });
  it('the items rotate through the layer palette', () => {
    expect(itemColor(0)).toBe(itemColor(8));
    expect(itemColor(0)).not.toBe(itemColor(1));
  });
});
