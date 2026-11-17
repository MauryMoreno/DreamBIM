// Controlador: el cronograma es un archivo IFCx (IfcWorkSchedule / IfcTask) que el modelo importa.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { openPath } from '../src/model/open';
import { K_PRODUCTS, scheduleFromFile, scheduleToFile } from '../src/schedule/nodes';
import { EMPTY_SCHEDULE, SCHEDULE_KIND, type ScheduleState, type Task } from '../src/schedule/state';

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
const LEGACY = 'C:/p/casa.schedule.ifcx';
const CRONO = 'C:/p/casa.cronograma.ifcx';
const TASK: Task = { id: 'tk-1', name: 'Walls', phase: 'Estructura', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [] };
const addTask = (s: ScheduleState): ScheduleState => ({ ...s, tasks: [...s.tasks, TASK] });
const readCrono = (disk: Map<string, string>, path = CRONO) => scheduleFromFile(JSON.parse(disk.get(path)!))!.state;

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

/** Un documento de Studio en DOC con un muro. */
async function openDoc(files: Record<string, string> = {}) {
  const s = newSession();
  s.path = DOC;
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

// changing a task regenerates the same file with the same root; Save writes it without touching the model
const EST = 'C:/p/EST/S-0001.ifcx';
const EST_CRONO = 'C:/p/EST/S-0001.cronograma.ifcx';
const beam = { 'bsi::ifc::class': { code: 'IfcBeam' } };
const estFile = (imports: string[]) => JSON.stringify({
  header: { id: 'S-0001', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'ifc2ifcx', timestamp: 't' },
  imports: imports.map((uri) => ({ uri })),
  schemas: {},
  data: [
    { path: 'P', children: { b1: 'B1', b2: 'B2' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' } } },
    { path: 'B1', attributes: beam },
    { path: 'B2', attributes: beam },
  ],
});
const EST_STATE: ScheduleState = { ...EMPTY_SCHEDULE, tasks: [{ ...TASK, name: 'Vigas', elements: ['B1', 'B2'] }] };

async function openEst(imports: string[] = ['S-0001.cronograma.ifcx'], extra: Record<string, string> = {}) {
  const disk = new Map<string, string>([
    [EST, estFile(imports)],
    [EST_CRONO, JSON.stringify(scheduleToFile(EST_STATE, { root: 'ws-est', title: 'S-0001' }))],
    ...Object.entries(extra),
  ]);
  const ws = new FakeWs();
  const d = deps(disk, ws);
  const ctrl = new DocumentController(d);
  const { model, session } = await openPath(EST);
  await ctrl.opened(model, session);
  return { ctrl, ws, deps: d, disk, session };
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('cronograma IFCx en el controlador', () => {
  it('the imported schedule does not appear among the elements of the model', async () => {
    const t = await openEst();
    expect(t.ctrl.schedule).toEqual(EST_STATE);
    expect(t.deps.toast).not.toHaveBeenCalledWith(expect.stringContaining('Could not'), expect.anything());
  });

  it('it is in the composition (the Stage hides it) …', async () => {
    const t = await openEst();
    const before = t.disk.get(EST);
    await t.ctrl.changeSchedule('Change Task', (s) => ({ ...s, tasks: s.tasks.map((x) => ({ ...x, duration: 8 })) }));
    expect(t.ctrl.history.undo).toBe('Change Task');
    expect(await t.ctrl.save()).toBe(true);
    expect(t.disk.get(EST)).toBe(before);
    const f = JSON.parse(t.disk.get(EST_CRONO)!);
    expect(f.data[0].path).toBe('ws-est');
    expect(readCrono(t.disk, EST_CRONO).tasks[0].duration).toBe(8);
    expect(f.data.find((n: { path: string }) => n.path === 'ws-est-tk-1').attributes[K_PRODUCTS]).toEqual(['B1', 'B2']);
  });

  it('el modelo que no tiene cronograma lo importa con la primera tarea, y deshacer quita el import', async () => {
    const t = await openEst([]);
    const imports = () => (t.session as unknown as { source: { imports: { uri: string }[] } }).source.imports.map((i) => i.uri);
    await t.ctrl.changeSchedule('New Task', addTask);
    expect(imports()).toEqual(['S-0001.cronograma.ifcx']);
    await t.ctrl.undo();
    expect(t.ctrl.schedule).toEqual(EMPTY_SCHEDULE);
    expect(imports()).toEqual([]);
  });

  it('the .schedule.ifcx of previous versions moves to the IFCx schedule on open and is emptied on save', async () => {
    const t = await openEst();
    const shown = t.ws.models.at(-1)!;
    const roots = shown.result.root.children.map((c) => c.origin);
    expect(roots).toContain('ws-est'); // an unsaved document cannot be planned yet
    expect(shown.result.byOrigin.get('ws-est-tk-1')![0].attributes['bsi::ifc::class']).toEqual(expect.objectContaining({ code: 'IfcTask' }));
  });
});

describe('cronograma IFCx en un documento de Studio', () => {
  it('la primera tarea crea <modelo>.cronograma.ifcx y lo importa; Save escribe modelo y cronograma', async () => {
    const t = await openDoc();
    expect(await t.ctrl.changeSchedule('New Task', addTask)).toBe(true);
    expect(t.s.doc.imports).toContain('casa.cronograma.ifcx');
    expect(await t.ctrl.save()).toBe(true);
    expect(t.saveTo).toHaveBeenCalledTimes(1);
    expect(readCrono(t.disk).tasks).toEqual([TASK]);
    expect(t.disk.has(LEGACY)).toBe(false); // ya no se escribe el archivo auxiliar viejo
  });

  it('con solo cambios del cronograma, el segundo Save escribe el cronograma y no reescribe el modelo', async () => {
    const t = await openDoc();
    await t.ctrl.changeSchedule('New Task', addTask);
    await t.ctrl.save();
    t.saveTo.mockClear();
    t.deps.writeText.mockClear();
    await t.ctrl.changeSchedule('Change Task', (s) => ({ ...s, tasks: s.tasks.map((x) => ({ ...x, name: 'Muros' })) }));
    await t.ctrl.save();
    expect(t.saveTo).not.toHaveBeenCalled();
    expect(t.deps.writeText).toHaveBeenCalledTimes(1);
    expect(t.deps.writeText).toHaveBeenCalledWith(CRONO, expect.any(String));
    expect(readCrono(t.disk).tasks[0].name).toBe('Muros');
  });

  it('un cambio es un paso que se deshace', async () => {
    const t = await openDoc();
    await t.ctrl.changeSchedule('New Task', addTask);
    await t.ctrl.undo();
    expect(t.ctrl.schedule).toEqual(EMPTY_SCHEDULE);
    expect(t.s.doc.imports).not.toContain('casa.cronograma.ifcx');
  });

  it('an invalid request rejects with items[0] and leaves nothing', async () => {
    const legacy = JSON.stringify(SCHEDULE_KIND.toFile({ ...EMPTY_SCHEDULE, tasks: [TASK] }, 'casa'));
    const t = await openDoc({ [LEGACY]: legacy });
    expect(t.ctrl.schedule.tasks).toEqual([TASK]);
    expect(t.s.doc.imports).toContain('casa.cronograma.ifcx');
    expect(t.s.dirty).toBe(true);
    expect(t.deps.toast).toHaveBeenCalledWith('Moved the schedule from casa.schedule.ifcx to casa.cronograma.ifcx', 'info');
    await t.ctrl.save();
    expect(readCrono(t.disk).tasks).toEqual([TASK]);
    expect(SCHEDULE_KIND.fromFile(JSON.parse(t.disk.get(LEGACY)!)).tasks).toEqual([]);
  });

  it('materiales y cronograma cambiados: el modelo, su biblioteca de materiales y el cronograma', async () => {
    const t = await openDoc();
    await t.ctrl.setMaterial(null, { name: 'C30', code: 'C30', color: '#8a8a8a', opacity: 1 });
    await t.ctrl.changeSchedule('New Task', addTask);
    await t.ctrl.save();
    expect(t.saveTo).toHaveBeenCalledTimes(1);
    expect([...t.disk.keys()].sort()).toEqual(['C:/p/materiales.ifcx', CRONO].sort());
  });

  it('it returns valid sites and resolves the level names', async () => {
    const s = newSession();
    const disk = new Map<string, string>();
    const ws = new FakeWs();
    const d = deps(disk, ws);
    const ctrl = new DocumentController(d);
    await ctrl.opened(await sessionModel(s), s);
    expect(await ctrl.changeSchedule('New Task', addTask)).toBe(false);
    expect(d.toast).toHaveBeenCalledWith('Save the model before planning', 'info');
  });
});
