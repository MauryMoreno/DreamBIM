import { describe, expect, it } from 'vitest';
import { stairLayout } from '../src/modeling/stairlayout';

describe('stairLayout', () => {
  it('recta de 3 m: 17 contrahuellas, huellas y zonas libres', () => {
    const s = stairLayout(3, 'straight', 1.1, 0.2);
    expect(s.risers).toBe(17);
    expect(s.riser).toBeCloseTo(3 / 17, 9);
    expect(s.flights).toEqual([{ risers: 17, treads: 16, x0: 0, y: 0, dir: 1, z0: 0 }]);
    expect(s.footprint).toEqual({ x0: 0, x1: 4.48, y0: -0.55, y1: 0.55 });
    expect(s.bottomClear).toEqual({ x0: -1.1, x1: 0, y0: -0.55, y1: 0.55 });
    expect(s.topClear).toEqual({ x0: 4.48, x1: 5.58, y0: -0.55, y1: 0.55 });
    expect(s.opening.x0).toBeCloseTo(1.12);
    expect(s.opening.x1).toBeCloseTo(4.48);
    expect(s.rails.filter((r) => r.where === 'flight')).toHaveLength(2);
    expect(s.rails.filter((r) => r.where === 'opening')).toHaveLength(3);
  });

  it('en U de 3 m: dos tramos, descanso y hueco', () => {
    const u = stairLayout(3, 'u', 1.1, 0.2);
    expect(u.flights.map((f) => f.risers)).toEqual([9, 8]);
    expect(u.landing).toMatchObject({ x0: 2.24, x1: 3.34, y0: -0.55, y1: 1.75 });
    expect(u.landing!.z).toBeCloseTo((9 * 3) / 17);
    expect(u.footprint).toEqual({ x0: 0, x1: 3.34, y0: -0.55, y1: 1.75 });
    expect(u.topClear.x0).toBeCloseTo(0.28 - 1.1);
    expect(u.topClear).toMatchObject({ x1: 0.28, y0: 0.65, y1: 1.75 });
    expect(u.opening).toMatchObject({ x0: 0.28, x1: 3.34, y0: -0.55, y1: 1.75 });
    expect(stairLayout(3, 'u', 1.1, 0.2, 'right').topClear).toMatchObject({ y0: -1.75, y1: -0.65 });
  });

  it('rechaza alturas y anchos fuera de rango', () => {
    expect(() => stairLayout(4, 'straight', 1.1, 0.2)).toThrow(/at most 18 risers; this storey needs 23/);
    expect(() => stairLayout(0.5, 'straight', 1.1, 0.2)).toThrow(/between 1 and 6 m/);
    expect(() => stairLayout(3, 'u', 0.5, 0.2)).toThrow(/'width'/);
  });

  it('the clear zones have the depth of the width when it is greater than 1.1', () => {
    const s = stairLayout(3, 'straight', 1.5, 0.2);
    expect(s.bottomClear.x0).toBe(-1.5);
    expect(s.topClear.x1).toBeCloseTo(4.48 + 1.5);
  });

  it('the risers never exceed 0.178 for heights from 1 to 6 m', () => {
    for (let rise = 1; rise <= 6; rise += 0.05) {
      try {
        expect(stairLayout(rise, 'u', 1.1, 0.2).riser).toBeLessThanOrEqual(0.178 + 1e-12);
      } catch (e) {
        expect(String(e)).toContain('too low for a U stair');
      }
    }
  });
  it('una U en un piso alto no se rechaza aunque el tramo 1 conserve la altura libre', () => {
    for (const rise of [4.4, 5, 5.5]) {
      const u = stairLayout(rise, 'u', 1.1, 0.2);
      expect(u.riser).toBeLessThanOrEqual(0.178 + 1e-12);
      expect(u.opening.x0).toBeCloseTo(u.topClear.x1);
    }
  });
});
