import { describe, expect, it } from 'vitest';
import {
  buildSystem, isPrefix, itemPath, K_MEDICION, levelOf, significant, systemFromFile, tableKey,
  type ClassSystemInfo,
} from '../src/classification/system';
import type { IfcxFile } from '../src/ifcx/types';

const INFO: ClassSystemInfo = { id: 'omniclass-22', name: 'OmniClass', table: '22', title: 'Work Results', edition: '2012-05-16', starter: false };

describe('it is a flat list: the root hangs all the items and none has children nor the previous format', () => {
  it.each([
    ['21-02 00 00', 1],
    ['21-02 10 00', 2],
    ['21-02 10 10', 3],
    ['21-02 10 10 10', 4],
    ['22-03 31 13.13', 4],
    ['22-03 00 00', 1],
    ['abc', 0],
    ['21-2 10', 0],
  ])('levelOf(%s) = %i', (code, level) => {
    expect(levelOf(code)).toBe(level);
  });

  it('significant quita los pares finales a cero', () => {
    expect(significant('21-02 10 00')).toEqual(['21', '02', '10']);
    expect(significant('22-03 31 13.13')).toEqual(['22', '03', '31', '13', '.13']);
    expect(significant('nope')).toBeNull();
  });

  it('isPrefix compara por pares completos', () => {
    expect(isPrefix('21-02', '21-02 10 10')).toBe(true);
    expect(isPrefix('21-02 00 00', '21-02 10 10')).toBe(true);
    expect(isPrefix('21-02', '21-03 10 00')).toBe(false);
    expect(isPrefix('21-02 1', '21-02 10 10')).toBe(false);
    expect(isPrefix('21-02 10 10', '21-02')).toBe(false);
  });
});

describe('buildSystem', () => {
  const entries = [
    { code: '22-03 00 00', title: 'Concrete' },
    { code: '22-03 30 00', title: 'Cast-in-Place Concrete' },
    { code: '22-03 31 13.13', title: 'Heavyweight' },
  ];

  it('the measurement of the item travels in prj::medicion', () => {
    const sys = systemFromFile(buildSystem(INFO, entries))!;
    expect(sys.children(null).map((e) => e.code)).toEqual(['22-03 00 00']);
    expect(sys.children('22-03 00 00').map((e) => e.code)).toEqual(['22-03 30 00', '22-03 31 13.13']);
    expect(sys.parent('22-03 31 13.13')!.code).toBe('22-03 00 00'); // 22-03 31 00 no existe
    expect(sys.parent('22-03 00 00')).toBeNull();
  });

  it('itemPath is deterministic per code: reimporting the table does not break references', () => {
    const file = buildSystem(INFO, entries);
    const root = file.data.find((n) => n.path === INFO.id)!;
    expect(Object.values(root.children!)).toEqual(entries.map((e) => itemPath(INFO.id, e.code)));
    const items = file.data.filter((n) => n.path !== INFO.id);
    expect(items).toHaveLength(3);
    for (const n of items) {
      expect(n.children).toBeUndefined();
      expect(Object.keys(n.attributes!)).toEqual([tableKey('22')]);
    }
    expect(items[1].attributes![tableKey('22')]).toEqual({ code: '22-03 30 00', name: 'Cast-in-Place Concrete' });
    expect(Object.keys(file.schemas!).sort()).toEqual(
      ['omniclass::Table22', 'prj::medicion', 'prj::origen', 'prj::precio', 'prj::referencia', 'studio::classification::system'].sort(),
    );
  });

  it('round trip keeps the information and the entries', () => {
    const medicion = { unit: 'm', measure: 'length', quantity: ['Depth'] };
    const file = buildSystem(INFO, [{ code: '22-03 00 00', title: 'Concrete', medicion }]);
    const item = file.data.find((n) => n.path === itemPath(INFO.id, '22-03 00 00'))!;
    expect(item.attributes![K_MEDICION]).toEqual(medicion);
    expect(systemFromFile(file)!.entries[0].medicion).toEqual(medicion);
  });

  it('a file without a root is not a system and an entry with an invalid code is ignored', () => {
    expect(itemPath('omniclass-21', '21-01 10 20.15')).toBe('omniclass-21-21-01_10_20_15');
    expect(itemPath('omniclass-21', '21-01 10 20.15')).toBe(itemPath('omniclass-21', '21-01 10 20.15'));
  });

  it('previous format (hierarchical items with studio::classification::item)', () => {
    const sys = systemFromFile(buildSystem(INFO, entries))!;
    expect(sys.info).toEqual(INFO);
    expect(sys.entries).toEqual(entries.map((e) => ({ ...e, level: levelOf(e.code) })));
    expect(sys.title('22-03 30 00')).toBe('Cast-in-Place Concrete');
    expect(sys.title('22-99 00 00')).toBeNull();
  });

  it('the initial files of the app are of the previous format', () => {
    const file = buildSystem(INFO, entries);
    expect(systemFromFile({ ...file, data: file.data.slice(1) })).toBeNull();
    file.data.push({ path: 'x', attributes: { [tableKey('22')]: { code: 'basura', name: 'x' } } });
    file.data.push({ path: 'y', attributes: { 'studio::classification::item': { code: 'basura', title: 'x', level: 1 } } });
    expect(systemFromFile(file)!.entries).toHaveLength(3);
  });

  it('un sistema plano se puede heredar (flat) y recuerda su archivo', () => {
    const sys = systemFromFile(buildSystem(INFO, entries), 'C:/t/omniclass-22.ifcx')!;
    expect(sys.flat).toBe(true);
    expect(sys.path).toBe('C:/t/omniclass-22.ifcx');
    expect(systemFromFile(buildSystem(INFO, entries))!.path).toBeUndefined();
  });
});

describe('What the spec guarantees and nothing more: if a code is missing or extra here, the initial file is wrong.', () => {
  const old: IfcxFile = {
    header: { id: 'x', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
    imports: [],
    schemas: {},
    data: [
      { path: 'omniclass-21', children: { a: 'i1' }, attributes: { 'studio::classification::system': { id: 'omniclass-21', name: 'OmniClass', table: '21', title: 'Elements', edition: 'x' } } },
      { path: 'i1', children: { b: 'i2' }, attributes: { 'studio::classification::item': { code: '21-01 00 00', title: 'Substructure', level: 1 } } },
      { path: 'i2', attributes: { 'studio::classification::item': { code: '21-01 10 00', title: 'Foundations', level: 2 } } },
    ],
  };

  it('se lee igual, pero no se puede heredar', () => {
    const sys = systemFromFile(old)!;
    expect(sys.entries.map((e) => [e.code, e.title, e.level])).toEqual([['21-01 00 00', 'Substructure', 1], ['21-01 10 00', 'Foundations', 2]]);
    expect(sys.children('21-01 00 00').map((e) => e.code)).toEqual(['21-01 10 00']);
    expect(sys.flat).toBe(false);
  });
});
