import { describe, expect, it } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { bareElementRows } from '../src/render/barerows';
import type { QuantityRow } from '../src/render/viewer';

/** Views (all) root with 3D, Floor Plans and Elevations
 *  una luminaria sin malla con su puerto y una rejilla. */
function tree() {
  const nodes: ComposedNode[] = [];
  const node = (path: string, cls: string | null, parent: ComposedNode | null): ComposedNode => {
    const n = { path, name: path.split('/').pop()!, attributes: cls ? { 'bsi::ifc::class': { code: cls } } : {}, children: [], parent } as unknown as ComposedNode;
    parent?.children.push(n);
    nodes.push(n);
    return n;
  };
  const storey = node('/L1', 'IfcBuildingStorey', null);
  const wall = node('/L1/wall', 'IfcWall', storey);
  node('/L1/wall/door', 'IfcDoor', wall);
  const cw = node('/L1/cw', 'IfcCurtainWall', storey);
  node('/L1/cw/panel', 'IfcPlate', cw);
  const lamp = node('/L1/lamp', 'IfcLightFixture', storey);
  node('/L1/lamp/port', 'IfcDistributionPort', lamp);
  node('/L1/grid', 'IfcGrid', storey);
  const plan = node('/plan', 'IfcWorkSchedule', null); // el cronograma y el presupuesto importados no son obra
  node('/plan/task', 'IfcTask', plan);
  node('/boq', 'IfcCostItem', null);
  const row = (element: string): QuantityRow => ({
    element, name: element, cls: 'x', storey: 'L1', material: '', materialCode: null, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 1,
  });
  return { nodes, rows: [row('/L1/wall'), row('/L1/cw/panel')] };
}

describe('elementos sin malla', () => {
  it('without levels: only child (no levels) without view', () => {
    const { nodes, rows } = tree();
    const bare = bareElementRows(nodes, rows, (n) => (n.path === '/L1/wall/door' ? [5, 6, 7] : [0, 0, 3]));
    expect(bare.map((r) => r.element).sort()).toEqual(['/L1/lamp', '/L1/wall/door']); // ni el muro cortina, ni el puerto, ni la rejilla
    const door = bare.find((r) => r.element === '/L1/wall/door')!;
    expect(door).toMatchObject({ cls: 'IfcDoor', storey: 'L1', volume: 0, area: 0, box: [5, 6, 7, 5, 6, 7] });
  });

  it('lo que no se muestra no cuenta', () => {
    const { nodes, rows } = tree();
    const bare = bareElementRows(nodes, rows, () => [0, 0, 0], (n) => n.path !== '/L1/lamp');
    expect(bare.map((r) => r.element)).toEqual(['/L1/wall/door']);
  });
});
