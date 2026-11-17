import { describe, expect, it } from 'vitest';
import { computeBudget, NO_MATCH, type Budget } from '../src/costs/budget';
import type { CostCode, CostSystem, Measure } from '../src/costs/system';
import { NO_DENSITY, type ElementMeasures } from '../src/costs/takeoff';

const code = (c: string, over: Partial<CostCode> = {}): CostCode => ({
  path: `p-${c}`, code: c, name: c, parent: null, medicion: null, manualPrice: null, origin: null,
  unitPrice: 0, priceFrom: 'none', warning: null, role: 'import', location: 'C:/t/costos.ifcx', ...over,
});
const item = (c: string, measure: Measure, price: number, over: Partial<CostCode> = {}): CostCode =>
  code(c, { medicion: { unit: 'x', measure }, unitPrice: price, priceFrom: 'manual', manualPrice: price, ...over });

function system(codes: CostCode[]): CostSystem {
  const byCode = new Map(codes.map((c) => [c.code, c]));
  return {
    id: 's', name: 's', attribute: 'a', currency: 'USD', codes, byCode, warning: null, rootPath: 'root', role: 'import', location: 'C:/t/costos.ifcx',
    children: (p) => codes.filter((c) => c.parent === p).sort((a, b) => a.code.localeCompare(b.code)),
  };
}
const meas = (path: string, over: Partial<ElementMeasures> = {}): ElementMeasures => ({
  path, count: 1, length: 1, area: 1, volume: 1, weight: 1, ...over,
});
const els = (...paths: string[]) => paths.map((path) => ({ path, cls: 'IfcSlab' }));
const run = (codes: CostCode[], elements: { path: string; cls: string }[], codes_: Record<string, string>, m: ElementMeasures[]): Budget =>
  computeBudget(system(codes), elements, (p) => codes_[p] ?? null, new Map(m.map((x) => [x.path, x])));
describe('computeBudget', () => {
  it('an element repeated in the rows counts once', () => {
    const b = run([item('A', 'volume', 10)], els('a', 'b'), { a: 'A', b: 'A' }, [meas('a', { volume: 2 }), meas('b', { volume: 3 })]);
    const n = b.roots[0];
    expect(n.quantity).toBe(5);
    expect(n.total).toBe(50);
    expect(n.elements).toEqual(['a', 'b']);
    expect(b.elementCost.get('a')).toEqual({ code: 'A', amount: 20 });
    expect(b.elementCost.get('b')).toEqual({ code: 'A', amount: 30 });
  });

  it('cellName gives the cell as in a spreadsheet', () => {
    const b = run(
      [code('O'), item('O.1', 'count', 5, { parent: 'O' }), item('O.2', 'area', 2, { parent: 'O' }), item('Z', 'count', 1)],
      els('a', 'b', 'c'), { a: 'O.1', b: 'O.2', c: 'Z' }, [meas('a'), meas('b', { area: 4 }), meas('c')],
    );
    const o = b.roots.find((n) => n.code.code === 'O')!;
    expect(o.level).toBe(1);
    expect(o.children.map((n) => n.level)).toEqual([2, 2]);
    expect(o.total).toBe(5 + 8);
    expect(o.quantity).toBe(0);
    expect(b.total).toBe(5 + 8 + 1);
  });

  it('refLabel says it in words, also a box read with OCR', () => {
    const b = run(
      [code('O'), item('O.1', 'volume', 3.3, { parent: 'O' }), item('Z', 'length', 7)],
      els('a', 'b', 'c', 'd'), { a: 'O.1', b: 'O.1', c: 'Z', d: 'Z' },
      [meas('a', { volume: 1.1 }), meas('b', { volume: 2.2 }), meas('c', { length: 5 }), meas('d', { length: 0.5 })],
    );
    const sum = [...b.elementCost.values()].reduce((n, e) => n + e.amount, 0);
    expect(sum).toBeCloseTo(b.total, 9);
  });

  it('los elementos sin partida salen con su motivo', () => {
    const b = run(
      [code('O'), item('A', 'count', 1)], els('sin', 'raro', 'orden', 'ok'),
      { raro: 'NOPE', orden: 'O', ok: 'A' }, [meas('ok')],
    );
    expect(b.unassigned).toEqual([
      { path: 'sin', reason: 'No code' },
      { path: 'raro', reason: 'Code not in the cost system' },
      { path: 'orden', reason: 'Code is a heading, not an item' },
    ]);
    expect(b.elementCost.has('sin')).toBe(false);
  });

  it('un IfcSpace sin partida no se lista', () => {
    const b = run([item('A', 'count', 1)], [{ path: 's', cls: 'IfcSpace' }, ...els('x')], {}, []);
    expect(b.unassigned.map((u) => u.path)).toEqual(['x']);
  });

  it('numbersIn finds the loose figures and not those of a code', () => {
    const b = run([item('A', 'count', 2)], [...els('a'), ...els('a')], { a: 'A' }, [meas('a')]);
    expect(b.roots[0].quantity).toBe(1);
  });

  it('una partida sin elementos avisa', () => {
    const b = run([item('A', 'count', 2)], [], {}, []);
    expect(b.roots[0].warning).toBe(NO_MATCH);
    expect(b.total).toBe(0);
  });

  it('un peso sin densidad avisa', () => {
    const b = run([item('A', 'weight', 2)], els('a'), { a: 'A' }, [meas('a', { weight: null })]);
    expect(b.roots[0].warning).toBe(NO_DENSITY);
    expect(b.roots[0].total).toBe(0);
  });

  it('el aviso de precio de la partida se conserva', () => {
    const b = run([item('A', 'count', 0, { warning: 'No price', priceFrom: 'none', manualPrice: null })], els('a'), { a: 'A' }, [meas('a')]);
    expect(b.roots[0].warning).toBe('No price');
  });

  it('una partida con hijos suma su importe y el de sus hijos sin contar dos veces', () => {
    const b = run(
      [item('P', 'volume', 10), item('P.1', 'volume', 5, { parent: 'P' })], els('a', 'b'), { a: 'P', b: 'P.1' }, [meas('a'), meas('b')],
    );
    const p = b.roots[0];
    expect(p.total).toBe(15);
    expect(p.children[0].total).toBe(5);
    expect(b.total).toBe(15);
  });

  it('un elemento sin medidas cuenta cero', () => {
    const b = run([item('A', 'area', 4)], els('a'), { a: 'A' }, []);
    expect(b.roots[0].total).toBe(0);
    expect(b.elementCost.get('a')).toEqual({ code: 'A', amount: 0 });
  });

  it('lleva la moneda del sistema', () => {
    expect(run([], [], {}, []).currency).toBe('USD');
  });
});

