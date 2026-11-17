import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import type { IfcxFile } from '../src/ifcx/types';
import { applyEdits, BASE_URI, foreignFromFile } from '../src/modeling/foreign';
import { sessionModel } from '../src/modeling/session';
import { translation } from '../src/composer/xform';

/** Un IFCx convertido de IFC: con su propio esquema, un nodo con dos entradas y propiedades que Studio no conoce. */
const converted = (): IfcxFile => ({
  header: { id: 'p1', ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'ifc2ifcx', timestamp: 't' },
  imports: [{ uri: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx' }],
  schemas: { 'x::custom': { value: { dataType: 'String' } } },
  data: [
    { path: 'P', children: { site: 'S' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' }, 'x::custom': 'keep' } },
    { path: 'S', children: { l1: 'L1', l2: 'L2' } },
    { path: 'L1', children: { w: 'W' } },
    { path: 'L2' },
    { path: 'W', attributes: { 'bsi::ifc::prop::Name': 'Wall A' } },
    { path: 'W', attributes: { 'x::custom': 'second entry' } },
  ],
});

let written = '';
beforeEach(() => {
  vi.clearAllMocks();
  written = '';
  tauri.invoke.mockImplementation(async (cmd: string, args: { contents: string }) => {
    if (cmd === 'write_text_file') written = args.contents;
  });
});

describe('applyEdits', () => {
  it('merges attributes and children into the last entry of the path and appends unknown paths', () => {
    const data = converted().data;
    const out = applyEdits(data, [
      { path: 'L1', children: { w: null } },
      { path: 'L2', children: { w: 'W' } },
      { path: 'W', attributes: { 'bsi::ifc::prop::Name': 'Wall B' } },
      { path: 'S/l1', attributes: { 'x::custom': 'instance' } },
    ]);
    expect(out.find((n) => n.path === 'L1')!.children).toEqual({}); // una sola entrada: se borra
    expect(out.find((n) => n.path === 'L2')!.children).toEqual({ w: 'W' });
    const ws = out.filter((n) => n.path === 'W');
    expect(ws[0].attributes).toEqual({ 'bsi::ifc::prop::Name': 'Wall A' });
    expect(ws[1].attributes).toEqual({ 'x::custom': 'second entry', 'bsi::ifc::prop::Name': 'Wall B' });
    expect(out.at(-1)).toEqual({ path: 'S/l1', attributes: { 'x::custom': 'instance' } });
    expect(data.find((n) => n.path === 'L1')!.children).toEqual({ w: 'W' }); // no cambia la entrada
  });
});

describe('ForeignSession', () => {
  it('the model shows only the overlay; the base is composed by the controller', async () => {
    const s = foreignFromFile(converted(), 'C:/p/Project1.ifcx');
    expect(s.doc.ids.project).toBe('P');
    expect(s.isPlaceTarget('P')).toBe(false);
    const m = await sessionModel(s);
    expect([...m.result.byPath.keys()].filter(Boolean)).toEqual([]); // only the empty root
  });

  it('Save writes the edits into the file nodes, keeps the rest, and the file reopens the same', async () => {
    const s = foreignFromFile(converted(), 'C:/p/Project1.ifcx');
    s.baseEdits = [{ path: 'W', attributes: { 'usd::xformop': { transform: translation([1, 2, 3]) } } }];
    s.doc.composer.layers.push({ uri: './puerta.ifcx', name: 'puerta.ifcx', color: '#e6550d', enabled: true, editsEnabled: true, edits: [] });
    s.doc.composer.placements.push({ id: 'C1', layerUri: './puerta.ifcx', parentId: 'L2', parentLayerUri: BASE_URI, roots: ['D'], offset: [4, 5, 0] });
    s.dirty = true;
    await s.saveTo('C:/p/Project1.ifcx');
    expect(s.dirty).toBe(false);
    expect(s.baseEdits).toEqual([]);
    const file = JSON.parse(written) as IfcxFile;
    expect(file.header.author).toBe('ifc2ifcx');
    // the composer schema is declared (a validating viewer requires it)
    expect(file.schemas).toEqual({ 'x::custom': { value: { dataType: 'String' } }, 'ifcx-studio::composer': { value: { dataType: 'Object' } } });
    // and the standard schemas of what Studio writes (usd::xformop, the Name of the containers)
    expect(file.imports!.map((i) => i.uri)).toEqual([
      'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
      'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
      'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx',
      './puerta.ifcx',
    ]);
    expect(file.data.filter((n) => n.path === 'W').at(-1)!.attributes!['usd::xformop']).toEqual({ transform: translation([1, 2, 3]) });
    expect(file.data.find((n) => n.path === 'P')!.attributes!['x::custom']).toBe('keep');
    // the container and the child added to its parent go in the file
    expect(file.data.find((n) => n.path === 'C1')!.children).toEqual({ D: 'D' });
    expect(file.data.some((n) => n.path === 'L2' && n.children?.C1 === 'C1')).toBe(true);
    // the edits are already in the base: saving again does not duplicate them
    expect(s.source.data.filter((n) => n.path === 'W').at(-1)!.attributes!['usd::xformop']).toBeDefined();

    // al reabrir se separa lo de Studio y vuelve el composer
    const again = foreignFromFile(file, 'C:/p/Project1.ifcx');
    expect(again.composerDamaged).toBe(false);
    expect(again.doc.composer.placements).toEqual(s.doc.composer.placements);
    expect(again.doc.composer.layers.map((l) => l.uri)).toEqual(['./puerta.ifcx']);
    expect(again.source.imports!.map((i) => i.uri)).not.toContain('./puerta.ifcx');
    expect(again.source.data.some((n) => n.path === 'C1')).toBe(false);
    expect(again.source.data.some((n) => n.children && 'C1' in n.children)).toBe(false);
    expect(again.source.data.some((n) => n.attributes && 'ifcx-studio::composer' in n.attributes)).toBe(false);
    expect(again.source.data).toEqual(s.source.data);
    expect(again.source.schemas).toEqual({ 'x::custom': { value: { dataType: 'String' } } });
  });

  it('a placement whose parent layer is gone or disabled hangs from the project in the overlay', () => {
    const s = foreignFromFile(converted(), 'C:/p/Project1.ifcx');
    s.doc.composer.layers.push(
      { uri: './a.ifcx', name: 'a.ifcx', color: '', enabled: true, editsEnabled: true, edits: [] },
      { uri: './b.ifcx', name: 'b.ifcx', color: '', enabled: false, editsEnabled: true, edits: [] },
    );
    s.doc.composer.placements.push({ id: 'C1', layerUri: './a.ifcx', parentId: 'ROOM', parentLayerUri: './b.ifcx', roots: ['R'], offset: [0, 0, 0] });
    expect(s.overlay().data).toContainEqual({ path: 'P', children: { C1: 'C1' } });
  });

  it('Save keeps the formatting of the original text (compact stays compact)', async () => {
    const f = converted();
    const compact = foreignFromFile(f, 'C:/p/a.ifcx', JSON.stringify(f));
    expect(await compact.serialize()).not.toContain('\n');
    const pretty = foreignFromFile(f, 'C:/p/a.ifcx', JSON.stringify(f, null, 4));
    expect((await pretty.serialize()).startsWith('{\n    "header"')).toBe(true);
  });

  it('only edits: no composer node and no composer schema in the file', async () => {
    const s = foreignFromFile(converted(), 'C:/p/Project1.ifcx');
    s.baseEdits = [{ path: 'W', attributes: { 'bsi::ifc::prop::Name': 'Wall B' } }];
    const file = JSON.parse(await s.serialize()) as IfcxFile;
    expect(file.data.some((n) => n.attributes && 'ifcx-studio::composer' in n.attributes)).toBe(false);
    expect(file.schemas).toEqual({ 'x::custom': { value: { dataType: 'String' } } });
    expect(file.data).toHaveLength(converted().data.length);
  });

  it('a damaged composer is dropped and flagged', () => {
    const f = converted();
    f.data[0].attributes!['ifcx-studio::composer'] = { layers: 'nope' };
    const s = foreignFromFile(f, 'C:/p/x.ifcx');
    expect(s.composerDamaged).toBe(true);
    expect(s.doc.composer).toEqual({ layers: [], placements: [] });
  });
});
