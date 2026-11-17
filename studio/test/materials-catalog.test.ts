import { describe, expect, it } from 'vitest';
import type { QuantityRow } from '../src/render/viewer';
import { LAYER_COLORS } from '../src/composer/stack';
import { catalog, matchRule, modelColor, usage, type CatalogNode } from '../src/materials/catalog';

const row = (element: string, over: Partial<QuantityRow> = {}): QuantityRow => ({
  element, name: element, cls: 'IfcWall', storey: 'Level 1', material: 'x', materialCode: null, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 2, ...over,
});

const lib = (code: string, name = code, over: Partial<CatalogNode> = {}): CatalogNode => ({
  path: `n-${code}`,
  def: { name, code, color: '#8a8a8a', opacity: 1 },
  source: { role: 'import', name: 'lib', uri: '../lib.ifcx', location: 'C:/b/materiales/lib.ifcx' },
  site: 'library',
  overridden: [],
  ...over,
});
const STATE: CatalogNode[] = [lib('C30', 'Concrete C30')];

describe('catalog', () => {
  it('it joins the material nodes and the codes the model brings without a node, sorted by name', () => {
    const rows = [row('/a', { materialCode: 'C30' }), row('/b', { materialCode: 'Brick' }), row('/c', { materialCode: 'Brick' })];
    const c = catalog(STATE, rows);
    expect(c.map((e) => [e.def.code, e.path, e.site, e.elements])).toEqual([
      ['Brick', null, null, 2],
      ['C30', 'n-C30', 'library', 1],
    ]);
    expect(c[0].def.color).toBe(modelColor('Brick'));
  });

  it('un nodo sin uso aparece con cero elementos, su archivo y lo que el documento sobrescribe', () => {
    const c = catalog([lib('C30', 'Concrete C30', { overridden: ['bsi::ifc::presentation::diffuseColor'] })], []);
    expect(c[0]).toMatchObject({
      elements: 0, sourceName: 'lib.ifcx', overridden: ['bsi::ifc::presentation::diffuseColor'], site: 'library',
    });
  });

  it('a material of the document itself has no file to name', () => {
    const c = catalog([lib('X', 'X', { site: 'document' })], []);
    expect(c[0].sourceName).toBeNull();
  });
});

describe('usage', () => {
  it('un elemento con dos mallas cuenta una vez y suma sus medidas', () => {
    const rows = [
      row('/a', { materialCode: 'C30', volume: 1, area: 2 }),
      row('/a', { materialCode: 'C30', volume: 1, area: 3 }),
      row('/b', { materialCode: 'C30', volume: 4, area: 1 }),
    ];
    const u = usage(catalog(STATE, rows), rows);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ code: 'C30', name: 'Concrete C30', elements: 2, volume: 6, area: 6 });
    expect(u[0].paths).toEqual(['/a', '/b']);
  });

  it('elements without a material go in a final "No material" row', () => {
    const rows = [row('/a', { materialCode: 'C30' }), row('/b')];
    const u = usage(catalog(STATE, rows), rows);
    expect(u.map((r) => r.code)).toEqual(['C30', '']);
    expect(u[1]).toMatchObject({ name: 'No material', elements: 1 });
  });
});

describe('matchRule', () => {
  const rows = [
    row('/w1', { cls: 'IfcWall', storey: 'Level 1' }),
    row('/w1', { cls: 'IfcWall', storey: 'Level 1' }),
    row('/w2', { cls: 'IfcWall', storey: 'Level 2', materialCode: 'C30' }),
    row('/s1', { cls: 'IfcSlab', storey: 'Level 1' }),
  ];
  it('filtra por clase y nivel sin repetir rutas', () => {
    expect(matchRule(rows, { cls: 'IfcWall', storey: 'Level 1' })).toEqual(['/w1']);
  });
  it('empty material = elements without a material', () => {
    expect(matchRule(rows, { material: '' }).sort()).toEqual(['/s1', '/w1']);
  });
  it('un material concreto', () => {
    expect(matchRule(rows, { material: 'C30' })).toEqual(['/w2']);
  });
  it('sin campos coincide con todos', () => {
    expect(matchRule(rows, {})).toHaveLength(3);
  });
});

describe('modelColor', () => {
  it('es estable y sale de la paleta de capas', () => {
    expect(modelColor('Brick')).toBe(modelColor('Brick'));
    expect(LAYER_COLORS).toContain(modelColor('Brick'));
  });
});
