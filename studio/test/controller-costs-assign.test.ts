// cost assignment layer
// the first assignment creates the file, imports it and is undone in one step
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { openPath } from '../src/model/open';
import { assignCost, emptyAssignment } from '../src/costs/assign';
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
const ASSIGN = 'C:/p/casa.costos-asignacion.ifcx';
const URI = 'casa.costos-asignacion.ifcx';

function deps(disk: Map<string, string>, ws: FakeWs) {
  tauri.invoke.mockImplementation(async (cmd: string, a: { path: string; contents: string }) => {
    if (cmd === 'read_text_file') {
      const t = disk.get(a.path);
      if (t === undefined) throw new Error(`not found: ${a.path}`);
      return t;
    }
    if (cmd === 'write_text_file') disk.set(a.path, a.contents);
  });
  return {
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
  } satisfies ControllerDeps;
}

async function openDoc(files: Record<string, string> = {}, path: string | null = DOC) {
  const s = newSession();
  s.path = path;
  s.addWall([0, 0], [4, 0], s.doc.levels[0].id);
  s.dirty = false;
  const model = await sessionModel(s);
  const disk = new Map(Object.entries(files));
  const ws = new FakeWs();
  const d = deps(disk, ws);
  const ctrl = new DocumentController(d);
  const saveTo = vi.spyOn(s, 'saveTo').mockResolvedValue(undefined);
  await ctrl.opened(model, s);
  return { ctrl, ws, deps: d, disk, s, saveTo };
}

const assign = (paths: string[], code: string | null) => (f: IfcxFile) => assignCost(f, paths, code);
const written = (disk: Map<string, string>, p = ASSIGN) => JSON.parse(disk.get(p)!) as IfcxFile;

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('removing where there is nothing does not create or import an empty layer', () => {
  it('Controller: materials by reference. The material is an IFCX node (in an imported library or in the', async () => {
    const t = await openDoc();
    expect(await t.ctrl.changeCostAssignment('Assign Cost Item', assign(['W1'], 'code-A'))).toBe(true);
    expect(t.s.doc.imports.at(-1)).toBe(URI);
    expect(await t.ctrl.save()).toBe(true);
    expect(written(t.disk).data).toEqual([{ path: 'W1', inherits: { costos: 'code-A' } }]);
    await t.ctrl.undo();
    expect(t.s.doc.imports).not.toContain(URI);
  });

  it('si el archivo ya existe en disco pero no se importa, se lee y se conserva', async () => {
    const before = { ...emptyAssignment('casa.costos-asignacion'), data: [{ path: 'W0', inherits: { costos: 'code-Z' } }] };
    const t = await openDoc({ [ASSIGN]: JSON.stringify(before) });
    await t.ctrl.changeCostAssignment('Assign Cost Item', assign(['W1'], 'code-A'));
    expect(t.s.doc.imports).toContain(URI);
    await t.ctrl.save();
    expect(written(t.disk).data.map((n) => n.path)).toEqual(['W0', 'W1']);
  });

  it('con el import ya puesto cambia el archivo sin repetir el import', async () => {
    const t = await openDoc();
    await t.ctrl.changeCostAssignment('Assign Cost Item', assign(['W1'], 'code-A'));
    await t.ctrl.changeCostAssignment('Assign Cost Item', assign(['W2'], 'code-B'));
    expect(t.s.doc.imports.filter((u) => u === URI)).toHaveLength(1);
    await t.ctrl.save();
    expect(written(t.disk).data.map((n) => n.path)).toEqual(['W1', 'W2']);
  });

  it('Fake disk for the foreign IFCx: the pile and the library it imports.', async () => {
    const t = await openDoc();
    expect(await t.ctrl.changeCostAssignment('Clear Cost Item', assign(['W1'], null))).toBe(true);
    expect(t.s.doc.imports).not.toContain(URI);
    expect(t.s.dirty).toBe(false);
    const onDisk = { ...emptyAssignment('casa.costos-asignacion'), data: [{ path: 'W0', inherits: { costos: 'code-Z' } }] };
    const u = await openDoc({ [ASSIGN]: JSON.stringify(onDisk) });
    await u.ctrl.changeCostAssignment('Clear Cost Item', assign(['W1'], null));
    expect(u.s.doc.imports).not.toContain(URI);
  });

  it('un documento sin guardar avisa y no cambia nada', async () => {
    const t = await openDoc({}, null);
    expect(await t.ctrl.changeCostAssignment('Assign Cost Item', assign(['W1'], 'code-A'))).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith('Save the model before assigning costs', 'info');
    expect(t.s.doc.imports).not.toContain(URI);
  });

  it('si el cambio devuelve un texto avisa y no cambia nada', async () => {
    const t = await openDoc();
    expect(await t.ctrl.changeCostAssignment('Assign Cost Item', () => 'Nope')).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith('Nope', 'info');
    expect(t.s.doc.imports).not.toContain(URI);
  });

  it('en un IFCx ajeno el import va en su archivo base', async () => {
    const EST = 'C:/p/EST/S-0001.ifcx';
    const disk = new Map<string, string>([[EST, JSON.stringify({
      header: { id: 'S-0001', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' },
      imports: [], schemas: {},
      data: [{ path: 'P', children: { b1: 'B1' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' } } }, { path: 'B1', attributes: { 'bsi::ifc::class': { code: 'IfcBeam' } } }],
    })]]);
    const ws = new FakeWs();
    const d = deps(disk, ws);
    const ctrl = new DocumentController(d);
    const { model, session } = await openPath(EST);
    await ctrl.opened(model, session);
    expect(await ctrl.changeCostAssignment('Assign Cost Item', assign(['B1'], 'code-A'))).toBe(true);
    await ctrl.save();
    expect((JSON.parse(disk.get(EST)!) as IfcxFile).imports.map((i) => i.uri)).toContain('S-0001.costos-asignacion.ifcx');
    expect(written(disk, 'C:/p/EST/S-0001.costos-asignacion.ifcx').data).toEqual([{ path: 'B1', inherits: { costos: 'code-A' } }]);
  });
});
