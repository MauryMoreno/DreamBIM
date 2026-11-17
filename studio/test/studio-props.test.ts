import { describe, expect, it, vi } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { buildPropertyGroups, type RowEdit } from '../src/properties/groups';
import { formatLength, parseLength, studioGroups, type StudioProps } from '../src/properties/studio';
import type { FloorParams, LevelParams, WallParams } from '../src/modeling/document';

function node(name: string, origin: string, attributes: Record<string, unknown> = {}, parent: ComposedNode | null = null): ComposedNode {
  const n: ComposedNode = { path: `${parent?.path ?? ''}/${name}`, name, origin, attributes, children: [], parent };
  parent?.children.push(n);
  return n;
}

const L1: LevelParams = { id: 'l1', name: 'Level 1', elevation: 0 };
const L2: LevelParams = { id: 'l2', name: 'Level 2', elevation: 3 };
const muro = (over: Partial<WallParams> = {}): WallParams => ({
  id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.2, bodyId: 'b', axisId: 'a',
  baseLevelId: 'l1', baseOffset: 0, topLevelId: null, topOffset: 0, height: 3, ...over,
});

function ctx(walls: WallParams[] = [], levels: LevelParams[] = [L2, L1], floors: FloorParams[] = []) {
  const c = {
    levels: () => levels,
    walls: () => walls,
    floor: (id: string) => floors.find((f) => f.id === id),
    setFloorConstraints: vi.fn(async (_id: string, _p: object) => true),
    wall: (id: string) => walls.find((w) => w.id === id),
    renameLevel: vi.fn(async (_id: string, _name: string) => true),
    setLevelElevation: vi.fn(async (_id: string, _e: number) => true),
    setWallConstraints: vi.fn(async (_id: string, _p: object) => true),
  };
  return c satisfies StudioProps;
}

type Row = { label: string; value: string; edit?: RowEdit };
const labels = (rows: { label: string }[]) => rows.map((r) => r.label);
const byLabel = (rows: Row[], l: string) => rows.find((r) => r.label === l)!;
const asLength = (r: Row) => r.edit as Extract<RowEdit, { kind: 'length' }>;
const asSelect = (r: Row) => r.edit as Extract<RowEdit, { kind: 'select' }>;
const asText = (r: Row) => r.edit as Extract<RowEdit, { kind: 'text' }>;

describe('parseLength / formatLength', () => {
  it('acepta coma, espacios y sufijo m', () => {
    expect(parseLength('3')).toBe(3);
    expect(parseLength(' 3,5 m ')).toBe(3.5);
    expect(parseLength('-0.25')).toBe(-0.25);
  });
  it('it returns null with empty or non-numeric text', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('3..5')).toBeNull();
  });
  it('formatLength usa tres decimales y nunca -0.000', () => {
    expect(formatLength(3)).toBe('3.000');
    expect(formatLength(-0)).toBe('0.000');
    expect(formatLength(-0.0001)).toBe('0.000');
  });
});

describe('studioGroups: nivel', () => {
  it('Elevation y Name editables que llaman al contexto', async () => {
    const c = ctx();
    const g = studioGroups(node('storey', 'l2'), c)!;
    const elev = byLabel(g.constraints, 'Elevation');
    expect(elev.value).toBe('3.000');
    expect(elev.edit!.kind).toBe('length');
    await asLength(elev).commit(4);
    expect(c.setLevelElevation).toHaveBeenCalledWith('l2', 4);
    const name = g.name!;
    expect(name.value).toBe('Level 2');
    await asText(name).commit('Roof');
    expect(c.renameLevel).toHaveBeenCalledWith('l2', 'Roof');
  });
});

