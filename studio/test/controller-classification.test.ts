// Tables the controller sees (the tables folder); by default, the flat table.
// documento. El <modelo>.classification.ifcx de versiones anteriores solo se lee, para migrarlo al abrir.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { editPath } from '../src/composer/edits';
import { K_TABLE21 } from '../src/classification/nodes';
import { K_ASSIGN_21 } from '../src/classification/state';
import { buildSystem, itemPath, replaceTableEntries, systemFromFile, type ClassSystemInfo, type ClassTableRef } from '../src/classification/system';
import type { IfcxFile } from '../src/ifcx/types';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel(m: LoadedModel | null) { if (m) this.models.push(m); }
  updateModel(m: LoadedModel) { this.models.push(m); }
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

const DOC = 'C:/p/casa.ifcx';
const SIDE = 'C:/p/casa.classification.ifcx';
const TABLE = 'C:/p/tablas/omniclass-21.ifcx';
const TABLE_URI = './tablas/omniclass-21.ifcx'; // linkUri: relativa al documento, con ./
const INFO: ClassSystemInfo = { id: 'omniclass-21', name: 'OmniClass', table: '21', title: 'Elements', edition: '2012', starter: false };
const SHELL = '21-02 00 00';
const INTERIORS = '21-03 00 00';
const SHELL_ITEM = itemPath(INFO.id, SHELL);

const tableFile = (shell = 'Shell') => buildSystem(INFO, [{ code: SHELL, title: shell }, { code: INTERIORS, title: 'Interiors' }]);
const refOf = (file: IfcxFile): ClassTableRef => ({ path: TABLE, system: systemFromFile(file, TABLE)! });

