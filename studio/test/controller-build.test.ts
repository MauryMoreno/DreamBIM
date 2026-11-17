// Controlador: construir un edificio entero y borrar elementos en un solo paso de deshacer.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { parseBuildRequest } from '../src/modeling/build';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel = vi.fn((m: LoadedModel | null) => {
    if (m) this.models.push(m);
  });
  updateModel = vi.fn((m: LoadedModel) => {
    this.models.push(m);
  });
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

function make() {
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async () => {
      throw new Error('not found');
    }),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  return { ctrl: new DocumentController(deps), ws, deps };
}

/** Abre un documento de Studio con `walls` muros y, si `floor`, un suelo. */
async function openDoc(walls = 3, floor = false) {
  const s = newSession();
  const lvl = s.doc.levels[0].id;
  for (let i = 0; i < walls; i++) s.addWall([0, i], [4, i], lvl);
  if (floor) s.addFloor([[0, 0], [4, 0], [4, 3], [0, 3]], lvl);
  s.dirty = false;
  const model = await sessionModel(s);
  const { ctrl, ws } = make();
  await ctrl.opened(model, s);
  return { ctrl, ws, s };
}

/** it rejects without an editable Studio session */
const req = () => ({
  levels: [
    { name: 'L1', elevation: 0, layout: 'a' },
    { name: 'L2', elevation: 3, layout: 'a' },
  ],
  layouts: {
    a: {
      walls: [
        { from: [0, 0], to: [10, 0], thickness: 0.3 },
        { from: [10, 0], to: [10, 6], thickness: 0.3 },
        { from: [10, 6], to: [0, 6], thickness: 0.3 },
        { from: [0, 6], to: [0, 0], thickness: 0.3 },
      ],
      floors: [[[0, 0], [10, 0], [10, 6], [0, 6]]],
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('buildModel', () => {
  it('construye en un documento nuevo como un solo paso de deshacer', async () => {
    const { ctrl } = make();
    await ctrl.newDocument();
    const c = await ctrl.asAgent(() => ctrl.buildModel(parseBuildRequest(req())));
    expect(c).toMatchObject({ levels: 2, walls: 8, floors: 2 });
    expect(ctrl.session!.doc.walls).toHaveLength(8);
    expect(ctrl.session!.dirty).toBe(true);
    expect(ctrl.history.undo).toBe('Assistant: Build Model');
    await ctrl.undo();
    expect(ctrl.session!.doc.walls).toHaveLength(0);
    expect(ctrl.session!.doc.levels.map((l) => l.name)).toEqual(['Level 1']);
    await ctrl.redo();
    expect(ctrl.session!.doc.walls).toHaveLength(8);
  });

  it('reconstruye el modelo una sola vez', async () => {
    const { ctrl, ws } = make();
    await ctrl.newDocument();
    ws.updateModel.mockClear();
    await ctrl.buildModel(parseBuildRequest(req()));
    expect(ws.updateModel).toHaveBeenCalledTimes(1);
  });

  it('con fresh sustituye al documento abierto', async () => {
    const { ctrl } = await openDoc(3);
    await ctrl.buildModel(parseBuildRequest(req()));
    expect(ctrl.session!.doc.walls).toHaveLength(8);
    expect(ctrl.session!.doc.levels.map((l) => l.name)).toEqual(['L1', 'L2']);
  });

  it('Controller: classifying is inheriting a code of an imported table (inherits.omniclass21) in the over layer of the', async () => {
    const { ctrl, s } = await openDoc(1);
    s.doc.levels[0].name = 'L1';
    const c = await ctrl.buildModel(parseBuildRequest({ ...req(), new: false }));
    expect(c).toMatchObject({ levels: 2, walls: 8 });
    expect(ctrl.session!.doc.walls).toHaveLength(9);
    await ctrl.undo();
    expect(ctrl.session!.doc.walls).toHaveLength(1);
  });

  it('si applyBuild lanza, rechaza y no cambia documento ni historial', async () => {
    const { ctrl, s } = await openDoc(1);
    s.doc.levels[0].name = 'L1';
    s.doc.levels[0].elevation = 1;
    await expect(ctrl.buildModel(parseBuildRequest({ ...req(), new: false }))).rejects.toThrow('already exists');
    expect(ctrl.session!.doc.walls).toHaveLength(1);
    expect(ctrl.session!.doc.levels).toHaveLength(1);
    expect(ctrl.history.undo).toBeNull();
  });

  it('Table in the previous format (hierarchical): it is read, but it cannot be inherited.', async () => {
    const { ctrl } = make();
    await expect(ctrl.buildModel(parseBuildRequest({ ...req(), new: false }))).rejects.toThrow('No model is open');
  });

  it('rechaza con el bloqueo del usuario fuera de asAgent', async () => {
    const { ctrl } = await openDoc(1);
    ctrl.setUserLock(true);
    await expect(ctrl.buildModel(parseBuildRequest(req()))).rejects.toThrow('Editing is locked');
  });
});

describe('removeElements', () => {
  it('borra muros y suelos en un paso', async () => {
    const { ctrl } = await openDoc(2, true);
    const ids = [...ctrl.session!.doc.walls.map((w) => w.id), ctrl.session!.doc.floors[0].id];
    const n = await ctrl.removeElements(ids, 'Assistant: Delete Elements (3)');
    expect(n).toBe(3);
    expect(ctrl.session!.doc.walls).toHaveLength(0);
    expect(ctrl.session!.doc.floors).toHaveLength(0);
    expect(ctrl.history.undo).toBe('Assistant: Delete Elements (3)');
    await ctrl.undo();
    expect(ctrl.session!.doc.walls).toHaveLength(2);
    expect(ctrl.session!.doc.floors).toHaveLength(1);
  });

  it('rechaza un id desconocido sin borrar nada', async () => {
    const { ctrl } = await openDoc(2, true);
    const id = ctrl.session!.doc.walls[0].id;
    await expect(ctrl.removeElements([id, 'no-existe'], 'x')).rejects.toThrow('not a wall, floor, stair or placed piece');
    expect(ctrl.session!.doc.walls).toHaveLength(2);
    expect(ctrl.session!.doc.floors).toHaveLength(1);
    expect(ctrl.history.undo).toBeNull();
  });
});