describe('studioGroups: muro', () => {
  it('muro libre: filas en el orden de Revit y Top Offset sin editar', () => {
    const g = studioGroups(node('wall', 'w1'), ctx([muro()]))!;
    expect(labels(g.constraints)).toEqual(['Location Line', 'Base Constraint', 'Base Offset', 'Top Constraint', 'Unconnected Height', 'Top Offset']);
    expect(byLabel(g.constraints, 'Location Line')).toMatchObject({ value: 'Wall Centerline' });
    expect(byLabel(g.constraints, 'Location Line').edit).toBeUndefined();
    expect(byLabel(g.constraints, 'Top Constraint').value).toBe('Unconnected');
    expect(byLabel(g.constraints, 'Unconnected Height').edit?.kind).toBe('length');
    expect(byLabel(g.constraints, 'Top Offset')).toMatchObject({ value: '' });
    expect(byLabel(g.constraints, 'Top Offset').edit).toBeUndefined();
  });

  it('the level options come out sorted by elevation even if levels() is not', () => {
    const g = studioGroups(node('wall', 'w1'), ctx([muro()]))!;
    const base = asSelect(byLabel(g.constraints, 'Base Constraint'));
    expect(base.options).toEqual([{ value: 'l1', label: 'Level 1' }, { value: 'l2', label: 'Level 2' }]);
    expect(base.selected).toBe('l1');
    const top = asSelect(byLabel(g.constraints, 'Top Constraint'));
    expect(top.options).toEqual([
      { value: '', label: 'Unconnected' },
      { value: 'l1', label: 'Up to level: Level 1' },
      { value: 'l2', label: 'Up to level: Level 2' },
    ]);
  });

  it('muro atado: Unconnected Height solo muestra la altura resultante; Top Offset editable', async () => {
    const c = ctx([muro({ topLevelId: 'l2', topOffset: -0.5 })]);
    const g = studioGroups(node('wall', 'w1'), c)!;
    expect(byLabel(g.constraints, 'Top Constraint').value).toBe('Up to level: Level 2');
    expect(byLabel(g.constraints, 'Unconnected Height')).toMatchObject({ value: '2.500' });
    expect(byLabel(g.constraints, 'Unconnected Height').edit).toBeUndefined();
    expect(byLabel(g.constraints, 'Top Offset')).toMatchObject({ value: '-0.500' });
    expect(byLabel(g.constraints, 'Top Offset').edit?.kind).toBe('length');
    const top = asSelect(byLabel(g.constraints, 'Top Constraint'));
    await top.commit('');
    expect(c.setWallConstraints).toHaveBeenCalledWith('w1', { topLevelId: null });
    await top.commit('l1');
    expect(c.setWallConstraints).toHaveBeenLastCalledWith('w1', { topLevelId: 'l1' });
  });

  it('the numeric fields call setWallConstraints with their field', async () => {
    const c = ctx([muro()]);
    const g = studioGroups(node('wall', 'w1'), c)!;
    await asLength(byLabel(g.constraints, 'Base Offset')).commit(0.5);
    expect(c.setWallConstraints).toHaveBeenLastCalledWith('w1', { baseOffset: 0.5 });
    await asLength(byLabel(g.constraints, 'Unconnected Height')).commit(2.5);
    expect(c.setWallConstraints).toHaveBeenLastCalledWith('w1', { height: 2.5 });
    await asSelect(byLabel(g.constraints, 'Base Constraint')).commit('l2');
    expect(c.setWallConstraints).toHaveBeenLastCalledWith('w1', { baseLevelId: 'l2' });
  });
});

describe('buildPropertyGroups con contexto de Studio', () => {
  it('un nodo ajeno a Studio no cambia', () => {
    const lone = node('lone', 'x', { 'bsi::ifc::class': { code: 'IfcWall' } });
    expect(studioGroups(lone, ctx())).toBeNull();
    expect(buildPropertyGroups(lone, {}, ctx())).toEqual(buildPropertyGroups(lone, {}));
  });

  it('a Studio wall replaces the generic Constraints group', () => {
    const storey = node('storey', 'l1', { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } });
    const w = node('wall', 'w1', { 'bsi::ifc::class': { code: 'IfcWall' } }, storey);
    const groups = buildPropertyGroups(w, {}, ctx([muro()]));
    expect(groups[0].title).toBe('Constraints');
    expect(labels(groups[0].rows)).not.toContain('Level');
    expect(labels(groups[0].rows)).toContain('Base Constraint');
    expect(groups.filter((g) => g.title === 'Constraints')).toHaveLength(1);
  });

  it('un nivel de Studio lleva Elevation en Constraints y su Name editable', () => {
    const storey = node('storey', 'l2', { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } });
    const groups = buildPropertyGroups(storey, {}, ctx());
    expect(labels(groups[0].rows)).toEqual(['Elevation']);
    const identity = groups.find((g) => g.title === 'Identity Data')!;
    expect(identity.rows.find((r) => r.label === 'Name')!.edit?.kind).toBe('text');
  });
});

describe('studioGroups: suelo', () => {
  const suelo = (over: Partial<FloorParams> = {}): FloorParams => ({
    id: 'f1', bodyId: 'fb', levelId: 'l1', offset: -0.05, thickness: 0.3,
    boundary: [[0, 0], [4, 0], [4, 3], [0, 3]], ...over,
  });

  it('Level (select) y Height Offset From Level (length) editables', () => {
    const g = studioGroups(node('floor', 'f1'), ctx([], [L2, L1], [suelo()]))!;
    expect(labels(g.constraints)).toEqual(['Level', 'Height Offset From Level']);
    const level = byLabel(g.constraints, 'Level');
    expect(level.value).toBe('Level 1');
    expect(asSelect(level).options).toEqual([{ value: 'l1', label: 'Level 1' }, { value: 'l2', label: 'Level 2' }]);
    expect(asSelect(level).selected).toBe('l1');
    expect(byLabel(g.constraints, 'Height Offset From Level').value).toBe('-0.050');
  });

  it('elegir otro nivel y escribir un offset llaman al contexto', async () => {
    const c = ctx([], [L2, L1], [suelo()]);
    const g = studioGroups(node('floor', 'f1'), c)!;
    await asSelect(byLabel(g.constraints, 'Level')).commit('l2');
    expect(c.setFloorConstraints).toHaveBeenCalledWith('f1', { levelId: 'l2' });
    await asLength(byLabel(g.constraints, 'Height Offset From Level')).commit(0.1);
    expect(c.setFloorConstraints).toHaveBeenCalledWith('f1', { offset: 0.1 });
  });

  it('un suelo no tiene fila Name editable (su nombre es el del tipo)', () => {
    expect(studioGroups(node('floor', 'f1'), ctx([], [L2, L1], [suelo()]))!.name).toBeUndefined();
  });

  it('un nodo que no es suelo, muro ni nivel no tiene filas propias', () => {
    expect(studioGroups(node('x', 'zzz'), ctx([], [L2, L1], [suelo()]))).toBeNull();
  });
});