/** Text of the old `.classification.ifcx`, from the edit paths of the walls. */
const oldTable: IfcxFile = {
  header: { id: 'x', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data: [
    { path: 'omniclass-21', children: { a: 'i1' }, attributes: { 'studio::classification::system': { id: 'omniclass-21', name: 'OmniClass', table: '21', title: 'Elements', edition: 'x' } } },
    { path: 'i1', attributes: { 'studio::classification::item': { code: SHELL, title: 'Shell', level: 1 } } },
  ],
};

interface Options {
  /** it writes inherits.omniclass21, imports the table and the element composes its code and its title */
  tables?: ClassTableRef[];
  /** El documento ya importa la tabla al abrirlo. */
  imported?: boolean;
  /** removing the code leaves the element without it */
  legacy?: (walls: string[]) => string;
  readOnly?: boolean;
}

async function openDoc(o: Options = {}) {
  const s = newSession();
  s.path = DOC;
  const lvl = s.doc.levels[0].id;
  s.addWall([0, 0], [4, 0], lvl);
  s.addWall([0, 4], [4, 4], lvl);
  if (o.imported) s.doc.imports = [TABLE_URI];
  s.dirty = false;
  const disk = new Map<string, string>([[TABLE, JSON.stringify(tableFile())]]);
  tauri.invoke.mockImplementation(async (cmd: string, a: { path: string; contents: string }) => {
    if (cmd === 'read_text_file') {
      const t = disk.get(a.path);
      if (t === undefined) throw new Error(`not found: ${a.path}`);
      return t;
    }
    if (cmd === 'write_text_file') disk.set(a.path, a.contents);
  });
  const model = await sessionModel(s);
  const walls = [...model.result.byPath.values()]
    .filter((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall')
    .map((n) => editPath(n, model.result));
  if (o.legacy) disk.set(SIDE, o.legacy(walls));
  const ws = new FakeWs();
  const state = { tables: o.tables ?? [refOf(tableFile())] };
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (p: string) => {
      const t = disk.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    }),
    writeText: vi.fn(async (p: string, t: string) => void disk.set(p, t)),
    exists: vi.fn(async (p: string) => disk.has(p)),
    confirm: vi.fn(async () => true),
    classTables: vi.fn(async () => state.tables),
  } satisfies ControllerDeps;
  const ctrl = new DocumentController(deps);
  const saveTo = vi.spyOn(s, 'saveTo').mockResolvedValue(undefined);
  await ctrl.opened(model, o.readOnly ? null : s);
  const attrs = (path: string) => ws.models.at(-1)!.result.byOrigin.get(path)![0].attributes;
  const codeOf = (path: string) => (attrs(path)[K_TABLE21] as { code?: string } | undefined)?.code;
  const nameOf = (path: string) => (attrs(path)[K_TABLE21] as { name?: string } | undefined)?.name;
  const inheritOf = (path: string) => s.doc.overs.find((n) => n.path === path)?.inherits?.omniclass21;
  return { ctrl, ws, deps, disk, s, saveTo, walls, codeOf, nameOf, inheritOf, state };
}

const legacyFile = (assign: Record<string, { code: string; title: string }>) =>
  JSON.stringify({
    header: { id: 'studio-classification/casa', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
    imports: [],
    schemas: {},
    data: Object.entries(assign).map(([path, v]) => ({ path, attributes: { [K_ASSIGN_21]: v } })),
  });

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('clasificar por referencia', () => {
  it('without a code there is nothing to remove', async () => {
    const t = await openDoc();
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.ctrl.history.undo).toBe('Classify Elements');
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    expect(t.inheritOf(t.walls[0])).toBe(SHELL_ITEM);
    expect(t.s.doc.imports).toEqual([TABLE_URI]);
    expect(t.codeOf(t.walls[1])).toBeUndefined();
    expect(t.s.dirty).toBe(true);
  });

  it('clasificar otro elemento no repite el import, y deshacer devuelve el estado anterior paso a paso', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    await t.ctrl.classify([t.walls[1]], INTERIORS, 'Classify by Rule');
    expect(t.ctrl.history.undo).toBe('Classify by Rule');
    expect(t.s.doc.imports).toEqual([TABLE_URI]);
    expect(t.codeOf(t.walls[1])).toBe(INTERIORS);
    await t.ctrl.undo();
    expect(t.codeOf(t.walls[1])).toBeUndefined();
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    await t.ctrl.undo();
    expect(t.codeOf(t.walls[0])).toBeUndefined();
    expect(t.s.doc.imports).toEqual([]);
    expect(t.s.dirty).toBe(false);
  });

  it('varios elementos a la vez son un solo paso', async () => {
    const t = await openDoc();
    expect(await t.ctrl.classify(t.walls, SHELL, 'Classify by Rule')).toBe(true);
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.codeOf(t.walls[1])).toBe(SHELL);
    await t.ctrl.undo();
    expect(t.codeOf(t.walls[0])).toBeUndefined();
    expect(t.codeOf(t.walls[1])).toBeUndefined();
  });

  it('asignar lo que el elemento ya tiene no apila ni marca cambios', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    await t.ctrl.save();
    const steps = t.ctrl.history.undo;
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.ctrl.history.undo).toBe(steps);
    expect(t.s.dirty).toBe(false);
  });

  it('si el documento ya importa la tabla la usa sin tocar sus imports', async () => {
    const t = await openDoc({ imported: true, tables: [] });
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.inheritOf(t.walls[0])).toBe(SHELL_ITEM);
    expect(t.s.doc.imports).toEqual([TABLE_URI]);
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
  });

  it('with a table of the previous format it is not inherited: the value is written and no import is added', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(await t.ctrl.classify([t.walls[0]], null, 'Clear Classification')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Clear Classification');
    expect(t.codeOf(t.walls[0])).toBeUndefined();
    expect(await t.ctrl.classify([t.walls[1]], null)).toBe(true); // without tables it writes the value with the title it is given
    expect(t.ctrl.history.undo).toBe('Clear Classification');
  });

  it('un valor propio previo se sobrescribe al asignar y se borra al quitar', async () => {
    const t = await openDoc({ tables: [] });
    await t.ctrl.classify([t.walls[0]], INTERIORS, 'Classify Elements', 'Interiors');
    expect(t.codeOf(t.walls[0])).toBe(INTERIORS);
    t.state.tables = [refOf(tableFile())];
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    expect(await t.ctrl.classify([t.walls[0]], null)).toBe(true);
    expect(t.codeOf(t.walls[0])).toBeUndefined();
  });

  it('if the item is already in the model the tables of the folder are not read', async () => {
    const t = await openDoc({ tables: [{ path: TABLE, system: systemFromFile(oldTable, TABLE)! }] });
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    expect(t.inheritOf(t.walls[0])).toBeUndefined();
    expect(t.s.doc.imports).toEqual([]);
  });

  it('this one is not there: now it is', async () => {
    const t = await openDoc({ tables: [] });
    expect(await t.ctrl.classify([t.walls[0]], SHELL, 'Classify Elements', 'Shell')).toBe(true);
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    expect(t.s.doc.imports).toEqual([]);
    expect(t.inheritOf(t.walls[0])).toBeUndefined();
  });

  it('un documento sin guardar no tiene ruta para el import: escribe el valor', async () => {
    const t = await openDoc();
    t.s.path = null;
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(true);
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.s.doc.imports).toEqual([]);
  });

  it('Save writes the document (with overs and imports) and no classification file', async () => {
    const t = await openDoc({ imported: true });
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(t.deps.classTables).not.toHaveBeenCalled();
    await t.ctrl.classify([t.walls[1]], '21-99 00 00', 'Classify Elements', 'Custom'); // classification file of previous versions
    expect(t.deps.classTables).toHaveBeenCalledTimes(1);
  });

  it('en solo lectura avisa y no cambia nada', async () => {
    const t = await openDoc({ readOnly: true });
    expect(await t.ctrl.classify([t.walls[0]], SHELL)).toBe(false);
    expect(t.deps.toast).toHaveBeenCalled();
  });

  it('a code that no table brings is written as a value and the notice counts it', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(await t.ctrl.save()).toBe(true);
    expect(t.saveTo).toHaveBeenCalledTimes(1);
    expect(t.deps.writeText).not.toHaveBeenCalled();
    expect(t.s.dirty).toBe(false);
  });
});

