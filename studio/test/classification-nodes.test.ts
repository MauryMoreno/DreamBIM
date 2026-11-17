// lists the codes of the imported table, with their name, their measurement and the file that defines them
import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { classItems, elementClass, K_TABLE21, K_TABLE22 } from '../src/classification/nodes';
import { K_ASSIGN_21 } from '../src/classification/state';
import { buildSystem, itemPath, type ClassSystemInfo } from '../src/classification/system';

const INFO: ClassSystemInfo = { id: 'omniclass-21', name: 'OmniClass', table: '21', title: 'Elements', edition: '2012', starter: false };
const BORED = '21-01 10 20 15';
const MEDICION = { unit: 'm', measure: 'length', quantity: ['Depth'] };

const table = buildSystem(INFO, [
  { code: '21-01 00 00', title: 'Substructure' },
  { code: BORED, title: 'Bored Piles', medicion: MEDICION },
  { code: '21-02 00 00', title: 'Shell' },
]);

const file = (id: string, data: IfcxNode[]): IfcxFile => ({
  header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data,
});
const cls = { 'bsi::ifc::class': { code: 'IfcPile' } };
const model = file('m', [
  { path: 'P1', inherits: { omniclass21: itemPath(INFO.id, BORED) }, attributes: cls },
  { path: 'P2', attributes: { ...cls, [K_TABLE21]: { code: '21-02 00 00', name: 'Shell' } } },
  { path: 'P3', attributes: { ...cls, [K_ASSIGN_21]: { code: '21-01 00 00', title: 'Substructure' } } },
  { path: 'P4', attributes: cls },
  { path: 'P5', attributes: { ...cls, [K_TABLE21]: { code: 'X' } } },
  // the one that inherits the item has its code and its title
  { path: 'P6', inherits: { omniclass21: itemPath(INFO.id, BORED) }, attributes: { ...cls, [K_TABLE21]: { code: BORED, name: 'Bored Piles' } } },
]);
const src = (name: string): ProvenanceSource => ({ role: 'import', name, uri: name, location: `C:/t/${name}` });
const docSrc: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document' };

const compose2 = (...layers: IfcxFile[]) => compose(layers, { sources: [src('omniclass-21.ifcx'), docSrc, ...layers.slice(2).map(() => docSrc)] });

describe('classItems', () => {
  const r = compose2(table, model);

  it('the own value counts as a code', () => {
    const items = classItems(r);
    expect(items.map((i) => [i.table, i.code, i.name])).toEqual([
      ['21', '21-01 00 00', 'Substructure'],
      ['21', BORED, 'Bored Piles'],
      ['21', '21-02 00 00', 'Shell'],
    ]);
    const bored = items.find((i) => i.code === BORED)!;
    expect(bored.path).toBe(itemPath(INFO.id, BORED));
    expect(bored.medicion).toEqual(MEDICION);
    expect(bored.source.location).toBe('C:/t/omniclass-21.ifcx');
  });

  it('un elemento con clase no es un item aunque traiga el atributo', () => {
    expect(classItems(r).some((i) => i.path === 'P6' || i.path === 'P2')).toBe(false);
  });

  it('la tabla 22 usa su propia clave', () => {
    const t22 = buildSystem({ ...INFO, id: 'omniclass-22', table: '22' }, [{ code: '22-03 00 00', title: 'Concrete' }]);
    const items = classItems(compose([t22, file('m', [])], { sources: [src('omniclass-22.ifcx'), docSrc] }));
    expect(items.map((i) => [i.table, i.code])).toEqual([['22', '22-03 00 00']]);
    expect(K_TABLE22).toBe('omniclass::Table22');
  });
});

describe('elementClass', () => {
  const r = compose2(table, model);
  const of = (origin: string, result = r) => elementClass(result.byOrigin.get(origin)![0]);

  it('the previous key of the cards made earlier is still read', () => {
    expect(of('P1')).toEqual({ code: BORED, title: 'Bored Piles' });
  });

  it('with nothing there is no code', () => {
    expect(of('P2')).toEqual({ code: '21-02 00 00', title: 'Shell' });
  });

  it('a code that no item defines is shown with an empty title', () => {
    expect(of('P3')).toEqual({ code: '21-01 00 00', title: 'Substructure' });
  });

  it('a value layer on top of the card wins, like Z-0005', () => {
    expect(of('P4')).toBeNull();
  });

  it('levels of a code', () => {
    expect(of('P5')).toEqual({ code: 'X', title: '' });
  });

  it('the hierarchy comes from the codes, not from the nodes', () => {
    const values = file('values', [{ path: 'P1', attributes: { [K_TABLE21]: { code: '21-02 00 00', name: 'Shell' } } }]);
    const r2 = compose2(table, model, values);
    expect(of('P1', r2)).toEqual({ code: '21-02 00 00', title: 'Shell' });
  });

  it('si el nombre del item cambia en la tabla, llega al elemento sin tocar el modelo', () => {
    const renamed = buildSystem(INFO, [{ code: BORED, title: 'Drilled Shafts' }]);
    const r2 = compose([renamed, model], { sources: [src('omniclass-21.ifcx'), docSrc] });
    expect(of('P1', r2)).toEqual({ code: BORED, title: 'Drilled Shafts' });
  });
});
