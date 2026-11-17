import { describe, expect, it } from 'vitest';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import { assignCost, emptyAssignment, INHERIT_COSTS } from '../src/costs/assign';

const file = (data: IfcxNode[]): IfcxFile => ({ ...emptyAssignment('casa.costos-asignacion'), data });

describe('assignCost', () => {
  it('it adds up the measure of the elements of an item and multiplies it by the price', () => {
    const f = emptyAssignment('casa.costos-asignacion');
    expect(f.header.id).toBe('casa.costos-asignacion');
    expect(f.imports).toEqual([]);
    expect(f.data).toEqual([]);
  });

  it('asigna creando un nodo por elemento', () => {
    const out = assignCost(file([]), ['E1', 'E2'], 'code-A');
    expect(out.data).toEqual([
      { path: 'E1', inherits: { [INHERIT_COSTS]: 'code-A' } },
      { path: 'E2', inherits: { [INHERIT_COSTS]: 'code-A' } },
    ]);
    expect(INHERIT_COSTS).toBe('costos');
  });

  it('reasignar reemplaza la herencia del mismo nodo, sin duplicarlo', () => {
    const once = assignCost(file([]), ['E1'], 'code-A');
    const twice = assignCost(once, ['E1'], 'code-B');
    expect(twice.data).toEqual([{ path: 'E1', inherits: { costos: 'code-B' } }]);
  });

  it('a heading line adds what hangs from it and the total adds the roots', () => {
    const f = file([{ path: 'E1', inherits: { material: 'm-1', costos: 'code-A' }, attributes: { x: 1 } }]);
    expect(assignCost(f, ['E1'], 'code-B').data).toEqual([{ path: 'E1', inherits: { material: 'm-1', costos: 'code-B' }, attributes: { x: 1 } }]);
    expect(assignCost(f, ['E1'], null).data).toEqual([{ path: 'E1', inherits: { material: 'm-1' }, attributes: { x: 1 } }]);
  });

  it('the total is the sum of the amount of the elements', () => {
    const f = file([{ path: 'E1', inherits: { costos: 'code-A' } }, { path: 'E2', inherits: { costos: 'code-A' } }]);
    expect(assignCost(f, ['E1'], null).data).toEqual([{ path: 'E2', inherits: { costos: 'code-A' } }]);
  });

  it('sin cambios devuelve el mismo archivo', () => {
    const f = file([{ path: 'E1', inherits: { costos: 'code-A' } }]);
    expect(assignCost(f, ['E1'], 'code-A')).toBe(f);
    expect(assignCost(f, ['E9'], null)).toBe(f);
    expect(assignCost(f, [], 'code-B')).toBe(f);
  });

  it('no modifica el archivo de entrada', () => {
    const f = file([{ path: 'E1', inherits: { costos: 'code-A' } }]);
    const copy = structuredClone(f);
    assignCost(f, ['E1', 'E2'], 'code-B');
    assignCost(f, ['E1'], null);
    expect(f).toEqual(copy);
  });
});