describe('on save the old file is left empty so it is not applied again the next time it opens', () => {
  it('sus asignaciones pasan a inherits al abrir, sin historial, con el documento con cambios y un aviso', async () => {
    const t = await openDoc({
      legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' }, [w[1]]: { code: INTERIORS, title: 'Interiors' }, ghost: { code: SHELL, title: 'Shell' } }),
    });
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
    expect(t.codeOf(t.walls[1])).toBe(INTERIORS);
    expect(t.inheritOf(t.walls[0])).toBe(SHELL_ITEM);
    expect(t.s.doc.imports).toEqual([TABLE_URI]);
    expect(t.s.dirty).toBe(true);
    expect(t.ctrl.history.undo).toBeNull();
    expect(t.deps.toast).toHaveBeenCalledWith('Converted 2 classification assignments from casa.classification.ifcx', 'info');
  });

  it('it changes the layer of the table: the classified element composes the new title, it is undone and it is written with Save', async () => {
    const t = await openDoc({ legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' }, [w[1]]: { code: '21-99 00 00', title: 'Custom' } }) });
    expect(t.codeOf(t.walls[1])).toBe('21-99 00 00');
    expect(t.nameOf(t.walls[1])).toBe('Custom');
    expect(t.deps.toast).toHaveBeenCalledWith(
      'Converted 2 classification assignments from casa.classification.ifcx; 1 have no table node', 'info',
    );
  });

  it('un archivo roto avisa y el documento se abre igual', async () => {
    const t = await openDoc({ legacy: () => '{ roto' });
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Could not read casa.classification.ifcx'), 'error');
    expect(t.ctrl.hasDocument).toBe(true);
    expect(t.s.dirty).toBe(false);
  });

  it('en solo lectura no se migra', async () => {
    const t = await openDoc({ readOnly: true, legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' } }) });
    expect(t.deps.toast).not.toHaveBeenCalledWith(expect.stringContaining('Converted'), 'info');
  });

  it('it was not written yet', async () => {
    const t = await openDoc({ legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' } }) });
    expect(JSON.parse(t.disk.get(SIDE)!).data).toHaveLength(1);
    expect(await t.ctrl.save()).toBe(true);
    expect(JSON.parse(t.disk.get(SIDE)!).data).toEqual([]);
    expect(t.deps.writeText).toHaveBeenCalledWith(SIDE, expect.any(String));
  });

  it('sin guardar, o con Save As a otra ruta, el archivo viejo no se toca', async () => {
    const a = await openDoc({ legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' } }) });
    expect(JSON.parse(a.disk.get(SIDE)!).data).toHaveLength(1);
    const b = await openDoc({ legacy: (w) => legacyFile({ [w[0]]: { code: SHELL, title: 'Shell' } }) });
    expect(await b.ctrl.saveAs()).toBe(true);
    expect(JSON.parse(b.disk.get(SIDE)!).data).toHaveLength(1);
  });

  it('sin archivo viejo no lee ni avisa nada', async () => {
    const t = await openDoc();
    expect(t.deps.toast).not.toHaveBeenCalled();
    expect(t.s.dirty).toBe(false);
  });
});

describe('clasificar con la tabla 23 (Products)', () => {
  const INFO23: ClassSystemInfo = { id: 'omniclass-23', name: 'OmniClass', table: '23', title: 'Products', edition: 'Revit', starter: false };
  const BEAMS = '23-25 30 11 14 14';
  const T23 = 'C:/p/tablas/omniclass-23.ifcx';
  const t23File = buildSystem(INFO23, [{ code: '23-25 30 11 14', title: 'Column-Slab Frames' }, { code: BEAMS, title: 'Beams' }]);

  it('escribe inherits.omniclass23 junto al de la 21, importa la tabla 23 y quitar la 23 no toca la 21', async () => {
    const t = await openDoc();
    t.disk.set(T23, JSON.stringify(t23File));
    t.state.tables = [refOf(tableFile()), { path: T23, system: systemFromFile(t23File, T23)! }];
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(await t.ctrl.classify([t.walls[0]], BEAMS)).toBe(true);
    const over = t.s.doc.overs.find((n) => n.path === t.walls[0])!;
    expect(over.inherits).toEqual({ omniclass21: SHELL_ITEM, omniclass23: itemPath('omniclass-23', BEAMS) });
    expect(t.s.doc.imports).toEqual([TABLE_URI, './tablas/omniclass-23.ifcx']);
    const attrs = t.ws.models.at(-1)!.result.byOrigin.get(t.walls[0])![0].attributes;
    expect(attrs['omniclass::Table23']).toEqual({ code: BEAMS, name: 'Beams' });
    await t.ctrl.classify([t.walls[0]], null, 'Clear Classification', undefined, '23');
    expect(t.s.doc.overs.find((n) => n.path === t.walls[0])!.inherits).toEqual({ omniclass21: SHELL_ITEM, omniclass23: null });
    expect(t.codeOf(t.walls[0])).toBe(SHELL);
  });
});

describe('editar una tabla importada', () => {
  it('Controller: saved colors (<model>.colors.ifcx) and the agent path through the user lock.', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    const edit = (prev: IfcxFile) => replaceTableEntries(prev, INFO, [{ code: SHELL, title: 'Envolvente' }, { code: INTERIORS, title: 'Interiors' }]);
    expect(await t.ctrl.changeImportedFile(TABLE, 'Edit Classification Table', edit)).toBe(true);
    expect(t.ctrl.history.undo).toBe('Edit Classification Table');
    expect(t.nameOf(t.walls[0])).toBe('Envolvente');
    expect(JSON.parse(t.disk.get(TABLE)!).data.some((n: { attributes?: Record<string, { name?: string }> }) => n.attributes?.['omniclass::Table21']?.name === 'Envolvente')).toBe(false); // Studio document with two walls, opened from disk; `sidecar(paths)` decides what is in its materials file.
    await t.ctrl.undo();
    expect(t.nameOf(t.walls[0])).toBe('Shell');
    await t.ctrl.redo();
    expect(await t.ctrl.save()).toBe(true);
    expect(JSON.parse(t.disk.get(TABLE)!).data.some((n: { attributes?: Record<string, { name?: string }> }) => n.attributes?.['omniclass::Table21']?.name === 'Envolvente')).toBe(true);
  });

  it('un motivo en lugar del archivo nuevo avisa y no cambia nada', async () => {
    const t = await openDoc();
    await t.ctrl.classify([t.walls[0]], SHELL);
    expect(await t.ctrl.changeImportedFile(TABLE, 'Edit Classification Table', () => 'Nothing to change')).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith('Nothing to change', 'info');
    expect(t.ctrl.history.undo).toBe('Classify Elements');
  });
});
