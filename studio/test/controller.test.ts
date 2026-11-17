import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { EditSession, newSession, sessionFromFile, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import type { StackRow } from '../src/composer/rows';
import type { StageData } from '../src/composer/stagepanel';
import { DOCUMENT_COLOR } from '../src/composer/stack';
import { allowedAxes, rotScaleAxes, targetPosition, targetRotScale, type MoveStudio, type MoveTarget } from '../src/document/controller';
import { editPath } from '../src/composer/edits';
import { ForeignSession } from '../src/modeling/foreign';
import { openPath } from '../src/model/open';
import { translation, worldMatrix, worldOrigin, worldRotScale } from '../src/composer/xform';
import { isSchemaWarning } from '../src/model/validate';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';

/** Espacio de trabajo falso: registra las llamadas en orden. */
class FakeWs implements DocWorkspace {
  calls: [string, ...unknown[]][] = [];
  setModel(m: LoadedModel | null) { this.calls.push(['setModel', m?.name ?? null]); }
  updateModel(m: LoadedModel) { this.calls.push(['updateModel', m.name, m.path]); }
  setEditable(on: boolean) { this.calls.push(['setEditable', on]); }
  setDirty(on: boolean) { this.calls.push(['setDirty', on]); }
  showPlan() { this.calls.push(['showPlan']); }
  named(n: string) { return this.calls.filter((c) => c[0] === n); }
  last(n: string) { return this.named(n).at(-1); }
}

const fakeModel = (name: string, path: string | null = null): LoadedModel =>
  ({ name, path, result: {} as LoadedModel['result'], warnings: [] }) as LoadedModel;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(over: Partial<ControllerDeps> = {}) {
  const ws = new FakeWs();
  const base = {
    ws,
    pickSavePath: vi.fn(async (_s: string): Promise<string | null> => 'C:/a/casa.ifcx'),
    askSaveChanges: vi.fn(async (_n: string): Promise<'save' | 'discard' | 'cancel'> => 'save'),
    toast: vi.fn(),
    remember: vi.fn(async (_m: LoadedModel) => {}),
    buildModel: vi.fn(async (s: EditSession) => fakeModel(s.name, s.path)),
    readText: vi.fn(async (p: string): Promise<string> => {
      throw new Error(`not found: ${p}`);
    }),
    confirm: vi.fn(async (_m: string, _ok: string) => true),
  };
  const deps = { ...base, ...over } as typeof base;
  const ctrl = new DocumentController(deps);
  return { ctrl, ws, deps };
}

/** open with a session: editable; without a session: read-only; always without changes */
function openedSession(path = 'C:/a/casa.ifcx'): EditSession {
  const s = newSession();
  s.path = path;
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

/** Cada componente a menos de 1e-6. */
const near = (got: number[], want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));

describe('DocumentController: abrir, nuevo y cerrar', () => {
  it('close: empties the workspace and forgets the session', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    expect(ws.calls).toEqual([['setModel', 'Untitled'], ['setDirty', false], ['setEditable', true], ['showPlan']]);
    expect(ctrl.session?.name).toBe('Untitled');
    expect(ctrl.hasDocument).toBe(true);
  });

  it('DocumentController: editing', () => {
    const { ctrl, ws } = setup();
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    expect(ws.calls).toEqual([['setModel', 'casa.ifcx'], ['setDirty', false], ['setEditable', true]]);
    ws.calls = [];
    ctrl.opened(fakeModel('ajeno.ifcx', 'C:/a/ajeno.ifcx'), null);
    expect(ws.calls).toEqual([['setModel', 'ajeno.ifcx'], ['setDirty', false], ['setEditable', false]]);
    expect(ctrl.session).toBeNull();
    expect(ctrl.hasDocument).toBe(true);
  });

  it('addWall changes the session, rebuilds the model and marks the title', () => {
    const { ctrl, ws } = setup();
    ctrl.opened(fakeModel('casa.ifcx'), openedSession());
    ws.calls = [];
    ctrl.closed();
    expect(ws.calls).toEqual([['setModel', null], ['setDirty', false], ['setEditable', false]]);
    expect(ctrl.session).toBeNull();
    expect(ctrl.hasDocument).toBe(false);
  });
});

describe('without a session the editor does nothing', () => {
  it('if rebuilding fails: error toast, the title stays marked and the queue goes on', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ws.calls = [];
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    await ctrl.idle();
    expect(ctrl.session!.doc.walls).toHaveLength(1);
    expect(ws.calls).toEqual([['updateModel', 'Untitled', null], ['setDirty', true]]);
  });

  it('un muro demasiado corto se ignora sin tocar el espacio de trabajo', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ws.calls = [];
    ctrl.editor.addWall([0, 0], [0.0001, 0], ctrl.session!.doc.levels[0].id);
    await ctrl.idle();
    expect(ws.calls).toEqual([]);
  });

  it('deleteWall quita el muro; un id desconocido no hace nada', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    await ctrl.idle();
    const id = ctrl.session!.doc.walls[0].id;
    ws.calls = [];
    ctrl.editor.deleteWall('nada');
    await ctrl.idle();
    expect(ws.calls).toEqual([]);
    ctrl.editor.deleteWall(id);
    await ctrl.idle();
    expect(ctrl.session!.doc.walls).toHaveLength(0);
    expect(ws.calls).toEqual([['updateModel', 'Untitled', null], ['setDirty', true]]);
  });

  it('an edit queued for an already closed document is discarded', async () => {
    const { ctrl, ws } = setup();
    ctrl.editor.addWall([0, 0], [4, 0], 'nivel');
    ctrl.editor.deleteWall('x');
    await ctrl.idle();
    expect(ws.calls).toEqual([]);
  });

  it('the first one is already being applied', async () => {
    const { ctrl, ws, deps } = setup();
    await ctrl.newDocument();
    deps.buildModel.mockRejectedValueOnce(new Error('boom'));
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    ctrl.editor.addWall([4, 0], [4, 4], ctrl.session!.doc.levels[0].id);
    await ctrl.idle();
    expect(deps.toast).toHaveBeenCalledWith('Could not update the model: boom', 'error');
    expect(ctrl.session!.doc.walls).toHaveLength(2);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
  });

  it('the edit queued before the save is applied first', async () => {
    const { ctrl, deps } = setup();
    await ctrl.newDocument();
    const s = ctrl.session!;
    const gate = deferred();
    deps.buildModel.mockImplementationOnce(async (x) => {
      await gate.promise;
      return fakeModel(x.name);
    });
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id); // ocupa la cola
    ctrl.editor.addWall([4, 0], [4, 4], ctrl.session!.doc.levels[0].id); // espera
    await vi.waitFor(() => expect(s.doc.walls).toHaveLength(1)); // cancelling the save dialog: false, without writing and with the changes
    ctrl.closed();
    gate.resolve();
    await ctrl.idle();
    expect(s.doc.walls).toHaveLength(1);
  });
});

describe('DocumentController: Save y Save As', () => {
  it('Save de un documento nuevo pide la ruta (Untitled.ifcx), escribe, limpia y recuerda', async () => {
    const { ctrl, ws, deps } = setup();
    await ctrl.newDocument();
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    ws.calls = [];
    await expect(ctrl.save()).resolves.toBe(true);
    expect(deps.pickSavePath).toHaveBeenCalledWith('Untitled.ifcx');
    expect(tauri.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({ path: 'C:/a/casa.ifcx' }));
    const s = ctrl.session!;
    expect(s.path).toBe('C:/a/casa.ifcx');
    expect(s.dirty).toBe(false);
    // an edit during the save is processed afterwards and leaves the document with changes
    expect(ws.calls).toEqual([
      ['updateModel', 'Untitled', null],
      ['setDirty', true],
      ['updateModel', 'casa.ifcx', 'C:/a/casa.ifcx'],
      ['setDirty', false],
    ]);
    expect(deps.remember).toHaveBeenCalledWith(expect.objectContaining({ name: 'casa.ifcx', path: 'C:/a/casa.ifcx' }));
  });

  it('Save de un archivo reabierto sobrescribe sin preguntar; sin cambios no hace nada', async () => {
    const { ctrl, deps } = setup();
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    await expect(ctrl.save()).resolves.toBe(true);
    expect(tauri.invoke).not.toHaveBeenCalled();
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    await expect(ctrl.save()).resolves.toBe(true);
    expect(deps.pickSavePath).not.toHaveBeenCalled();
    expect(tauri.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({ path: 'C:/a/casa.ifcx' }));
  });

  it('Save As pregunta siempre, sugiere la ruta actual y adopta la nueva', async () => {
    const { ctrl, deps } = setup({ pickSavePath: vi.fn(async () => 'C:/b/otra.ifcx') });
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    await expect(ctrl.saveAs()).resolves.toBe(true);
    expect(deps.pickSavePath).toHaveBeenCalledWith('C:/a/casa.ifcx');
    expect(ctrl.session!.path).toBe('C:/b/otra.ifcx');
    expect(ctrl.session!.name).toBe('otra.ifcx');
  });

  it('it has not been applied yet', async () => {
    const { ctrl, ws } = setup({ pickSavePath: vi.fn(async () => null) });
    await ctrl.newDocument();
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    await expect(ctrl.save()).resolves.toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(ctrl.session!.dirty).toBe(true);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
  });

  it('si la escritura falla: toast de error, false y siguen los cambios', async () => {
    const { ctrl, ws, deps } = setup();
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    tauri.invoke.mockRejectedValueOnce('denied');
    await expect(ctrl.save()).resolves.toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not save casa.ifcx: denied', 'error');
    expect(ctrl.session!.dirty).toBe(true);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
    expect(deps.remember).not.toHaveBeenCalled();
  });

  it('sin documento o en solo lectura, Save avisa y no escribe', async () => {
    const { ctrl, deps } = setup();
    await expect(ctrl.save()).resolves.toBe(false);
    expect(deps.toast).toHaveBeenLastCalledWith('No document is open', 'info');
    ctrl.opened(fakeModel('ajeno.ifcx', 'C:/a/ajeno.ifcx'), null);
    await expect(ctrl.saveAs()).resolves.toBe(false);
    expect(deps.toast).toHaveBeenLastCalledWith('Only models created in Dream BIM can be edited', 'info');
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('without changes it continues without asking', async () => {
    const { ctrl, ws } = setup();
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    const s = ctrl.session!;
    ctrl.editor.addWall([0, 0], [4, 0], ctrl.session!.doc.levels[0].id);
    await ctrl.idle();
    const write = deferred();
    const wallsAtWrite: number[] = [];
    tauri.invoke.mockImplementationOnce(async () => {
      wallsAtWrite.push(s.doc.walls.length);
      await write.promise;
    });
    const saving = ctrl.save();
    await vi.waitFor(() => expect(wallsAtWrite).toEqual([1]));
    ctrl.editor.addWall([4, 0], [4, 4], ctrl.session!.doc.levels[0].id); // llega mientras se escribe
    await Promise.resolve();
    expect(s.doc.walls).toHaveLength(1); // it asks after applying the pending edits, with the name of the document
    write.resolve();
    await expect(saving).resolves.toBe(true);
    await ctrl.idle();
    expect(s.doc.walls).toHaveLength(2);
    expect(s.dirty).toBe(true);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
  });
});

describe('DocumentController: guarda de cambios sin guardar', () => {
  async function dirtyDoc(over: Partial<ControllerDeps> = {}) {
    const t = setup(over);
    t.ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    t.ctrl.editor.addWall([0, 0], [4, 0], t.ctrl.session!.doc.levels[0].id);
    return t;
  }

  it('save: saves and continues', async () => {
    const { ctrl, deps } = setup();
    ctrl.opened(fakeModel('casa.ifcx', 'C:/a/casa.ifcx'), openedSession());
    await expect(ctrl.confirmDiscard()).resolves.toBe(true);
    await ctrl.newDocument();
    await expect(ctrl.confirmDiscard()).resolves.toBe(true);
    expect(deps.askSaveChanges).not.toHaveBeenCalled();
  });

  it('discard: continues without saving', async () => {
    const { ctrl, deps } = await dirtyDoc({ askSaveChanges: vi.fn(async () => 'cancel' as const) });
    await ctrl.confirmDiscard();
    expect(deps.askSaveChanges).toHaveBeenCalledWith('casa.ifcx');
  });

  it('save with the save dialog cancelled: it stays', async () => {
    const { ctrl } = await dirtyDoc();
    await expect(ctrl.confirmDiscard()).resolves.toBe(true);
    expect(tauri.invoke).toHaveBeenCalledWith('write_text_file', expect.anything());
    expect(ctrl.session!.dirty).toBe(false);
  });

  it('addLevel without an editable session resolves null', async () => {
    const { ctrl } = await dirtyDoc({ askSaveChanges: vi.fn(async () => 'discard' as const) });
    await expect(ctrl.confirmDiscard()).resolves.toBe(true);
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('cancel: se queda', async () => {
    const { ctrl } = await dirtyDoc({ askSaveChanges: vi.fn(async () => 'cancel' as const) });
    await expect(ctrl.confirmDiscard()).resolves.toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(ctrl.session!.dirty).toBe(true);
  });

  it('an elevation that would leave a wall with height <= 0 warns and changes nothing', async () => {
    const t = setup({ pickSavePath: vi.fn(async () => null) });
    await t.ctrl.newDocument();
    t.ctrl.editor.addWall([0, 0], [4, 0], t.ctrl.session!.doc.levels[0].id);
    await expect(t.ctrl.confirmDiscard()).resolves.toBe(false);
    expect(t.ctrl.session!.dirty).toBe(true);
  });

  it('save con error al escribir: se queda', async () => {
    const { ctrl, deps } = await dirtyDoc();
    tauri.invoke.mockRejectedValueOnce('disk full');
    await expect(ctrl.confirmDiscard()).resolves.toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not save casa.ifcx: disk full', 'error');
    expect(ctrl.session!.dirty).toBe(true);
  });
});

describe('DocumentController: niveles y restricciones', () => {
  it('addLevel resuelve al id del nivel nuevo, reconstruye el modelo y ensucia', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ws.calls = [];
    const id = await ctrl.addLevel();
    expect(ctrl.session!.doc.levels.map((l) => l.id)).toContain(id);
    expect(ws.calls).toEqual([['updateModel', 'Untitled', null], ['setDirty', true]]);
  });

  it('a valid setWallConstraints rebuilds the model; addWall uses the given level', async () => {
    const { ctrl, ws } = setup();
    expect(await ctrl.addLevel()).toBeNull();
    ctrl.opened(fakeModel('ajeno.ifcx', 'C:/a/ajeno.ifcx'), null);
    expect(await ctrl.addLevel()).toBeNull();
    expect(ws.named('updateModel')).toHaveLength(0);
  });

  it('dos cambios seguidos se aplican en orden', async () => {
    const { ctrl } = setup();
    await ctrl.newDocument();
    const id = ctrl.addLevel();
    ctrl.setLevelElevation((await id)!, 6);
    await ctrl.idle();
    expect(ctrl.session!.doc.levels[1].elevation).toBe(6);
  });

  it('un cambio rechazado avisa con un toast y no reconstruye ni ensucia', async () => {
    const { ctrl, ws, deps } = setup();
    await ctrl.newDocument();
    const l2 = (await ctrl.addLevel())!;
    ws.calls = [];
    deps.buildModel.mockClear();
    ctrl.renameLevel(l2, 'Level 1');
    ctrl.renameLevel(l2, '   ');
    await ctrl.idle();
    expect(deps.toast.mock.calls).toEqual([
      ['Another level already has that name', 'error'],
      ['A level needs a name', 'error'],
    ]);
    expect(deps.buildModel).not.toHaveBeenCalled();
    expect(ws.calls).toEqual([]);
  });

  it('without a session they resolve false', async () => {
    const { ctrl, deps } = setup();
    await ctrl.newDocument();
    const l1 = ctrl.session!.doc.levels[0];
    const l2 = (await ctrl.addLevel())!;
    ctrl.editor.addWall([0, 0], [4, 0], l1.id);
    await ctrl.idle();
    const w = ctrl.session!.doc.walls[0];
    ctrl.setWallConstraints(w.id, { topLevelId: l2 });
    ctrl.setLevelElevation(l1.id, 4);
    await ctrl.idle();
    expect(deps.toast).toHaveBeenLastCalledWith('Wall top is below its base', 'error');
    expect(l1.elevation).toBe(0);
  });

  it('setLevelElevation and setWallConstraints also resolve the result', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    const l2 = (await ctrl.addLevel())!;
    ctrl.editor.addWall([0, 0], [4, 0], l2);
    await ctrl.idle();
    const w = ctrl.session!.doc.walls[0];
    expect(w.baseLevelId).toBe(l2);
    ws.calls = [];
    ctrl.setWallConstraints(w.id, { height: 2.5 });
    await ctrl.idle();
    expect(w.height).toBe(2.5);
    expect(ws.calls).toEqual([['updateModel', 'Untitled', null], ['setDirty', true]]);
  });
});

describe('DocumentController: las ediciones indican si se aplicaron', () => {
  it('renameLevel resuelve true al aplicarse (modelo ya reconstruido) y false al rechazarse', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    const l2 = (await ctrl.addLevel())!;
    ws.calls = [];
    expect(await ctrl.renameLevel(l2, 'Level 1')).toBe(false);
    expect(ws.calls).toEqual([]);
    expect(await ctrl.renameLevel(l2, 'Ground')).toBe(true);
    expect(ws.last('updateModel')).toBeDefined();
    expect(ctrl.session!.doc.levels[1].name).toBe('Ground');
  });

  it('an invalid boundary resolves to null without touching the workspace', async () => {
    const { ctrl } = setup();
    expect(await ctrl.renameLevel('x', 'y')).toBe(false);
    expect(await ctrl.setLevelElevation('x', 1)).toBe(false);
    expect(await ctrl.setWallConstraints('x', { height: 2 })).toBe(false);
  });

  it('without a session addFloor resolves to null', async () => {
    const { ctrl } = setup();
    await ctrl.newDocument();
    const l1 = ctrl.session!.doc.levels[0].id;
    expect(await ctrl.setLevelElevation(l1, NaN)).toBe(false);
    expect(await ctrl.setLevelElevation(l1, 1)).toBe(true);
    ctrl.editor.addWall([0, 0], [4, 0], l1);
    await ctrl.idle();
    const w = ctrl.session!.doc.walls[0];
    expect(await ctrl.setWallConstraints(w.id, { height: 0 })).toBe(false);
    expect(await ctrl.setWallConstraints(w.id, { height: 2 })).toBe(true);
  });
});

describe('DocumentController: suelos', () => {
  const rect: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];

  it('addFloor resuelve al id del suelo con el modelo ya reconstruido', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ws.calls = [];
    const id = await ctrl.editor.addFloor(rect, ctrl.session!.doc.levels[0].id);
    expect(id).toBe(ctrl.session!.doc.floors[0].id);
    expect(ws.calls).toEqual([['updateModel', 'Untitled', null], ['setDirty', true]]);
  });

  it('setFloorConstraints applies the change and rejects an invalid one with a toast', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    ws.calls = [];
    expect(await ctrl.editor.addFloor([[0, 0], [1, 0]], ctrl.session!.doc.levels[0].id)).toBeNull();
    expect(ws.calls).toEqual([]);
  });

  it('Controller with the real model of the session and a fake disk for the linked files.', async () => {
    const { ctrl } = setup();
    expect(await ctrl.editor.addFloor(rect, 'nivel')).toBeNull();
  });

  it('deleteFloor quita el suelo', async () => {
    const { ctrl } = setup();
    await ctrl.newDocument();
    const id = (await ctrl.editor.addFloor(rect, ctrl.session!.doc.levels[0].id))!;
    ctrl.editor.deleteFloor(id);
    await ctrl.idle();
    expect(ctrl.session!.doc.floors).toHaveLength(0);
  });

  it('Reopens what would be saved: session from the serialized file and opened().', async () => {
    const { ctrl, deps } = setup();
    await ctrl.newDocument();
    const id = (await ctrl.editor.addFloor(rect, ctrl.session!.doc.levels[0].id))!;
    expect(await ctrl.setFloorConstraints(id, { offset: 0.2 })).toBe(true);
    expect(ctrl.session!.doc.floors[0].offset).toBe(0.2);
    expect(await ctrl.setFloorConstraints(id, { offset: NaN })).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Enter a valid number', 'error');
  });
});

describe('DocumentController: capas', () => {
  const ifcx = (path: string) => JSON.stringify({ data: [{ path }] });
  type FileRow = Extract<StackRow, { kind: 'file' }>;

  /** b is composed after a */
  function composer(files: Record<string, string> = {}, over: Partial<ControllerDeps> = {}) {
    const disk = new Map(Object.entries(files));
    const readText = vi.fn(async (p: string): Promise<string> => {
      const t = disk.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    });
    const t = setup({ buildModel: sessionModel, readText, ...over });
    const rows: (StackRow[] | null)[] = [];
    const stages: StageData[] = [];
    (t.ws as DocWorkspace).setComposer = (r, stage) => {
      rows.push(r);
      stages.push(stage);
    };
    const models: LoadedModel[] = [];
    const update = t.ws.updateModel.bind(t.ws);
    t.ws.updateModel = (m) => {
      models.push(m);
      update(m);
    };
    const fileRows = () => (rows.at(-1) ?? []).filter((r): r is FileRow => r.kind === 'file');
    return { ...t, readText, disk, rows, stages, models, fileRows };
  }

  /** Documento de Studio ya guardado en C:/p/casa.ifcx. */
  async function savedDoc(files: Record<string, string> = {}, over: Partial<ControllerDeps> = {}) {
    const t = composer(files, over);
    await t.ctrl.newDocument();
    await t.ctrl.session!.saveTo('C:/p/casa.ifcx');
    return t;
  }

  /** the nodes of the document (Level 1...) */
  async function reopen(text: string, files: Record<string, string>) {
    const t = composer(files);
    const session = sessionFromFile(JSON.parse(text), 'C:/p/casa.ifcx')!;
    const model = await sessionModel(session);
    await t.ctrl.opened(model, session);
    return t;
  }

  it('linking in an editable document marks it dirty and the stack is saved', async () => {
    const { ctrl, ws, rows, models } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a-node') });
    ws.calls = [];
    expect(await ctrl.linkFile('C:/p/a.ifcx')).toBe(true);
    const s = ctrl.session!;
    expect(s.dirty).toBe(true);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
    expect(models.at(-1)!.result.byOrigin.has('a-node')).toBe(true);
    expect(models.at(-1)!.warnings).toEqual([]);
    const saved = JSON.parse(await s.serialize());
    expect(saved.imports.map((i: { uri: string }) => i.uri)).toContain('./a.ifcx');
    expect(s.doc.composer.layers).toEqual([expect.objectContaining({ uri: './a.ifcx', name: 'a.ifcx', enabled: true })]);
    expect(s.doc.composer.layers[0]).not.toHaveProperty('id');
    expect(rows.at(-1)).toEqual([
      {
        kind: 'file', id: ctrl.composerLayers[0].id, name: 'a.ifcx', path: 'C:/p/a.ifcx',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/), enabled: true, missing: false, editCount: 0, editsEnabled: true, orphans: [],
      },
      { kind: 'document', name: 'casa.ifcx', path: 'C:/p/casa.ifcx', targets: expect.any(Array) },
    ]);
    expect(ctrl.linkedFile(ctrl.composerLayers[0].id)?.data).toEqual([{ path: 'a-node' }]);
  });

  it('a layer that only adds children to a node does not take it from the layer that defines it', async () => {
    const files = {
      'C:/p/base.ifcx': JSON.stringify({ data: [{ path: 'lvl', attributes: { 'bsi::ifc::prop::Name': 'L1' } }] }),
      'C:/p/a.ifcx': JSON.stringify({ data: [{ path: 'lvl', children: { w: 'w1' } }, { path: 'w1', attributes: { n: 1 } }] }),
    };
    const { ctrl, stages } = await savedDoc(files);
    await ctrl.linkFile('C:/p/base.ifcx');
    await ctrl.linkFile('C:/p/a.ifcx');
    const [lbase, la] = ctrl.composerLayers;
    const stage = stages.at(-1)!;
    expect(stage.sourceOf.get('lvl')).toBe(lbase.id);
    expect(stage.sourceOf.get('w1')).toBe(la.id);
  });

  it('pushes the Stage data: composed root, source layer of each path (the strongest wins) and colours', async () => {
    const two = (...paths: string[]) => JSON.stringify({ data: paths.map((path) => ({ path })) });
    const { ctrl, stages, models } = await savedDoc({ 'C:/p/a.ifcx': two('a', 'shared'), 'C:/p/b.ifcx': two('b', 'shared') });
    await ctrl.linkFile('C:/p/a.ifcx');
    await ctrl.linkFile('C:/p/b.ifcx');
    const [la, lb] = ctrl.composerLayers;
    let stage = stages.at(-1)!;
    expect(stage.root).toBe(models.at(-1)!.result.root);
    expect(stage.sourceOf.get('a')).toBe(la.id);
    expect(stage.sourceOf.get('b')).toBe(lb.id);
    expect(stage.sourceOf.get('shared')).toBe(lb.id); // on closing, the Stage is left empty
    const docOrigins = [...stage.sourceOf].filter(([, v]) => v === 'document').map(([k]) => k);
    expect(docOrigins.length).toBeGreaterThan(0); // another displacement starts from the new position
    expect(stage.colors.get(la.id)).toBe(la.color);
    expect(stage.colors.get(lb.id)).toBe(lb.color);
    expect(stage.colors.get('document')).toBe(DOCUMENT_COLOR);
    expect(stage.marks.size).toBe(0);

    // una capa desactivada no aporta nada al Stage
    await ctrl.setLayerEnabled(lb.id, false);
    stage = stages.at(-1)!;
    expect(stage.sourceOf.has('b')).toBe(false);
    expect(stage.sourceOf.get('shared')).toBe(la.id);

    // a document element that does not move (the building)
    ctrl.closed();
    expect(stages.at(-1)!.root).toBeNull();
    expect(stages.at(-1)!.sourceOf.size).toBe(0);
  });

  it('reopening restores the stack in order', async () => {
    const files = { 'C:/p/a.ifcx': ifcx('a'), 'C:/p/sub/b.ifcx': ifcx('b'), 'C:/q/c.ifcx': ifcx('c') };
    const first = await savedDoc(files);
    for (const p of Object.keys(files)) await first.ctrl.linkFile(p);
    const before = first.ctrl.composerLayers.map((l) => l.name);
    expect(before).toEqual(['a.ifcx', 'b.ifcx', 'c.ifcx']);

    const t = await reopen(await first.ctrl.session!.serialize(), files);
    expect(t.ctrl.composerLayers.map((l) => l.name)).toEqual(before);
    expect(t.readText.mock.calls.map((c) => c[0]).sort()).toEqual(['C:/p/a.ifcx', 'C:/p/sub/b.ifcx', 'C:/q/c.ifcx']);
    expect(t.fileRows().map((r) => [r.name, r.missing])).toEqual([['a.ifcx', false], ['b.ifcx', false], ['c.ifcx', false]]);
    expect(t.ws.calls.slice(0, 3)).toEqual([['setModel', 'casa.ifcx'], ['setDirty', false], ['setEditable', true]]);
    expect(t.ctrl.session!.dirty).toBe(false);
  });

  it('a document whose linked layers could not be read says they will be lost on save', async () => {
    const first = await savedDoc();
    const file = JSON.parse(await first.ctrl.session!.serialize());
    const project = file.data.find((n: { attributes?: Record<string, unknown> }) => n.attributes?.['ifcx-studio::composer'] !== undefined);
    project.attributes['ifcx-studio::composer'] = { layers: [{ uri: 42 }], placements: [] };
    const t = composer();
    const session = sessionFromFile(file, 'C:/p/casa.ifcx')!;
    await t.ctrl.opened(await sessionModel(session), session);
    expect(t.deps.toast).toHaveBeenCalledWith('Linked layers in casa.ifcx could not be read and will be lost on save', 'error');
    expect(t.ctrl.session).toBe(session); // se abre igual, editable

    const fine = composer();
    const ok = sessionFromFile(JSON.parse(await first.ctrl.session!.serialize()), 'C:/p/casa.ifcx')!;
    await fine.ctrl.opened(await sessionModel(ok), ok);
    expect(fine.deps.toast).not.toHaveBeenCalled();
  });

  it('missing file on reopen keeps its edits and can be relinked', async () => {
    const first = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') });
    await first.ctrl.linkFile('C:/p/a.ifcx');
    const edit = { path: 'a', attributes: { 'bsi::ifc::prop::Name': 'X' } };
    first.ctrl.session!.doc.composer.layers[0].edits.push(edit);

    const t = await reopen(await first.ctrl.session!.serialize(), { 'C:/p/b.ifcx': ifcx('b') });
    expect(t.deps.toast).toHaveBeenCalledWith('File not found: ./a.ifcx', 'info');
    const [row] = t.fileRows();
    expect(row).toMatchObject({ name: 'a.ifcx', missing: true, editCount: 1 });
    expect(t.ctrl.composerLayers[0].edits).toEqual([edit]);
    expect(t.ctrl.linkedFile(row.id)).toBeNull();

    expect(await t.ctrl.relink(row.id, 'C:/p/b.ifcx')).toBe(true);
    expect(t.fileRows()[0]).toMatchObject({ id: row.id, missing: false, editCount: 1, path: 'C:/p/b.ifcx' });
    expect(t.ctrl.composerLayers[0].uri).toBe('./b.ifcx');
    expect(t.ctrl.session!.doc.composer.layers[0].uri).toBe('./b.ifcx');
    expect(t.ctrl.session!.dirty).toBe(true);
    expect(t.models.at(-1)!.result.byOrigin.has('b')).toBe(true);
  });

  it('linking the same file twice is rejected', async () => {
    const { ctrl, deps } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a'), 'C:\\P\\.\\a.ifcx': ifcx('a') });
    expect(await ctrl.linkFile('C:/p/a.ifcx')).toBe(true);
    expect(await ctrl.linkFile('C:\\P\\.\\a.ifcx')).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('a.ifcx is already linked', 'info');
    expect(ctrl.composerLayers).toHaveLength(1);
  });

  it('a document cannot link (or relink a layer to) itself', async () => {
    const { ctrl, deps, readText } = await savedDoc({ 'C:/p/casa.ifcx': ifcx('x'), 'C:/p/a.ifcx': ifcx('a') });
    expect(await ctrl.linkFile('C:\\P\\casa.ifcx')).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith("A document can't link itself", 'info');
    expect(readText).not.toHaveBeenCalled();
    expect(ctrl.composerLayers).toHaveLength(0);
    expect(ctrl.session!.dirty).toBe(false);
    await ctrl.linkFile('C:/p/a.ifcx');
    expect(await ctrl.relink(ctrl.composerLayers[0].id, 'C:/p/casa.ifcx')).toBe(false);
    expect(ctrl.composerLayers[0].uri).toBe('./a.ifcx');
  });

  it('a file that is not IFCx is not linked', async () => {
    const { ctrl, deps } = await savedDoc({ 'C:/p/malo.ifcx': 'hola' });
    expect(await ctrl.linkFile('C:/p/malo.ifcx')).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('Could not link malo.ifcx'), 'error');
    expect(ctrl.composerLayers).toHaveLength(0);
    expect(ctrl.session!.dirty).toBe(false);
  });

  it('an invalid file still warns the same with parseLinked', async () => {
    const parseLinked = vi.fn(async (_t: string) => {
      throw new Error('Not a valid IFCX file: x');
    });
    const { ctrl, deps } = await savedDoc({ 'C:/p/roto.ifcx': 'hola' }, { parseLinked });
    expect(await ctrl.linkFile('C:/p/roto.ifcx')).toBe(false);
    expect(parseLinked).toHaveBeenCalledWith('hola');
    expect(deps.toast).toHaveBeenCalledWith('Could not link roto.ifcx: Not a valid IFCX file: x', 'error');
    expect(ctrl.composerLayers).toHaveLength(0);
  });

  it('linked layers (link and reopen) go through parseLinked; the document does not', async () => {
    const parseLinked = vi.fn(async (t: string) => ({ ...JSON.parse(t), header: {}, imports: [], schemas: {} }) as any);
    const files = { 'C:/p/a.ifcx': ifcx('a') };
    const first = await savedDoc(files, { parseLinked });
    expect(await first.ctrl.linkFile('C:/p/a.ifcx')).toBe(true);
    expect(parseLinked).toHaveBeenCalledTimes(1);
    const text = await first.ctrl.session!.serialize();
    parseLinked.mockClear();
    const t = composer(files, { parseLinked });
    const session = sessionFromFile(JSON.parse(text), 'C:/p/casa.ifcx')!;
    await t.ctrl.opened(await sessionModel(session), session);
    expect(parseLinked).toHaveBeenCalledTimes(1);
    expect(parseLinked).toHaveBeenCalledWith(files['C:/p/a.ifcx']);
    expect(t.ctrl.composerLayers.map((l) => l.name)).toEqual(['a.ifcx']);
  });

  it('moveLayer reorders and the document stays last', async () => {
    const { ctrl, rows } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a'), 'C:/p/b.ifcx': ifcx('b'), 'C:/p/c.ifcx': ifcx('c') });
    for (const n of ['a', 'b', 'c']) await ctrl.linkFile(`C:/p/${n}.ifcx`);
    const id = (name: string) => ctrl.composerLayers.find((l) => l.name === name)!.id;
    const names = () => ctrl.composerLayers.map((l) => l.name[0]);
    expect(await ctrl.moveLayer(id('c.ifcx'), 0)).toBe(true);
    expect(names()).toEqual(['c', 'a', 'b']);
    expect(ctrl.session!.doc.composer.layers.map((l) => l.name[0])).toEqual(['c', 'a', 'b']);
    expect(rows.at(-1)!.at(-1)).toEqual({ kind: 'document', name: 'casa.ifcx', path: 'C:/p/casa.ifcx', targets: expect.any(Array) });
    expect(await ctrl.moveLayer(id('c.ifcx'), 99)).toBe(true);
    expect(names()).toEqual(['a', 'b', 'c']);
    expect(await ctrl.moveLayer(id('b.ifcx'), -5)).toBe(true);
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(await ctrl.moveLayer('nada', 0)).toBe(false);
  });

  it('enabling, disabling and the edits switch mark the document dirty', async () => {
    const { ctrl, ws, fileRows } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') });
    await ctrl.linkFile('C:/p/a.ifcx');
    await ctrl.save();
    expect(ctrl.session!.dirty).toBe(false);
    const id = ctrl.composerLayers[0].id;
    expect(await ctrl.setLayerEnabled(id, false)).toBe(true);
    expect(fileRows()[0].enabled).toBe(false);
    expect(ctrl.session!.doc.composer.layers[0].enabled).toBe(false);
    expect(ctrl.session!.dirty).toBe(true);
    expect(ws.last('setDirty')).toEqual(['setDirty', true]);
    expect(await ctrl.setEditsEnabled(id, false)).toBe(true);
    expect(fileRows()[0].editsEnabled).toBe(false);
    expect(await ctrl.setLayerEnabled('nada', true)).toBe(false);
    expect(await ctrl.setEditsEnabled('nada', true)).toBe(false);
  });

  it('unlink with edits asks first', async () => {
    const confirm = vi.fn(async (_m: string, _ok: string) => false);
    const { ctrl, ws } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') }, { confirm });
    await ctrl.linkFile('C:/p/a.ifcx');
    const id = ctrl.composerLayers[0].id;
    ctrl.composerLayers[0].edits.push({ path: 'a' }, { path: 'b' });
    ws.calls = [];
    expect(await ctrl.unlink(id)).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Remove a.ifcx and its 2 edits?', 'Remove');
    expect(ctrl.composerLayers).toHaveLength(1);
    expect(ws.calls).toEqual([]);
    confirm.mockResolvedValueOnce(true);
    expect(await ctrl.unlink(id)).toBe(true);
    expect(ctrl.composerLayers).toHaveLength(0);
    expect(ctrl.session!.doc.composer.layers).toHaveLength(0);
    expect(JSON.parse(await ctrl.session!.serialize()).imports.map((i: { uri: string }) => i.uri)).not.toContain('./a.ifcx');
  });

  it('unlink without edits does not ask', async () => {
    const confirm = vi.fn(async () => false);
    const { ctrl } = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') }, { confirm });
    await ctrl.linkFile('C:/p/a.ifcx');
    expect(await ctrl.unlink(ctrl.composerLayers[0].id)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(await ctrl.unlink('nada')).toBe(false);
  });

  it('the unlink confirmation says edits, placement or both, with the right plural', async () => {
    const confirm = vi.fn(async (_m: string, _ok: string) => false);
    const linked = JSON.stringify({ data: [{ path: 'R', children: { c: 'C' } }, { path: 'C' }] });
    const t = await savedDoc({ 'C:/p/a.ifcx': linked }, { confirm });
    await t.ctrl.linkFile('C:/p/a.ifcx');
    const layer = t.ctrl.composerLayers[0];
    const asked = () => confirm.mock.calls.at(-1);
    layer.edits.push({ path: 'C' });
    await t.ctrl.unlink(layer.id);
    expect(asked()).toEqual(['Remove a.ifcx and its 1 edit?', 'Remove']);
    layer.edits.push({ path: 'R' });
    await t.ctrl.place(layer.id, t.ctrl.session!.doc.levels[0].id);
    await t.ctrl.unlink(layer.id);
    expect(asked()).toEqual(['Remove a.ifcx, its 2 edits and its placement?', 'Remove']);
    layer.edits.pop();
    await t.ctrl.unlink(layer.id);
    expect(asked()).toEqual(['Remove a.ifcx, its 1 edit and its placement?', 'Remove']);
    layer.edits.length = 0;
    await t.ctrl.unlink(layer.id);
    expect(asked()).toEqual(['Remove a.ifcx and its placement?', 'Remove']);
  });

  it('Save As rebases the uris; the first Save makes absolute uris relative', async () => {
    const pickSavePath = vi.fn(async (): Promise<string | null> => 'C:/p/casa.ifcx');
    const t = composer({ 'C:/p/sub/a.ifcx': ifcx('a') }, { pickSavePath });
    await t.ctrl.newDocument();
    await t.ctrl.linkFile('C:/p/sub/a.ifcx');
    expect(t.ctrl.composerLayers[0].uri).toBe('C:/p/sub/a.ifcx');
    expect(await t.ctrl.save()).toBe(true);
    expect(t.ctrl.composerLayers[0].uri).toBe('./sub/a.ifcx');
    const written = () => JSON.parse(String((tauri.invoke.mock.calls.at(-1)![1] as { contents: string }).contents));
    expect(written().imports.map((i: { uri: string }) => i.uri)).toContain('./sub/a.ifcx');

    pickSavePath.mockResolvedValueOnce('C:/p/otro/copia.ifcx');
    expect(await t.ctrl.saveAs()).toBe(true);
    expect(t.ctrl.composerLayers[0].uri).toBe('../sub/a.ifcx');
    expect(t.ctrl.session!.doc.composer.layers[0].uri).toBe('../sub/a.ifcx');
    expect(written().imports.map((i: { uri: string }) => i.uri)).toContain('../sub/a.ifcx');
    expect(t.ctrl.linkedFile(t.ctrl.composerLayers[0].id)).not.toBeNull();
    expect(t.fileRows()[0]).toMatchObject({ path: 'C:/p/sub/a.ifcx', missing: false });
  });

  it('a failed Save As keeps the old uris', async () => {
    const t = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') }, { pickSavePath: vi.fn(async () => 'C:/z/otro.ifcx') });
    await t.ctrl.linkFile('C:/p/a.ifcx');
    tauri.invoke.mockRejectedValueOnce('denied');
    expect(await t.ctrl.saveAs()).toBe(false);
    expect(t.ctrl.composerLayers[0].uri).toBe('./a.ifcx');
    expect(t.ctrl.session!.doc.composer.layers[0].uri).toBe('./a.ifcx');
    expect(t.ctrl.session!.path).toBe('C:/p/casa.ifcx');
  });

  it('read-only: the stack is kept in the controller and nothing is marked dirty', async () => {
    const { loadModel } = await import('../src/model/load');
    const t = composer({ 'C:/p/a.ifcx': ifcx('a') });
    const model = await loadModel('ajeno.ifcx', 'C:/p/ajeno.ifcx', ifcx('base-node'));
    await t.ctrl.opened(model, null);
    expect(t.rows.at(-1)).toEqual([{ kind: 'document', name: 'ajeno.ifcx', path: 'C:/p/ajeno.ifcx' }]);
    t.ws.calls = [];
    expect(await t.ctrl.linkFile('C:/p/a.ifcx')).toBe(true);
    expect(t.ws.last('updateModel')).toEqual(['updateModel', 'ajeno.ifcx', 'C:/p/ajeno.ifcx']);
    expect(t.ws.last('setDirty')).toEqual(['setDirty', false]);
    expect(t.models.at(-1)!.result.byOrigin.has('a')).toBe(true);
    expect(t.models.at(-1)!.result.byOrigin.has('base-node')).toBe(true);
    expect(t.fileRows().map((r) => r.name)).toEqual(['a.ifcx']);
    expect(await t.ctrl.unlink(t.ctrl.composerLayers[0].id)).toBe(true);
    expect(t.ws.last('setDirty')).toEqual(['setDirty', false]);
  });

  it('a link still being read when another document opens does not reach the new document', async () => {
    const t = await savedDoc({ 'C:/p/b.ifcx': ifcx('b') });
    const read = deferred<string>();
    t.readText.mockImplementationOnce(() => read.promise);
    const linking = t.ctrl.linkFile('C:/p/a.ifcx');
    await vi.waitFor(() => expect(t.readText).toHaveBeenCalledWith('C:/p/a.ifcx'));
    const other = openedSession('C:/p/otro.ifcx');
    await t.ctrl.opened(await sessionModel(other), other);
    read.resolve(ifcx('a'));
    expect(await linking).toBe(false);
    expect(t.ctrl.composerLayers).toEqual([]);
    expect(other.doc.composer.layers).toEqual([]);
    expect(other.dirty).toBe(false);
    expect(await t.ctrl.linkFile('C:/p/b.ifcx')).toBe(true);
    expect(other.doc.composer.layers.map((l) => l.uri)).toEqual(['./b.ifcx']);
  });

  it('a Save As whose dialog closes after another document opened does nothing', async () => {
    const dialog = deferred<string | null>();
    const t = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') }, { pickSavePath: vi.fn(() => dialog.promise) });
    await t.ctrl.linkFile('C:/p/a.ifcx');
    const first = t.ctrl.session!;
    const saving = t.ctrl.saveAs();
    await vi.waitFor(() => expect(t.deps.pickSavePath).toHaveBeenCalled());
    const other = openedSession('C:/p/otro.ifcx');
    await t.ctrl.opened(await sessionModel(other), other);
    tauri.invoke.mockClear();
    dialog.resolve('C:/z/copia.ifcx');
    expect(await saving).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(first.path).toBe('C:/p/casa.ifcx');
    expect(first.doc.composer.layers[0].uri).toBe('./a.ifcx');
    expect(other.path).toBe('C:/p/otro.ifcx');
  });

  it('closing or opening another document drops the stack; without a document nothing happens', async () => {
    const t = await savedDoc({ 'C:/p/a.ifcx': ifcx('a') });
    await t.ctrl.linkFile('C:/p/a.ifcx');
    t.ctrl.closed();
    expect(t.rows.at(-1)).toBeNull();
    expect(t.ctrl.composerLayers).toEqual([]);
    t.ws.calls = [];
    expect(await t.ctrl.linkFile('C:/p/a.ifcx')).toBe(false);
    expect(t.ws.calls).toEqual([]);
    await t.ctrl.newDocument();
    expect(t.ctrl.composerLayers).toEqual([]);
  });

  describe('editing linked properties', () => {
    const TAG = 'bsi::ifc::prop::Tag';
    const linked = JSON.stringify({
      data: [
        { path: 'P', children: { a: 'C', b: 'C', s: 'S' } },
        { path: 'C', attributes: { [TAG]: 'C-01', 'bsi::ifc::class': { code: 'IfcWall' } } },
        { path: 'S', attributes: { [TAG]: 'S-01', 'bsi::ifc::prop::Height': 3, 'bsi::ifc::prop::IsExternal': true } },
      ],
    });

    async function linkedDoc() {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      const at = (p: string) => t.models.at(-1)!.result.byPath.get(p)!;
      t.ws.calls = [];
      t.ctrl.session!.dirty = false;
      return { ...t, layer, at };
    }

    it('set writes into the edit layer and the node shows the edited mark', async () => {
      const t = await linkedDoc();
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/s'), TAG)).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), TAG, 'S-02')).toBe(true);
      expect(t.ctrl.composerLayers[0].edits).toEqual([{ path: 'S', attributes: { [TAG]: 'S-02' } }]);
      expect(t.ctrl.session!.doc.composer.layers[0].edits).toEqual(t.ctrl.composerLayers[0].edits); // se guarda
      expect(t.ctrl.session!.dirty).toBe(true);
      expect(t.ws.last('setDirty')).toEqual(['setDirty', true]);
      expect(t.at('/P/s').attributes[TAG]).toBe('S-02');
      expect(t.stages.at(-1)!.marks.get('S')).toEqual(['edited']);
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/s'), TAG)).toBe(true);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), 'bsi::ifc::prop::Height', 4.5)).toBe(true);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), 'bsi::ifc::prop::IsExternal', false)).toBe(true);
      expect(t.at('/P/s').attributes['bsi::ifc::prop::Height']).toBe(4.5);
      expect(t.at('/P/s').attributes['bsi::ifc::prop::IsExternal']).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toHaveLength(1);
    });

    it('the Reset mark is hidden while the layer edits are switched off', async () => {
      const t = await linkedDoc();
      await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), TAG, 'S-02');
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/s'), TAG)).toBe(true);
      await t.ctrl.setEditsEnabled(t.layer.id, false);
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/s'), TAG)).toBe(false);
    });

    it('with the layer edits switched off, set and reset are refused with a hint', async () => {
      const t = await linkedDoc();
      await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), TAG, 'S-02');
      const before = JSON.parse(JSON.stringify(t.ctrl.composerLayers[0].edits));
      await t.ctrl.setEditsEnabled(t.layer.id, false);
      t.ctrl.session!.dirty = false;
      t.deps.toast.mockClear();
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), TAG, 'S-03')).toBe(false);
      expect(await t.ctrl.resetLinkedAttr(t.layer.id, t.at('/P/s'), TAG)).toBe(false);
      expect(t.deps.toast).toHaveBeenCalledTimes(2);
      expect(t.deps.toast).toHaveBeenCalledWith('Turn on "Edits · a.ifcx" to edit this element', 'info');
      expect(t.ctrl.composerLayers[0].edits).toEqual(before);
      expect(t.ctrl.composerLayers[0].editsEnabled).toBe(false);
      expect(t.ctrl.session!.dirty).toBe(false);
    });

    it('a reused element is edited per instance', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/a'), TAG, 'X')).toBe(true);
      expect(t.ctrl.composerLayers[0].edits).toEqual([{ path: 'P/a', attributes: { [TAG]: 'X' } }]);
      expect(t.at('/P/a').attributes[TAG]).toBe('X');
      expect(t.at('/P/b').attributes[TAG]).toBe('C-01');
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/a'), TAG)).toBe(true);
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/b'), TAG)).toBe(false);
    });

    it("reset removes the override and the file's value comes back", async () => {
      const t = await linkedDoc();
      await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/s'), TAG, 'S-02');
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.resetLinkedAttr(t.layer.id, t.at('/P/s'), TAG)).toBe(true);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
      expect(t.at('/P/s').attributes[TAG]).toBe('S-01');
      expect(t.ctrl.session!.dirty).toBe(true);
      expect(t.stages.at(-1)!.marks.has('S')).toBe(false);
      expect(t.ctrl.linkedAttrEdited(t.layer.id, t.at('/P/s'), TAG)).toBe(false);
    });

    it('keys that are not editable, objects and unchanged values are not written', async () => {
      const t = await linkedDoc();
      const s = t.at('/P/s');
      expect(await t.ctrl.setLinkedAttr(t.layer.id, t.at('/P/a'), 'bsi::ifc::class', 'x')).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, s, 'usd::usdgeom::visibility', 'invisible')).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, s, 'gltf::name', 'x')).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, s, TAG, { a: 1 } as unknown as string)).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, s, 'bsi::ifc::prop::Height', NaN)).toBe(false);
      expect(await t.ctrl.setLinkedAttr('nope', s, TAG, 'x')).toBe(false);
      expect(await t.ctrl.setLinkedAttr(t.layer.id, s, TAG, 'S-01')).toBe(true); // sin cambios: nada que escribir
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
      expect(t.ctrl.session!.dirty).toBe(false);
    });

    it('read-only documents never edit linked properties', async () => {
      const t = composer({ 'C:/p/a.ifcx': linked });
      await t.ctrl.opened(await sessionModel(openedSession('C:/p/casa.ifcx')), null);
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const node = t.models.at(-1)!.result.byPath.get('/P/s')!;
      const id = t.ctrl.composerLayers[0].id;
      expect(await t.ctrl.setLinkedAttr(id, node, TAG, 'x')).toBe(false);
      expect(await t.ctrl.resetLinkedAttr(id, node, TAG)).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
    });

    it('a document switch during the write does not write', async () => {
      const t = await linkedDoc();
      const layer = t.ctrl.composerLayers[0];
      const p = t.ctrl.setLinkedAttr(layer.id, t.at('/P/s'), TAG, 'S-02');
      void t.ctrl.newDocument();
      expect(await p).toBe(false);
      expect(layer.edits).toEqual([]);
    });
  });

  describe('moving elements', () => {
    const linked = JSON.stringify({
      data: [
        { path: 'P', children: { c: 'C' }, attributes: { 'usd::xformop': { transform: translation([10, 0, 0]) } } },
        { path: 'C' },
      ],
    });

    async function linkedDoc() {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      const target = (): MoveTarget => {
        const r = t.models.at(-1)!.result;
        const node = r.byPath.get('/P/c')!;
        return { branch: layer.id, path: editPath(node, r), node };
      };
      return { ...t, layer, target };
    }

    it('moveBy on a linked element writes into its edit layer and marks dirty', async () => {
      const t = await linkedDoc();
      t.ws.calls = [];
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.moveBy(t.target(), [1, 2, 3])).toBe(true);
      const layer = t.ctrl.composerLayers[0];
      expect(layer.edits).toEqual([{ path: 'C', attributes: { 'usd::xformop': { transform: translation([1, 2, 3]) } } }]);
      expect(t.ctrl.session!.doc.composer.layers[0].edits).toEqual(layer.edits); // se guarda
      expect(t.ctrl.session!.dirty).toBe(true);
      expect(t.ws.last('setDirty')).toEqual(['setDirty', true]);
      expect(t.fileRows()[0].editCount).toBe(1);
      // recompuesto: el origen en el mundo refleja el cambio
      expect(worldOrigin(t.models.at(-1)!.result.byPath.get('/P/c')!)).toEqual([11, 2, 3]);
      expect(t.stages.at(-1)!.marks.get('C')).toEqual(['moved']);
      // it is on the axis of the wall, at the elevation of its base plus the sill
      expect(await t.ctrl.moveBy(t.target(), [1, 0, 0])).toBe(true);
      expect(worldOrigin(t.models.at(-1)!.result.byPath.get('/P/c')!)).toEqual([12, 2, 3]);
      expect(t.ctrl.composerLayers[0].edits).toHaveLength(1);
    });

    it('moveTo on a linked element places its origin at that point', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.moveTo(t.target(), [0, 0, 1])).toBe(true);
      expect(worldOrigin(t.models.at(-1)!.result.byPath.get('/P/c')!)).toEqual([0, 0, 1]);
    });

    it('with its edits switched off a linked element is not moved (the hidden move is kept)', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.moveBy(t.target(), [1, 2, 3])).toBe(true);
      const before = JSON.parse(JSON.stringify(t.ctrl.composerLayers[0].edits));
      await t.ctrl.setEditsEnabled(t.layer.id, false);
      t.ctrl.session!.dirty = false;
      t.deps.toast.mockClear();
      expect(await t.ctrl.moveBy(t.target(), [1, 0, 0])).toBe(false);
      expect(await t.ctrl.moveTo(t.target(), [0, 0, 0])).toBe(false);
      expect(t.deps.toast).toHaveBeenCalledWith('Turn on "Edits · a.ifcx" to edit this element', 'info');
      expect(t.ctrl.composerLayers[0].edits).toEqual(before);
      expect(t.ctrl.composerLayers[0].editsEnabled).toBe(false);
      expect(t.ctrl.session!.dirty).toBe(false);
    });

    it('a linked element of a layer that no longer exists is not moved', async () => {
      const t = await linkedDoc();
      const target = t.target();
      await t.ctrl.unlink(t.layer.id);
      expect(await t.ctrl.moveBy(target, [1, 0, 0])).toBe(false);
    });

    it('read-only documents do not move anything', async () => {
      const t = composer({ 'C:/p/a.ifcx': linked });
      await t.ctrl.opened(await sessionModel(openedSession('C:/p/casa.ifcx')), null);
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const r = t.models.at(-1)!.result;
      const node = r.byPath.get('/P/c')!;
      const target = { branch: t.ctrl.composerLayers[0].id, path: editPath(node, r), node };
      expect(await t.ctrl.moveBy(target, [1, 0, 0])).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
    });

    it('moveBy on a document wall ignores Z', async () => {
      const t = await savedDoc();
      const s = t.ctrl.session!;
      t.ctrl.editor.addWall([0, 0], [4, 0], s.doc.levels[0].id);
      await t.ctrl.idle();
      const w = s.doc.walls[0];
      const elevation = s.doc.levels[0].elevation;
      s.dirty = false;
      expect(await t.ctrl.moveBy({ branch: 'document', origin: w.id }, [1, 1, 5])).toBe(true);
      expect(w.start).toEqual([1, 1]);
      expect(w.end).toEqual([5, 1]);
      expect(s.doc.levels[0].elevation).toBe(elevation);
      expect(s.dirty).toBe(true);
      expect(t.ws.last('setDirty')).toEqual(['setDirty', true]);
    });

    it('a document floor moves in X/Y and a level in Z (its elevation)', async () => {
      const t = await savedDoc();
      const s = t.ctrl.session!;
      const level = s.doc.levels[0];
      const id = await t.ctrl.editor.addFloor([[0, 0], [2, 0], [2, 2]], level.id);
      const f = s.doc.floors.find((x) => x.id === id)!;
      expect(await t.ctrl.moveBy({ branch: 'document', origin: f.id }, [1, 0, 9])).toBe(true);
      expect(f.boundary[0]).toEqual([1, 0]);
      const z = level.elevation;
      expect(await t.ctrl.moveBy({ branch: 'document', origin: level.id }, [7, 7, 2])).toBe(true);
      expect(level.elevation).toBe(z + 2);
      expect(await t.ctrl.moveTo({ branch: 'document', origin: level.id }, [0, 0, 1.5])).toBe(true);
      expect(level.elevation).toBe(1.5);
      // back in place the transformation is that of the file: no position edit or marks
      expect(await t.ctrl.moveBy({ branch: 'document', origin: s.doc.ids.building }, [1, 1, 1])).toBe(false);
    });

    it('moveTo on a document wall moves its start point there', async () => {
      const t = await savedDoc();
      const s = t.ctrl.session!;
      t.ctrl.editor.addWall([2, 3], [4, 3], s.doc.levels[0].id);
      await t.ctrl.idle();
      const w = s.doc.walls[0];
      expect(await t.ctrl.moveTo({ branch: 'document', origin: w.id }, [5, 3, 99])).toBe(true);
      expect(w.start).toEqual([5, 3]);
      expect(w.end).toEqual([7, 3]);
    });

    it('allowedAxes and targetPosition', async () => {
      const t = await linkedDoc();
      const s = t.ctrl.session!;
      t.ctrl.editor.addWall([2, 3], [4, 3], s.doc.levels[0].id);
      const fid = await t.ctrl.editor.addFloor([[1, 1], [2, 1], [2, 2]], s.doc.levels[0].id);
      const studio = {
        levels: () => s.doc.levels,
        wall: (id: string) => s.doc.walls.find((w) => w.id === id),
        floor: (id: string) => s.doc.floors.find((f) => f.id === id),
      };
      const w = s.doc.walls[0];
      const level = s.doc.levels[0];
      expect(allowedAxes({ branch: 'document', origin: w.id }, studio)).toEqual({ x: true, y: true, z: false });
      expect(allowedAxes({ branch: 'document', origin: fid! }, studio)).toEqual({ x: true, y: true, z: false });
      expect(allowedAxes({ branch: 'document', origin: level.id }, studio)).toEqual({ x: false, y: false, z: true });
      expect(allowedAxes({ branch: 'document', origin: s.doc.ids.site }, studio)).toEqual({ x: false, y: false, z: false });
      expect(allowedAxes(t.target(), studio)).toEqual({ x: true, y: true, z: true });
      expect(targetPosition({ branch: 'document', origin: w.id }, studio)).toEqual([2, 3, level.elevation]);
      expect(targetPosition({ branch: 'document', origin: fid! }, studio)).toEqual([1, 1, level.elevation]);
      expect(targetPosition({ branch: 'document', origin: level.id }, studio)).toEqual([0, 0, level.elevation]);
      expect(targetPosition(t.target(), studio)).toEqual([10, 0, 0]);
    });
  });

  describe('piezas alojadas en el cuadro Move', () => {
    const montar = () => {
      const s = newSession();
      s.doc.levels[0].elevation = 3;
      const w = s.addWall([0, 0], [0, 4])!;
      s.doc.composer.layers.push({ uri: './d.ifcx', name: 'd', color: '', enabled: true, editsEnabled: true, edits: [] });
      const p = s.addPlacement('./d.ifcx', w.id, ['r'], { host: { along: 1, sill: 0.9, width: 1, height: 1 } })!;
      const studio: MoveStudio = {
        levels: () => s.doc.levels,
        wall: (id) => s.doc.walls.find((x) => x.id === id),
        floor: (id) => s.doc.floors.find((x) => x.id === id),
        placement: (id) => s.doc.composer.placements.find((x) => x.id === id),
      };
      return { s, w, p, studio, target: { branch: 'document', origin: p.id } as MoveTarget };
    };

    it('root of the file', () => {
      const { studio, target } = montar();
      expect(targetPosition(target, studio)).toEqual([0, 1, 3.9]);
      expect(allowedAxes(target, studio)).toEqual({ x: true, y: true, z: true });
    });

    it('gira con el muro y no tiene giro ni escala propios', () => {
      const { studio, target } = montar();
      const none = { x: false, y: false, z: false };
      expect(rotScaleAxes(target, studio)).toEqual({ rot: none, scale: none });
      expect(targetRotScale(target, studio)).toEqual({ rot: [0, 0, 90], scale: [1, 1, 1] });
    });
  });

  describe('rotating and scaling elements', () => {
    const linked = JSON.stringify({
      data: [
        { path: 'P', children: { c: 'C' }, attributes: { 'usd::xformop': { transform: translation([10, 0, 0]) } } },
        { path: 'C' },
      ],
    });

    async function linkedDoc() {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      const node = () => t.models.at(-1)!.result.byPath.get('/P/c')!;
      const target = (): MoveTarget => ({ branch: layer.id, path: editPath(node(), t.models.at(-1)!.result), node: node() });
      return { ...t, layer, node, target };
    }

    it('a linked element turns and scales around its origin, in its edit layer', async () => {
      const t = await linkedDoc();
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.rotateTo(t.target(), [0, 0, 90])).toBe(true);
      near(worldRotScale(t.node()).rot, [0, 0, 90]);
      near(worldOrigin(t.node()), [10, 0, 0]); // no se mueve
      expect(t.ctrl.composerLayers[0].edits).toHaveLength(1);
      expect(t.ctrl.session!.dirty).toBe(true);
      // escalar conserva el giro; repetir lo mismo no cambia nada
      expect(await t.ctrl.scaleTo(t.target(), [2, 2, 0.5])).toBe(true);
      near(worldRotScale(t.node()).scale, [2, 2, 0.5]);
      near(worldRotScale(t.node()).rot, [0, 0, 90]);
      near(worldOrigin(t.node()), [10, 0, 0]);
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.scaleTo(t.target(), [2, 2, 0.5])).toBe(true);
      expect(t.ctrl.session!.dirty).toBe(false);
      // una escala 0 no se acepta
      expect(await t.ctrl.scaleTo(t.target(), [0, 1, 1])).toBe(false);
    });

    it('with its edits switched off a linked element does not turn', async () => {
      const t = await linkedDoc();
      await t.ctrl.setEditsEnabled(t.layer.id, false);
      expect(await t.ctrl.rotateTo(t.target(), [0, 0, 45])).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
    });

    it('a document wall turns in plan around its start point; it does not scale', async () => {
      const t = await savedDoc();
      const s = t.ctrl.session!;
      t.ctrl.editor.addWall([1, 1], [5, 1], s.doc.levels[0].id);
      await t.ctrl.idle();
      const w = s.doc.walls[0];
      const target: MoveTarget = { branch: 'document', origin: w.id };
      expect(await t.ctrl.rotateTo(target, [30, 30, 90])).toBe(true); // X e Y no cuentan
      expect(w.start).toEqual([1, 1]);
      near(w.end, [1, 5]);
      expect(await t.ctrl.scaleTo(target, [2, 2, 2])).toBe(false);
      near(w.end, [1, 5]);
    });

    it('a document floor turns around its first vertex; a level neither turns nor scales', async () => {
      const t = await savedDoc();
      const s = t.ctrl.session!;
      const level = s.doc.levels[0];
      const id = await t.ctrl.editor.addFloor([[0, 0], [2, 0], [2, 2]], level.id);
      const f = s.doc.floors.find((x) => x.id === id)!;
      expect(await t.ctrl.rotateTo({ branch: 'document', origin: f.id }, [0, 0, 90])).toBe(true);
      near(f.boundary[0], [0, 0]);
      near(f.boundary[1], [0, 2]);
      near(f.boundary[2], [-2, 2]);
      expect(await t.ctrl.rotateTo({ branch: 'document', origin: level.id }, [0, 0, 90])).toBe(false);
      expect(await t.ctrl.scaleTo({ branch: 'document', origin: level.id }, [2, 2, 2])).toBe(false);
    });

    it('rotScaleAxes and targetRotScale', async () => {
      const t = await linkedDoc();
      const s = t.ctrl.session!;
      t.ctrl.editor.addWall([0, 0], [0, 3], s.doc.levels[0].id);
      const fid = await t.ctrl.editor.addFloor([[1, 1], [1, 2], [0, 2]], s.doc.levels[0].id);
      const studio = {
        levels: () => s.doc.levels,
        wall: (id: string) => s.doc.walls.find((w) => w.id === id),
        floor: (id: string) => s.doc.floors.find((f) => f.id === id),
      };
      const all = { x: true, y: true, z: true };
      const none = { x: false, y: false, z: false };
      const w: MoveTarget = { branch: 'document', origin: s.doc.walls[0].id };
      expect(rotScaleAxes(w, studio)).toEqual({ rot: { x: false, y: false, z: true }, scale: none });
      expect(rotScaleAxes({ branch: 'document', origin: s.doc.levels[0].id }, studio)).toEqual({ rot: none, scale: none });
      expect(rotScaleAxes(t.target(), studio)).toEqual({ rot: all, scale: all });
      expect(targetRotScale(w, studio)).toEqual({ rot: [0, 0, 90], scale: [1, 1, 1] });
      near(targetRotScale({ branch: 'document', origin: fid! }, studio).rot, [0, 0, 90]);
      near(targetRotScale(t.target(), studio).scale, [1, 1, 1]);
    });
  });

  describe('relocating elements', () => {
    const z = (v: number) => ({ 'usd::xformop': { transform: translation([0, 0, v]) } });
    const linked = JSON.stringify({
      data: [
        { path: 'B', children: { l1: 'L1', l2: 'L2', l3: 'L3' } },
        { path: 'L1', children: { w: 'W' }, attributes: z(0) },
        { path: 'L2', attributes: z(3) },
        { path: 'L3', children: { w: 'X' }, attributes: z(6) },
        { path: 'W', attributes: { 'usd::xformop': { transform: translation([4, 5, 0]) } } },
        { path: 'X' },
      ],
    });

    async function linkedDoc(text = linked) {
      const t = await savedDoc({ 'C:/p/a.ifcx': text });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      const at = (p: string) => t.models.at(-1)!.result.byPath.get(p);
      return { ...t, layer, at };
    }

    it('reparent writes into the edit layer, keeps the world position and marks relocated', async () => {
      const t = await linkedDoc();
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L2')).toBe(true);
      const edits = t.ctrl.composerLayers[0].edits;
      expect(edits).toEqual([
        { path: 'L1', children: { w: null } },
        { path: 'L2', children: { w: 'W' } },
        { path: 'W', attributes: { 'usd::xformop': { transform: expect.any(Array) } } },
      ]);
      expect(t.ctrl.session!.doc.composer.layers[0].edits).toEqual(edits); // se guarda
      expect(t.ctrl.session!.dirty).toBe(true);
      expect(t.at('/B/l1/w')).toBeUndefined();
      worldOrigin(t.at('/B/l2/w')!).forEach((v, i) => expect(v).toBeCloseTo([4, 5, 0][i], 12));
      expect(t.stages.at(-1)!.marks.get('W')).toContain('relocated');
      // y de vuelta
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L1')).toBe(true);
      worldOrigin(t.at('/B/l1/w')!).forEach((v, i) => expect(v).toBeCloseTo([4, 5, 0][i], 12));
      expect(t.at('/B/l2/w')).toBeUndefined();
      // it is no longer there
      expect(t.ctrl.composerLayers[0].edits.map((n) => n.path)).toEqual(['L1', 'L2']);
      expect(t.stages.at(-1)!.marks.has('W')).toBe(false);
    });

    it('keeps the full world matrix when the new parent is rotated and non-uniformly scaled', async () => {
      const c = Math.SQRT1_2;
      const t = await linkedDoc(JSON.stringify({
        data: [
          { path: 'B', children: { l1: 'L1', l2: 'L2' } },
          { path: 'L1', children: { w: 'W' }, attributes: z(0) },
          { path: 'L2', attributes: { 'usd::xformop': { transform: [[2 * c, 2 * c, 0, 0], [-c, c, 0, 0], [0, 0, 0.5, 0], [1, 0, 3, 1]] } } },
          { path: 'W', attributes: { 'usd::xformop': { transform: [[0, 1, 0, 0], [-3, 0, 0, 0], [0, 0, 1, 0], [4, 5, 0, 1]] } } },
        ],
      }));
      const before = worldMatrix(t.at('/B/l1/w')!).elements;
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L2')).toBe(true);
      const after = worldMatrix(t.at('/B/l2/w')!).elements;
      after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
    });

    it('onto another instance of itself (or inside one): false, no edits, not dirty', async () => {
      const t = await linkedDoc(JSON.stringify({
        data: [
          { path: 'R', children: { a: 'A', b: 'B' } },
          { path: 'A', children: { n: 'N' } },
          { path: 'B', children: { n: 'N' } },
          { path: 'N', children: { c: 'C' } },
          { path: 'C' },
        ],
      }));
      t.ctrl.session!.dirty = false;
      expect(await t.ctrl.reparent(t.layer.id, 'N', 'N', { node: '/R/a/n', parent: '/R/b/n' })).toBe(false);
      expect(await t.ctrl.reparent(t.layer.id, 'N', 'C', { node: '/R/a/n', parent: '/R/b/n/c' })).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
      expect(t.ctrl.session!.dirty).toBe(false);
      expect(t.at('/R/a/n')).toBeDefined();
    });

    it('a name already used in the new parent gets the suffix -2', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L3')).toBe(true);
      expect(t.at('/B/l3/w')!.origin).toBe('X');
      expect(t.at('/B/l3/w-2')!.origin).toBe('W');
      worldOrigin(t.at('/B/l3/w-2')!).forEach((v, i) => expect(v).toBeCloseTo([4, 5, 0][i], 12));
    });

    it('onto itself, a descendant or its own parent, an unknown layer or a read-only document: false, no edits', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.reparent(t.layer.id, 'L1', 'W')).toBe(false); // descendiente
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'W')).toBe(false);
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L1')).toBe(false); // ya es su padre
      expect(await t.ctrl.reparent(t.layer.id, 'B', 'L2')).toBe(false); // it recomposes with the orphan
      expect(await t.ctrl.reparent('nope', 'W', 'L2')).toBe(false);
      expect(await t.ctrl.reparent(t.layer.id, 'nope', 'L2')).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);

      const r = composer({ 'C:/p/a.ifcx': linked });
      await r.ctrl.opened(await sessionModel(openedSession('C:/p/casa.ifcx')), null);
      await r.ctrl.linkFile('C:/p/a.ifcx');
      expect(await r.ctrl.reparent(r.ctrl.composerLayers[0].id, 'W', 'L2')).toBe(false);
      expect(r.ctrl.composerLayers[0].edits).toEqual([]);
    });

    it('a reused element only relocates the instance that was dragged', async () => {
      const t = await linkedDoc(JSON.stringify({
        data: [
          { path: 'R', children: { a: 'A', b: 'B', l2: 'L2' } },
          { path: 'A', children: { door: 'D' } },
          { path: 'B', children: { door: 'D' }, attributes: z(1) },
          { path: 'L2', attributes: z(3) },
          { path: 'D' },
        ],
      }));
      expect(await t.ctrl.reparent(t.layer.id, 'D', 'L2', { node: '/R/b/door', parent: '/R/l2' })).toBe(true);
      expect(t.at('/R/a/door')).toBeDefined(); // la otra copia no cambia
      expect(t.at('/R/b/door')).toBeUndefined();
      expect(t.at('/R/l2/door')!.origin).toBe('D');
      worldOrigin(t.at('/R/l2/door')!).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1][i], 12));
      expect(worldOrigin(t.at('/R/a/door')!)).toEqual([0, 0, 0]);
      expect(t.ctrl.composerLayers[0].edits.map((n) => n.path)).toEqual(['B', 'L2', 'L2/door']);
      expect(t.stages.at(-1)!.marks.get('D')).toContain('relocated');
    });

    it('with its edits switched off an element is not relocated (no duplicate from the hidden move)', async () => {
      const t = await linkedDoc();
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L2')).toBe(true);
      const before = JSON.parse(JSON.stringify(t.ctrl.composerLayers[0].edits));
      await t.ctrl.setEditsEnabled(t.layer.id, false);
      expect(t.at('/B/l1/w')).toBeDefined(); // sin las ediciones vuelve a verse bajo L1
      t.ctrl.session!.dirty = false;
      t.deps.toast.mockClear();
      expect(await t.ctrl.reparent(t.layer.id, 'W', 'L3', { node: '/B/l1/w', parent: '/B/l3' })).toBe(false);
      expect(t.deps.toast).toHaveBeenCalledWith('Turn on "Edits · a.ifcx" to edit this element', 'info');
      expect(t.ctrl.composerLayers[0].edits).toEqual(before);
      expect(t.ctrl.composerLayers[0].editsEnabled).toBe(false);
      expect(t.ctrl.session!.dirty).toBe(false);
    });

    it('a relocation queued for a document that was then closed is dropped', async () => {
      const t = await linkedDoc();
      const p = t.ctrl.reparent(t.layer.id, 'W', 'L2');
      t.ctrl.closed();
      expect(await p).toBe(false);
    });
  });

  describe('orphaned edits', () => {
    const linked = JSON.stringify({
      data: [{ path: 'P', children: { s: 'S' } }, { path: 'S', attributes: { 'bsi::ifc::prop::Tag': 'S-01' } }],
    });
    const gone = { path: 'GONE', attributes: { 'bsi::ifc::prop::Tag': 'x' } };
    const live = { path: 'S', attributes: { 'bsi::ifc::prop::Tag': 'S-02' } };

    async function orphanDoc() {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      layer.edits.push(live, gone);
      await t.ctrl.setLayerEnabled(layer.id, false); // recompone y guarda la pila
      await t.ctrl.setLayerEnabled(layer.id, true);
      t.ctrl.session!.dirty = false;
      return { ...t, layer };
    }

    it('orphan listed and removable', async () => {
      const t = await orphanDoc();
      expect(t.fileRows()[0]).toMatchObject({ editCount: 2, orphans: ['GONE'] });
      t.ws.calls = [];
      expect(await t.ctrl.removeEdit(t.layer.id, 'GONE')).toBe(true);
      expect(t.ctrl.composerLayers[0].edits).toEqual([live]);
      expect(t.ctrl.session!.doc.composer.layers[0].edits).toEqual([live]); // se guarda
      expect(t.ctrl.session!.dirty).toBe(true);
      expect(t.ws.last('setDirty')).toEqual(['setDirty', true]);
      expect(t.fileRows()[0]).toMatchObject({ editCount: 1, orphans: [] });
      expect(await t.ctrl.removeEdit(t.layer.id, 'GONE')).toBe(false); // the row of the file says where it is and the document offers its targets
      expect(await t.ctrl.removeEdit('nada', 'S')).toBe(false);
      expect(t.ctrl.composerLayers[0].edits).toEqual([live]);
    });

    it('an orphan does not stop opening', async () => {
      const first = await orphanDoc();
      const t = composer({ 'C:/p/a.ifcx': linked });
      const session = sessionFromFile(JSON.parse(await first.ctrl.session!.serialize()), 'C:/p/casa.ifcx')!;
      const model = await sessionModel(session);
      await t.ctrl.opened(model, session);
      expect(t.ctrl.composerLayers[0].edits).toEqual([live, gone]);
      expect(t.deps.toast).not.toHaveBeenCalled();
      expect(model.warnings.filter((w) => !isSchemaWarning(w))).toEqual([]);
      await t.ctrl.setLayerEnabled(t.ctrl.composerLayers[0].id, false);
      await t.ctrl.setLayerEnabled(t.ctrl.composerLayers[0].id, true); // a node of its own: it would be a cycle
      expect(t.models.at(-1)!.warnings.filter((w) => !isSchemaWarning(w))).toEqual([]);
      expect(t.models.at(-1)!.result.byOrigin.has('S')).toBe(true);
      expect(t.fileRows()[0]).toMatchObject({ editCount: 2, orphans: ['GONE'], missing: false });
    });

    it('orphans of a file that cannot be read are not reported (nothing to compare with)', async () => {
      const first = await orphanDoc();
      const t = await reopen(await first.ctrl.session!.serialize(), {});
      expect(t.fileRows()[0]).toMatchObject({ missing: true, editCount: 2, orphans: [] });
    });
  });

  describe('placing a linked file', () => {
    const linked = JSON.stringify({ data: [{ path: 'R', children: { c: 'C' } }, { path: 'C' }] });

    async function placedDoc() {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      const layer = t.ctrl.composerLayers[0];
      const s = t.ctrl.session!;
      const level = s.doc.levels[0];
      const root = () => t.models.at(-1)!.result.byOrigin.get('R')![0];
      const containers = () =>
        [...t.models.at(-1)!.result.byPath.values()].filter((n) => String(n.attributes['bsi::ifc::prop::Name'] ?? '').startsWith('Linked · '));
      const studio = {
        levels: () => s.doc.levels,
        wall: (id: string) => s.doc.walls.find((w) => w.id === id),
        floor: (id: string) => s.doc.floors.find((f) => f.id === id),
        placement: (id: string) => s.doc.composer.placements.find((p) => p.id === id),
      };
      return { ...t, layer, s, level, root, containers, studio };
    }

    it('place on a level: the roots hang from the container and rise with the level', async () => {
      const t = await placedDoc();
      t.s.dirty = false;
      expect(await t.ctrl.place(t.layer.id, t.level.id)).toBe(true);
      expect(t.s.dirty).toBe(true);
      expect(t.s.doc.composer.placements).toEqual([
        { id: expect.any(String), layerUri: './a.ifcx', parentId: t.level.id, roots: ['R'], offset: [0, 0, 0] },
      ]);
      const container = t.root().parent!;
      expect(container.origin).toBe(t.s.doc.composer.placements[0].id);
      expect(container.attributes['bsi::ifc::prop::Name']).toBe('Linked · a.ifcx');
      expect(container.parent!.origin).toBe(t.level.id);
      expect(t.models.at(-1)!.warnings).toEqual([]);
      expect(worldOrigin(t.root())[2]).toBe(0);
      // the placement survives saving and reopening
      expect(t.fileRows()[0].placedIn).toBe(t.level.id);
      expect(t.rows.at(-1)!.at(-1)).toEqual({
        kind: 'document', name: 'casa.ifcx', path: 'C:/p/casa.ifcx',
        targets: [{ id: t.s.doc.ids.project, name: 'Project' }, { id: t.level.id, name: 'Level 1' }],
      });
      expect(await t.ctrl.setLevelElevation(t.level.id, 3)).toBe(true);
      expect(worldOrigin(t.root())[2]).toBe(3);
    });

    it('the container of a placed file turns and scales; it is saved and neutral values are dropped', async () => {
      const t = await placedDoc();
      await t.ctrl.place(t.layer.id, t.level.id);
      const target: MoveTarget = { branch: 'document', origin: t.s.doc.composer.placements[0].id };
      expect(rotScaleAxes(target, t.studio).scale).toEqual({ x: true, y: true, z: true });
      expect(await t.ctrl.rotateTo(target, [0, 0, 90])).toBe(true);
      expect(await t.ctrl.scaleTo(target, [2, 1, 1])).toBe(true);
      expect(t.s.doc.composer.placements[0]).toEqual(expect.objectContaining({ rotation: [0, 0, 90], scale: [2, 1, 1] }));
      near(worldRotScale(t.root()).rot, [0, 0, 90]);
      near(worldRotScale(t.root()).scale, [2, 1, 1]);
      expect(targetRotScale(target, t.studio)).toEqual({ rot: [0, 0, 90], scale: [2, 1, 1] });
      // se guarda y se vuelve a leer
      const again = sessionFromFile(JSON.parse(await t.s.serialize()), 'C:/p/casa.ifcx')!;
      expect(again.doc.composer.placements[0]).toEqual(expect.objectContaining({ rotation: [0, 0, 90], scale: [2, 1, 1] }));
      // sin giro ni escala no queda rastro
      expect(await t.ctrl.rotateTo(target, [0, 0, 0])).toBe(true);
      expect(await t.ctrl.scaleTo(target, [1, 1, 1])).toBe(true);
      expect(t.s.doc.composer.placements[0]).not.toHaveProperty('rotation');
      expect(t.s.doc.composer.placements[0]).not.toHaveProperty('scale');
    });

    it('placing again changes the parent and keeps the model where it was in the world', async () => {
      const t = await placedDoc();
      await t.ctrl.setLevelElevation(t.level.id, 3);
      await t.ctrl.place(t.layer.id, t.level.id);
      const target: MoveTarget = { branch: 'document', origin: t.s.doc.composer.placements[0].id };
      await t.ctrl.moveBy(target, [1, 2, 0]);
      expect(worldOrigin(t.root())).toEqual([1, 2, 3]);
      // al proyecto (cota 0): no baja 3 m, se compensa el desplazamiento
      expect(await t.ctrl.place(t.layer.id, t.s.doc.ids.project)).toBe(true);
      expect(t.s.doc.composer.placements).toEqual([expect.objectContaining({ parentId: t.s.doc.ids.project, offset: [1, 2, 3] })]);
      expect(t.root().parent!.parent!.origin).toBe(t.s.doc.ids.project);
      expect(worldOrigin(t.root())).toEqual([1, 2, 3]);
      // y de vuelta al nivel
      expect(await t.ctrl.place(t.layer.id, t.level.id)).toBe(true);
      expect(t.s.doc.composer.placements[0].offset).toEqual([1, 2, 0]);
      expect(worldOrigin(t.root())).toEqual([1, 2, 3]);
    });

    it('any element of the document can hold a placement; its own nodes and unknown layers cannot', async () => {
      const t = await placedDoc();
      expect(await t.ctrl.place(t.layer.id, t.s.doc.ids.building)).toBe(true);
      expect(t.root().parent!.parent!.origin).toBe(t.s.doc.ids.building);
      expect(await t.ctrl.place(t.layer.id, t.s.doc.ids.site)).toBe(true);
      expect(t.root().parent!.parent!.origin).toBe(t.s.doc.ids.site);
      t.deps.toast.mockClear();
      expect(await t.ctrl.place(t.layer.id, 'R')).toBe(false); // it becomes a root again
      expect(await t.ctrl.place(t.layer.id, 'C')).toBe(false);
      expect(t.deps.toast).toHaveBeenCalledWith('a.ifcx cannot be placed inside itself', 'info');
      expect(await t.ctrl.place('nada', t.level.id)).toBe(false);
      expect(await t.ctrl.place(t.layer.id, 'no-such-node')).toBe(false);
      expect(t.s.doc.composer.placements.map((p) => p.parentId)).toEqual([t.s.doc.ids.site]);
    });

    it('under a wall it hangs from the wall and follows the wall level', async () => {
      const t = await placedDoc();
      const w = t.s.addWall([0, 0], [4, 0], t.level.id)!;
      await t.ctrl.setLevelElevation(t.level.id, 2);
      expect(await t.ctrl.place(t.layer.id, w.id)).toBe(true);
      expect(t.root().parent!.parent!.origin).toBe(w.id);
      expect(worldOrigin(t.root())).toEqual([0, 0, 2]);
      // it is no longer placed
      const text = await t.s.serialize();
      const again = sessionFromFile(JSON.parse(text), 'C:/p/casa.ifcx')!;
      expect(again.doc.composer.placements[0]).toMatchObject({ parentId: w.id });
      // borrado el muro, pasa al proyecto
      t.ctrl.editor.deleteWall(w.id);
      await t.ctrl.idle();
      const later = sessionFromFile(JSON.parse(await t.s.serialize()), 'C:/p/casa.ifcx')!;
      expect(later.doc.composer.placements[0]).toMatchObject({ parentId: t.s.doc.ids.project });
      expect(later.doc.composer.placements[0].parentLayerUri).toBeUndefined();
    });

    it('a body node of a wall places it under the wall', async () => {
      const t = await placedDoc();
      const w = t.s.addWall([0, 0], [4, 0], t.level.id)!;
      await t.ctrl.setLevelElevation(t.level.id, 0); // reconstruye con el muro
      expect(await t.ctrl.place(t.layer.id, w.bodyId)).toBe(true);
      expect(t.s.doc.composer.placements[0].parentId).toBe(w.id);
    });

    it('moving the container adds to the offset (no edit layer)', async () => {
      const t = await placedDoc();
      await t.ctrl.setLevelElevation(t.level.id, 2);
      await t.ctrl.place(t.layer.id, t.level.id);
      const target: MoveTarget = { branch: 'document', origin: t.s.doc.composer.placements[0].id };
      expect(allowedAxes(target, t.studio)).toEqual({ x: true, y: true, z: true });
      expect(targetPosition(target, t.studio)).toEqual([0, 0, 2]);
      t.s.dirty = false;
      expect(await t.ctrl.moveBy(target, [1, 2, 3])).toBe(true);
      expect(await t.ctrl.moveBy(target, [1, 0, 0])).toBe(true);
      expect(t.s.doc.composer.placements[0].offset).toEqual([2, 2, 3]);
      expect(t.s.dirty).toBe(true);
      expect(t.ctrl.composerLayers[0].edits).toEqual([]);
      expect(worldOrigin(t.root())).toEqual([2, 2, 5]);
      expect(targetPosition(target, t.studio)).toEqual([2, 2, 5]);
      expect(await t.ctrl.moveTo(target, [0, 0, 2])).toBe(true);
      expect(t.s.doc.composer.placements[0].offset).toEqual([0, 0, 0]);
    });

    it('unplace removes the container node', async () => {
      const t = await placedDoc();
      await t.ctrl.place(t.layer.id, t.level.id);
      expect(t.containers()).toHaveLength(1);
      expect(await t.ctrl.unplace(t.layer.id)).toBe(true);
      expect(t.s.doc.composer.placements).toEqual([]);
      expect(t.containers()).toHaveLength(0);
      expect(t.root().parent!.parent).toBeNull(); // Document with a.ifcx (roots `roots`) placed on the level at elevation 3; returns what was saved.
      expect(t.fileRows()[0].placedIn).toBeUndefined();
      expect(await t.ctrl.unplace(t.layer.id)).toBe(false); // it is saved with the next Save
    });

    it('unlink of a placed file leaves no container and no warnings', async () => {
      const t = await placedDoc();
      await t.ctrl.place(t.layer.id, t.level.id);
      expect(await t.ctrl.unlink(t.layer.id)).toBe(true);
      expect(t.s.doc.composer.placements).toEqual([]);
      const saved = JSON.parse(await t.s.serialize()) as { data: { attributes?: Record<string, unknown> }[] };
      expect(saved.data.some((n) => String(n.attributes?.['bsi::ifc::prop::Name'] ?? '').startsWith('Linked ·'))).toBe(false);
      expect(t.containers()).toHaveLength(0);
      expect(t.models.at(-1)!.warnings).toEqual([]);
    });

    it('a placement survives Save As and reopening (uri rebased)', async () => {
      const t = await placedDoc();
      await t.ctrl.place(t.layer.id, t.level.id);
      t.deps.pickSavePath.mockResolvedValueOnce('C:/p/sub/otra.ifcx');
      expect(await t.ctrl.saveAs()).toBe(true);
      expect(t.s.doc.composer.placements[0].layerUri).toBe(t.s.doc.composer.layers[0].uri);
      expect(t.s.doc.composer.placements[0].layerUri).toBe('../a.ifcx');
      const again = composer({ 'C:/p/a.ifcx': linked });
      const session = sessionFromFile(JSON.parse(await t.s.serialize()), 'C:/p/sub/otra.ifcx')!;
      await again.ctrl.opened(await sessionModel(session), session);
      expect(session.doc.composer.placements).toEqual([expect.objectContaining({ layerUri: '../a.ifcx', parentId: t.level.id })]);
      expect(again.ctrl.composerLayers[0].uri).toBe('../a.ifcx');
    });

    describe('roots follow the linked file', () => {
      const withRoots = (...roots: string[]) =>
        JSON.stringify({ data: [...roots.map((r) => ({ path: r, children: { c: `${r}-C` } })), ...roots.map((r) => ({ path: `${r}-C` }))] });

      /** ROOM is still from b (the document only adds a child to it); R is from a */
      async function placedText(...roots: string[]) {
        const t = await savedDoc({ 'C:/p/a.ifcx': withRoots(...roots) });
        await t.ctrl.linkFile('C:/p/a.ifcx');
        const s = t.ctrl.session!;
        await t.ctrl.setLevelElevation(s.doc.levels[0].id, 3);
        expect(await t.ctrl.place(t.ctrl.composerLayers[0].id, s.doc.levels[0].id)).toBe(true);
        return { text: await s.serialize(), level: s.doc.levels[0].id };
      }

      async function reopenWith(text: string, file: string) {
        const t = composer({ 'C:/p/a.ifcx': file });
        const session = sessionFromFile(JSON.parse(text), 'C:/p/casa.ifcx')!;
        const shown = await t.ctrl.opened(await sessionModel(session), session);
        return { ...t, session, shown };
      }

      it('a root added to the file hangs from the container after reopening (and rises with the level)', async () => {
        const { text, level } = await placedText('R');
        const t = await reopenWith(text, withRoots('R', 'R2'));
        expect(t.session.doc.composer.placements[0].roots).toEqual(['R', 'R2']);
        const r2 = t.shown.result.byOrigin.get('R2')![0];
        const container = r2.parent!;
        expect(container.origin).toBe(t.session.doc.composer.placements[0].id);
        expect(container.parent!.origin).toBe(level);
        expect(worldOrigin(r2)[2]).toBe(3);
        expect(t.shown.warnings).toEqual([]);
        expect(t.session.dirty).toBe(false); // while it is switched off
        expect(JSON.parse(await t.session.serialize()).data.find((n: { path: string }) => n.path === container.origin).children)
          .toEqual({ R: 'R', R2: 'R2' });
      });

      it('a root removed from the file gives no Unknown node warning after reopening', async () => {
        const { text } = await placedText('R', 'R2');
        const t = await reopenWith(text, withRoots('R'));
        expect(t.session.doc.composer.placements[0].roots).toEqual(['R']);
        expect(t.shown.warnings).toEqual([]);
        expect(t.shown.result.byOrigin.has('R2')).toBe(false);
      });

      it('a missing file keeps the stored roots', async () => {
        const { text } = await placedText('R', 'R2');
        const t = composer({});
        const session = sessionFromFile(JSON.parse(text), 'C:/p/casa.ifcx')!;
        await t.ctrl.opened(await sessionModel(session), session);
        expect(session.doc.composer.placements[0].roots).toEqual(['R', 'R2']);
      });

      it('relinking to a file with other roots updates the placement', async () => {
        const t = await placedDoc();
        await t.ctrl.place(t.layer.id, t.level.id);
        t.disk.set('C:/p/b.ifcx', withRoots('N1', 'N2'));
        expect(await t.ctrl.relink(t.layer.id, 'C:/p/b.ifcx')).toBe(true);
        expect(t.s.doc.composer.placements[0]).toMatchObject({ layerUri: './b.ifcx', roots: ['N1', 'N2'] });
        const n2 = t.models.at(-1)!.result.byOrigin.get('N2')![0];
        expect(n2.parent!.origin).toBe(t.s.doc.composer.placements[0].id);
        expect(t.models.at(-1)!.warnings).toEqual([]);
      });

      it('relinking updates every copy of the file', async () => {
        const t = await savedDoc({ 'C:/p/a.ifcx': withRoots('R') });
        await t.ctrl.linkFile('C:/p/a.ifcx');
        const s = t.ctrl.session!;
        const l = t.ctrl.composerLayers[0];
        s.addPlacement(l.uri, s.doc.levels[0].id, ['OLD']);
        s.addPlacement(l.uri, s.doc.levels[0].id, ['OLD']);
        t.disk.set('C:/p/b.ifcx', withRoots('N1'));
        expect(await t.ctrl.relink(l.id, 'C:/p/b.ifcx')).toBe(true);
        expect(s.doc.composer.placements.map((p) => p.roots)).toEqual([['N1'], ['N1']]);
      });
    });

    it('placing a disabled layer says it is disabled and keeps it disabled', async () => {
      const t = await placedDoc();
      await t.ctrl.setLayerEnabled(t.layer.id, false);
      t.deps.toast.mockClear();
      expect(await t.ctrl.place(t.layer.id, t.level.id)).toBe(true);
      expect(t.deps.toast).toHaveBeenCalledWith('a.ifcx is disabled; enable it to see it in the Stage', 'info');
      expect(t.ctrl.composerLayers[0].enabled).toBe(false);
      t.deps.toast.mockClear();
      await t.ctrl.setLayerEnabled(t.layer.id, true);
      await t.ctrl.place(t.layer.id, t.s.doc.ids.project);
      expect(t.deps.toast).not.toHaveBeenCalled();
    });

    it('read-only documents cannot place', async () => {
      const t = composer({ 'C:/p/a.ifcx': linked });
      await t.ctrl.opened(await sessionModel(openedSession('C:/p/casa.ifcx')), null);
      await t.ctrl.linkFile('C:/p/a.ifcx');
      expect(await t.ctrl.place(t.ctrl.composerLayers[0].id, 'x')).toBe(false);
    });
  });

  describe('placing under a node of another linked file', () => {
    const fileA = JSON.stringify({ data: [{ path: 'R', children: { c: 'C' } }, { path: 'C' }] });
    const fileB = JSON.stringify({
      data: [
        { path: 'S', children: { room: 'ROOM' } },
        { path: 'ROOM', attributes: { 'usd::xformop': { transform: translation([10, 20, 3]) } } },
      ],
    });

    async function twoFiles() {
      const t = await savedDoc({ 'C:/p/a.ifcx': fileA, 'C:/p/b.ifcx': fileB });
      await t.ctrl.linkFile('C:/p/a.ifcx');
      await t.ctrl.linkFile('C:/p/b.ifcx');
      const [a, b] = t.ctrl.composerLayers;
      const s = t.ctrl.session!;
      const node = (o: string) => t.models.at(-1)!.result.byOrigin.get(o)![0];
      return { ...t, a, b, s, node };
    }

    it('hangs from that node, follows it, keeps both sources in the Stage and survives reopening', async () => {
      const t = await twoFiles();
      expect(await t.ctrl.place(t.a.id, 'ROOM')).toBe(true);
      expect(t.s.doc.composer.placements[0]).toMatchObject({ parentId: 'ROOM', parentLayerUri: './b.ifcx' });
      expect(t.node('R').parent!.parent!.origin).toBe('ROOM');
      expect(worldOrigin(t.node('R'))).toEqual([10, 20, 3]);
      expect(t.models.at(-1)!.warnings).toEqual([]);
      // the root moves on its own (arrows or Move box on the furniture): edit in its layer
      const stage = t.stages.at(-1)!;
      expect(stage.sourceOf.get('ROOM')).toBe(t.b.id);
      expect(stage.sourceOf.get('R')).toBe(t.a.id);
      expect(t.fileRows()[0].placedInName).toBe('room'); // como se llama en el Stage
      // el cuadro Move parte del origen de ROOM
      const target: MoveTarget = { branch: 'document', origin: t.s.doc.composer.placements[0].id };
      const studio = {
        levels: () => t.s.doc.levels, wall: () => undefined, floor: () => undefined,
        placement: (id: string) => t.s.doc.composer.placements.find((p) => p.id === id),
        placementBase: t.ctrl.placementBase,
      };
      expect(targetPosition(target, studio)).toEqual([10, 20, 3]);
      expect(await t.ctrl.moveTo(target, [11, 20, 3])).toBe(true);
      expect(worldOrigin(t.node('R'))).toEqual([11, 20, 3]);
      // al reabrir
      const r = await reopen(await t.s.serialize(), { 'C:/p/a.ifcx': fileA, 'C:/p/b.ifcx': fileB });
      expect(r.ctrl.session!.doc.composer.placements[0]).toMatchObject({ parentId: 'ROOM', parentLayerUri: './b.ifcx', offset: [1, 0, 0] });
    });

    it('two files cannot be placed inside each other', async () => {
      const t = await twoFiles();
      expect(await t.ctrl.place(t.a.id, 'ROOM')).toBe(true);
      t.deps.toast.mockClear();
      expect(await t.ctrl.place(t.b.id, 'C')).toBe(false);
      expect(t.deps.toast).toHaveBeenCalledWith('b.ifcx cannot be placed inside itself', 'info');
      expect(t.s.doc.composer.placements).toHaveLength(1);
    });

    it('removing or disabling the parent file puts the placement under the project', async () => {
      const t = await twoFiles();
      await t.ctrl.place(t.a.id, 'ROOM');
      await t.ctrl.setLayerEnabled(t.b.id, false);
      expect(t.node('R').parent!.parent!.origin).toBe(t.s.doc.ids.project); // dropping it again at (7, 8): the furniture stays there, not 5 m further
      expect(t.s.doc.composer.placements[0].parentId).toBe('ROOM'); // lo guardado no cambia
      await t.ctrl.setLayerEnabled(t.b.id, true);
      expect(t.node('R').parent!.parent!.origin).toBe('ROOM');
      expect(await t.ctrl.unlink(t.b.id)).toBe(true);
      expect(t.s.doc.composer.placements[0]).toEqual(expect.objectContaining({ parentId: t.s.doc.ids.project }));
      expect(t.s.doc.composer.placements[0].parentLayerUri).toBeUndefined();
      expect(t.node('R').parent!.parent!.origin).toBe(t.s.doc.ids.project);
    });

    it('Save As keeps the parent file uri pointing at the same file', async () => {
      const t = await twoFiles();
      await t.ctrl.place(t.a.id, 'ROOM');
      t.deps.pickSavePath.mockResolvedValueOnce('C:/p/sub/casa2.ifcx');
      expect(await t.ctrl.saveAs()).toBe(true);
      expect(t.s.doc.composer.placements[0]).toMatchObject({ layerUri: '../a.ifcx', parentLayerUri: '../b.ifcx' });
    });
  });

  describe('placing from the library', () => {
    const linked = JSON.stringify({ data: [{ path: 'R', children: { c: 'C' } }, { path: 'C' }] });

    it('links the file, places it under the level and moves it to the drop point', async () => {
      const t = await savedDoc({ 'C:/p/lib/puerta.ifcx': linked });
      const s = t.ctrl.session!;
      const level = s.doc.levels[0];
      await t.ctrl.setLevelElevation(level.id, 3);
      expect(await t.ctrl.placeFile('C:/p/lib/puerta.ifcx', level.id, [4, 5])).toBe(true);
      expect(t.ctrl.composerLayers.map((l) => l.uri)).toEqual(['./lib/puerta.ifcx']);
      expect(s.doc.composer.placements).toEqual([
        { id: expect.any(String), layerUri: './lib/puerta.ifcx', parentId: level.id, roots: ['R'], offset: [4, 5, 0] },
      ]);
      expect(worldOrigin(t.models.at(-1)!.result.byOrigin.get('R')![0])).toEqual([4, 5, 3]);
      expect(s.dirty).toBe(true);
    });

    it('the visible model lands on the drop point even if its root was moved by itself', async () => {
      const t = await savedDoc({ 'C:/p/lib/puerta.ifcx': linked });
      const s = t.ctrl.session!;
      const level = s.doc.levels[0];
      await t.ctrl.placeFile('C:/p/lib/puerta.ifcx', level.id, [1, 1]);
      // in plan where it was dropped, at the elevation of the storey
      const r = t.models.at(-1)!.result;
      const root = r.byOrigin.get('R')![0];
      await t.ctrl.moveBy({ branch: t.ctrl.composerLayers[0].id, path: editPath(root, r), node: root }, [5, 0, 0]);
      expect(worldOrigin(t.models.at(-1)!.result.byOrigin.get('R')![0])).toEqual([6, 1, 0]);
      // the project of the file also works
      expect(await t.ctrl.placeFile('C:/p/lib/puerta.ifcx', level.id, [7, 8])).toBe(true);
      expect(worldOrigin(t.models.at(-1)!.result.byOrigin.get('R')![0])).toEqual([7, 8, 0]);
    });

    it('dropping an already linked file again moves it instead of linking it twice', async () => {
      const t = await savedDoc({ 'C:/p/lib/puerta.ifcx': linked });
      const s = t.ctrl.session!;
      await t.ctrl.placeFile('C:/p/lib/puerta.ifcx', s.doc.levels[0].id, [1, 1]);
      t.deps.toast.mockClear();
      expect(await t.ctrl.placeFile('C:\\p\\lib\\puerta.ifcx', s.doc.ids.project, [7, 8])).toBe(true);
      expect(t.ctrl.composerLayers).toHaveLength(1);
      expect(t.deps.toast).not.toHaveBeenCalled(); // sin «already linked»
      expect(s.doc.composer.placements).toHaveLength(1);
      expect(s.doc.composer.placements[0]).toMatchObject({ parentId: s.doc.ids.project, offset: [7, 8, 0] });
    });

    it('without a drop point the offset is kept; an unreadable file is not placed', async () => {
      const t = await savedDoc({ 'C:/p/a.ifcx': linked });
      const s = t.ctrl.session!;
      expect(await t.ctrl.placeFile('C:/p/a.ifcx', s.doc.ids.project)).toBe(true);
      expect(s.doc.composer.placements[0].offset).toEqual([0, 0, 0]);
      expect(await t.ctrl.placeFile('C:/p/nope.ifcx', s.doc.ids.project)).toBe(false);
      expect(t.ctrl.composerLayers).toHaveLength(1);
    });

    it('a read-only document only links it', async () => {
      const t = composer({ 'C:/p/a.ifcx': linked });
      await t.ctrl.opened(await sessionModel(openedSession('C:/p/casa.ifcx')), null);
      expect(await t.ctrl.placeFile('C:/p/a.ifcx', 'x', [1, 1])).toBe(true);
      expect(t.ctrl.composerLayers).toHaveLength(1);
    });
  });
});

describe('DocumentController: an IFCx that is not from Studio', () => {
  const converted = () => JSON.stringify({
    header: { id: 'p1', ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'ifc2ifcx', timestamp: 't' },
    imports: [],
    schemas: {},
    data: [
      { path: 'P', children: { s: 'S' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' } } },
      { path: 'S', children: { l1: 'L1', l2: 'L2' } },
      { path: 'L1', children: { w: 'W' } },
      { path: 'L2', attributes: { 'usd::xformop': { transform: translation([0, 0, 3]) } } },
      { path: 'W', attributes: { 'bsi::ifc::class': { code: 'IfcWall' }, 'bsi::ifc::prop::Name': 'Wall A' } },
    ],
  });
  const door = JSON.stringify({ data: [{ path: 'D', children: { leaf: 'DL' } }, { path: 'DL' }] });

  /** Abre el archivo convertido como lo hace main.ts: openPath y opened(). */
  async function openConverted(disk: Record<string, string> = {}) {
    const files = new Map(Object.entries({ 'C:/p/Project1.ifcx': converted(), 'C:/p/lib/door.ifcx': door, ...disk }));
    const readText = vi.fn(async (p: string) => {
      const t = files.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    });
    tauri.invoke.mockImplementation(async (cmd: string, args: { path: string; contents: string }) => {
      if (cmd === 'read_text_file') return readText(args.path);
      if (cmd === 'write_text_file') files.set(args.path, args.contents);
    });
    const t = setup({ buildModel: sessionModel, readText });
    const stages: StageData[] = [];
    const models: LoadedModel[] = [];
    (t.ws as DocWorkspace).setComposer = (_r, stage) => void stages.push(stage);
    const update = t.ws.updateModel.bind(t.ws);
    t.ws.updateModel = (m) => {
      models.push(m);
      update(m);
    };
    const editable: [boolean, boolean | undefined][] = [];
    t.ws.setEditable = (on: boolean, tools?: boolean) => void editable.push([on, tools]);
    const { model, session } = await openPath('C:/p/Project1.ifcx');
    const shown = await t.ctrl.opened(model, session);
    models.push(shown);
    const at = (p: string) => models.at(-1)!.result.byPath.get(p);
    const target = (p: string): MoveTarget => {
      const r = models.at(-1)!.result;
      const node = r.byPath.get(p)!;
      return { branch: stages.at(-1)!.sourceOf.get(node.origin)!, path: editPath(node, r), node };
    };
    return { ...t, files, stages, models, editable, at, target };
  }

  it('opens editable without Studio drawing tools; its elements are not document elements', async () => {
    const t = await openConverted();
    expect(t.ctrl.session).toBeInstanceOf(ForeignSession);
    expect(t.editable.at(-1)).toEqual([true, false]);
    expect(worldOrigin(t.at('/P/s/l1/w')!)).toEqual([0, 0, 0]);
    expect(t.stages.at(-1)!.sourceOf.get('W')).toBe('base');
    expect(t.stages.at(-1)!.colors.get('base')).toBe(DOCUMENT_COLOR);
    expect(t.ctrl.composerLayers).toEqual([]); // la base no sale en Layer
  });

  it('moving, relocating and editing a property mark it dirty; Save writes them into the file itself', async () => {
    const t = await openConverted();
    expect(await t.ctrl.moveBy(t.target('/P/s/l1/w'), [1, 2, 0])).toBe(true);
    expect(t.ctrl.session!.dirty).toBe(true);
    expect(worldOrigin(t.at('/P/s/l1/w')!)).toEqual([1, 2, 0]);
    expect(t.stages.at(-1)!.marks.get('W')).toEqual(['moved']);
    expect(await t.ctrl.reparent('base', 'W', 'L2')).toBe(true);
    expect(worldOrigin(t.at('/P/s/l2/w')!).map((v) => +v.toFixed(9))).toEqual([1, 2, 0]); // conserva su sitio
    expect(await t.ctrl.setLinkedAttr('base', t.at('/P/s/l2/w')!, 'bsi::ifc::prop::Name', 'Wall B')).toBe(true);

    expect(await t.ctrl.save()).toBe(true);
    expect(t.deps.pickSavePath).not.toHaveBeenCalled(); // sobrescribe el mismo archivo
    expect(t.ctrl.session!.dirty).toBe(false);
    const saved = JSON.parse(t.files.get('C:/p/Project1.ifcx')!);
    expect(saved.header.author).toBe('ifc2ifcx');
    const byPath = (p: string) => saved.data.filter((n: { path: string }) => n.path === p).at(-1);
    expect(byPath('L1').children).toEqual({});
    expect(byPath('L2').children).toEqual({ w: 'W' });
    expect(byPath('W').attributes['bsi::ifc::prop::Name']).toBe('Wall B');
    // ya no hay ediciones pendientes, y el modelo sigue igual
    expect(t.stages.at(-1)!.marks.get('W')).toBeUndefined();
    expect(worldOrigin(t.at('/P/s/l2/w')!).map((v) => +v.toFixed(9))).toEqual([1, 2, 0]);

    // reabierto, es el mismo modelo, sin ediciones pendientes
    const r = await openConverted({ 'C:/p/Project1.ifcx': t.files.get('C:/p/Project1.ifcx')! });
    expect(worldOrigin(r.at('/P/s/l2/w')!).map((v) => +v.toFixed(9))).toEqual([1, 2, 0]);
    expect(r.at('/P/s/l1/w')).toBeUndefined();
    expect(r.ctrl.session!.dirty).toBe(false);
  });

  it('a library file dropped on a node of the file hangs from it and is still placed after reopening', async () => {
    const t = await openConverted();
    expect(await t.ctrl.placeFile('C:/p/lib/door.ifcx', 'L2', [4, 5])).toBe(true);
    const d = t.at('/P/s/l2/' + t.ctrl.session!.doc.composer.placements[0].id + '/D');
    expect(d).toBeDefined();
    expect(worldOrigin(d!)).toEqual([4, 5, 3]); // there is no more
    expect(t.stages.at(-1)!.sourceOf.get('L2')).toBe('base'); // el storey sigue siendo del archivo
    // the whole placement at once
    expect(await t.ctrl.place(t.ctrl.composerLayers[0].id, 'P')).toBe(true);
    expect(await t.ctrl.place(t.ctrl.composerLayers[0].id, 'L2')).toBe(true);
    expect(await t.ctrl.save()).toBe(true);
    const saved = JSON.parse(t.files.get('C:/p/Project1.ifcx')!);
    expect(saved.imports.map((i: { uri: string }) => i.uri)).toContain('./lib/door.ifcx');

    const r = await openConverted({ 'C:/p/Project1.ifcx': t.files.get('C:/p/Project1.ifcx')! });
    expect(r.ctrl.composerLayers.map((l) => l.name)).toEqual(['door.ifcx']);
    const p = r.ctrl.session!.doc.composer.placements[0];
    expect(worldOrigin(r.at(`/P/s/l2/${p.id}/D`)!)).toEqual([4, 5, 3]);
    expect(r.models.at(-1)!.warnings.filter((w) => !isSchemaWarning(w))).toEqual([]);
    expect(r.ctrl.session!.dirty).toBe(false);
  });

  it('Studio drawing does not apply to it', async () => {
    const t = await openConverted();
    t.ctrl.editor.addWall([0, 0], [4, 0], 'L1');
    await t.ctrl.idle();
    expect(t.ctrl.session!.dirty).toBe(false);
    expect(await t.ctrl.addLevel()).toBeNull();
    expect(t.ctrl.session!.doc.levels).toEqual([]);
  });
});

describe('DocumentController: undo and redo', () => {
  /** Documento de Studio guardado, con el modelo real y el historial que avisa. */
  async function doc(files: Record<string, string> = {}) {
    const disk = new Map(Object.entries(files));
    const history: { undo: string | null; redo: string | null }[] = [];
    const t = setup({
      buildModel: sessionModel,
      readText: vi.fn(async (p: string) => {
        const x = disk.get(p);
        if (x === undefined) throw new Error(`not found: ${p}`);
        return x;
      }),
      onHistory: (h) => void history.push(h),
    });
    const models: LoadedModel[] = [];
    const update = t.ws.updateModel.bind(t.ws);
    t.ws.updateModel = (m) => {
      models.push(m);
      update(m);
    };
    await t.ctrl.newDocument();
    await t.ctrl.session!.saveTo('C:/p/casa.ifcx');
    const s = t.ctrl.session!;
    return { ...t, s, history, models, level: s.doc.levels[0] };
  }

  it('undoes and redoes Studio edits in order, with their labels', async () => {
    const t = await doc();
    expect(t.ctrl.history).toEqual({ undo: null, redo: null });
    t.ctrl.editor.addWall([0, 0], [4, 0], t.level.id);
    await t.ctrl.idle();
    expect(await t.ctrl.setLevelElevation(t.level.id, 3)).toBe(true);
    expect(t.ctrl.history).toEqual({ undo: 'Change Level Elevation', redo: null });
    expect(t.history.at(-1)).toEqual({ undo: 'Change Level Elevation', redo: null });

    expect(await t.ctrl.undo()).toBe(true);
    expect(t.s.doc.levels[0].elevation).toBe(0);
    expect(t.s.doc.walls).toHaveLength(1);
    expect(t.ctrl.history).toEqual({ undo: 'Add Wall', redo: 'Change Level Elevation' });
    expect(await t.ctrl.undo()).toBe(true);
    expect(t.s.doc.walls).toHaveLength(0);
    expect(await t.ctrl.undo()).toBe(false); // there is something to undo
    expect(await t.ctrl.redo()).toBe(true);
    expect(await t.ctrl.redo()).toBe(true);
    expect(t.s.doc.walls).toHaveLength(1);
    expect(t.s.doc.levels[0].elevation).toBe(3);
    expect(await t.ctrl.redo()).toBe(false);
    // el modelo mostrado sigue al documento
    expect(t.models.at(-1)!.result.byOrigin.has(t.s.doc.walls[0].id)).toBe(true);
  });

  it('a new change after undo clears redo; a change that changes nothing is not a step', async () => {
    const t = await doc();
    await t.ctrl.setLevelElevation(t.level.id, 3);
    await t.ctrl.undo();
    expect(t.ctrl.history.redo).toBe('Change Level Elevation');
    await t.ctrl.renameLevel(t.level.id, 'Ground');
    expect(t.ctrl.history).toEqual({ undo: 'Rename Level', redo: null });
    await t.ctrl.renameLevel(t.level.id, 'Ground'); // el mismo nombre
    await t.ctrl.undo();
    expect(t.s.doc.levels[0].name).toBe('Level 1');
    expect(t.ctrl.history.undo).toBeNull();
  });

  it('the * follows the saved state: undoing back to it clears it, redoing sets it again', async () => {
    const t = await doc();
    await t.ctrl.setLevelElevation(t.level.id, 3);
    expect(t.s.dirty).toBe(true);
    await t.ctrl.undo();
    expect(t.s.dirty).toBe(false);
    expect(t.ws.last('setDirty')).toEqual(['setDirty', false]);
    await t.ctrl.redo();
    expect(t.s.dirty).toBe(true);
    // tras guardar, deshacer deja el documento con cambios respecto a lo guardado
    expect(await t.ctrl.save()).toBe(true);
    expect(t.s.dirty).toBe(false);
    await t.ctrl.undo();
    expect(t.s.dirty).toBe(true);
    expect(t.s.doc.levels[0].elevation).toBe(0);
  });

  it('stack changes and linked edits undo too; a library drop is one step', async () => {
    const lib = JSON.stringify({ data: [{ path: 'R', children: { c: 'C' } }, { path: 'C' }] });
    const t = await doc({ 'C:/p/lib/door.ifcx': lib });
    expect(await t.ctrl.placeFile('C:/p/lib/door.ifcx', t.level.id, [4, 5])).toBe(true);
    expect(t.ctrl.history).toEqual({ undo: 'Place door.ifcx', redo: null });
    const layer = t.ctrl.composerLayers[0];
    await t.ctrl.setLayerEnabled(layer.id, false);
    expect(t.ctrl.history.undo).toBe('Disable Layer');
    await t.ctrl.undo();
    expect(t.ctrl.composerLayers[0].enabled).toBe(true);
    await t.ctrl.undo(); // opening another model with the lock on does not return editing until unlocked
    expect(t.ctrl.composerLayers).toEqual([]);
    expect(t.s.doc.composer).toEqual({ layers: [], placements: [] });
    expect(t.s.dirty).toBe(false);
    await t.ctrl.redo();
    expect(t.ctrl.composerLayers.map((l) => l.name)).toEqual(['door.ifcx']);
    expect(t.s.doc.composer.placements[0].offset).toEqual([4, 5, 0]);
    expect(worldOrigin(t.models.at(-1)!.result.byOrigin.get('R')![0])).toEqual([4, 5, 0]);
  });

  it('opening, creating or closing a document clears the history', async () => {
    const t = await doc();
    await t.ctrl.setLevelElevation(t.level.id, 3);
    await t.ctrl.newDocument();
    expect(t.ctrl.history).toEqual({ undo: null, redo: null });
    expect(t.history.at(-1)).toEqual({ undo: null, redo: null });
    expect(await t.ctrl.undo()).toBe(false);
    t.ctrl.closed();
    expect(await t.ctrl.undo()).toBe(false);
  });

  it('in an IFCx that is not from Studio, undo works across a save (the base goes back too)', async () => {
    const converted = JSON.stringify({
      header: { id: 'p', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' }, imports: [], schemas: {},
      data: [{ path: 'P', children: { w: 'W' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' } } }, { path: 'W' }],
    });
    const disk = new Map([['C:/p/a.ifcx', converted]]);
    tauri.invoke.mockImplementation(async (cmd: string, a: { path: string; contents: string }) => {
      if (cmd === 'read_text_file') return disk.get(a.path);
      if (cmd === 'write_text_file') disk.set(a.path, a.contents);
    });
    const t = setup({ buildModel: sessionModel, readText: async (p) => disk.get(p)! });
    const stages: StageData[] = [];
    let shown: LoadedModel | null = null;
    (t.ws as DocWorkspace).setComposer = (_r, st) => void stages.push(st);
    t.ws.updateModel = (m) => void (shown = m);
    const { model, session } = await openPath('C:/p/a.ifcx');
    shown = await t.ctrl.opened(model, session);
    const node = shown!.result.byPath.get('/P/w')!;
    await t.ctrl.moveBy({ branch: 'base', path: editPath(node, shown!.result), node }, [1, 0, 0]);
    expect(await t.ctrl.save()).toBe(true);
    expect(await t.ctrl.undo()).toBe(true);
    expect(t.ctrl.session!.dirty).toBe(true);
    expect(worldOrigin(shown!.result.byPath.get('/P/w')!)).toEqual([0, 0, 0]);
    expect(await t.ctrl.save()).toBe(true);
    const saved = JSON.parse(disk.get('C:/p/a.ifcx')!);
    expect(saved.data.find((n: { path: string }) => n.path === 'W').attributes?.['usd::xformop']).toBeUndefined();
  });
});

describe('DocumentController: bloqueo del usuario durante un turno del Asistente', () => {
  it('bloqueado, no deshace, no edita ni guarda, y avisa cada vez', async () => {
    const onLocked = vi.fn();
    const { ctrl, ws } = setup({ onLocked });
    await ctrl.newDocument();
    expect(await ctrl.addLevel()).not.toBeNull(); // without a document, unlocking does not enable editing of anything
    const niveles = ctrl.session!.doc.levels.length;
    ws.calls = [];
    ctrl.setUserLock(true);
    expect(ws.last('setEditable')).toEqual(['setEditable', false]);
    expect(await ctrl.undo()).toBe(false);
    expect(await ctrl.addLevel()).toBeNull();
    expect(await ctrl.save()).toBe(false);
    expect(ctrl.session!.doc.levels.length).toBe(niveles);
    expect(onLocked).toHaveBeenCalledTimes(3);
  });

  it('al desbloquear vuelve lo editable y se puede deshacer lo hecho antes', async () => {
    const { ctrl, ws } = setup();
    await ctrl.newDocument();
    await ctrl.addLevel();
    ctrl.setUserLock(true);
    ctrl.setUserLock(false);
    expect(ws.last('setEditable')).toEqual(['setEditable', true]);
    expect(await ctrl.undo()).toBe(true);
  });

  it('there is something to undo', () => {
    const { ctrl, ws } = setup();
    ctrl.opened(fakeModel('a.ifcx'), openedSession());
    ctrl.setUserLock(true);
    ws.calls = [];
    ctrl.opened(fakeModel('b.ifcx'), openedSession('C:/a/b.ifcx'));
    expect(ws.last('setEditable')).toEqual(['setEditable', false]);
    ctrl.setUserLock(false);
    expect(ws.last('setEditable')).toEqual(['setEditable', true]);
  });

  it('the file changed outside: the previous history is not valid', () => {
    const { ctrl, ws } = setup();
    ctrl.setUserLock(true);
    ws.calls = [];
    ctrl.setUserLock(false);
    expect(ws.named('setEditable')).toEqual([]);
  });
});

describe('DocumentController: recargar el documento tras un cambio en disco', () => {
  it('con keepView reconstruye sin cerrar vistas (updateModel) y olvida el historial', async () => {
    const { ctrl, ws } = setup();
    ctrl.opened(fakeModel('a.ifcx', 'C:/a/a.ifcx'), openedSession('C:/a/a.ifcx'));
    await ctrl.addLevel(); // a writeText that throws warns of the error
    ws.calls = [];
    await ctrl.opened(fakeModel('a.ifcx', 'C:/a/a.ifcx'), openedSession('C:/a/a.ifcx'), { keepView: true });
    expect(ws.named('setModel')).toEqual([]);
    expect(ws.last('updateModel')).toEqual(['updateModel', 'a.ifcx', 'C:/a/a.ifcx']);
    expect(ws.last('setEditable')).toEqual(['setEditable', true]);
    expect(await ctrl.undo()).toBe(false); // a writeText that rejects warns of the error
  });
});


describe('DocumentController: escaleras en el cuadro Move', () => {
  const none = { x: false, y: false, z: false };
  const one: [number, number, number] = [1, 1, 1];
  const setup = () => {
    const s = newSession();
    applyBuild(s.doc, parseBuildRequest({
      levels: [
        { name: 'Level 1', elevation: 0, layout: 'a' },
        { name: 'Level 2', elevation: 3, layout: 'a' },
      ],
      layouts: {
        a: {
          walls: [
            { from: [0, 0], to: [10, 0], thickness: 0.3 },
            { from: [10, 0], to: [10, 8], thickness: 0.3 },
            { from: [10, 8], to: [0, 8], thickness: 0.3 },
            { from: [0, 8], to: [0, 0], thickness: 0.3 },
          ],
          floors: [[[0, 0], [10, 0], [10, 8], [0, 8]]],
        },
      },
    }));
    s.doc.stairs.push({
      id: 's', baseLevelId: s.doc.levels[0].id, topLevelId: s.doc.levels[1].id,
      shape: 'u', origin: [3, 3], angle: 0, width: 1.1, turn: 'left',
    });
    const studio: MoveStudio = {
      levels: () => s.doc.levels,
      wall: (id) => s.doc.walls.find((w) => w.id === id),
      floor: (id) => s.doc.floors.find((f) => f.id === id),
      stair: (id) => s.doc.stairs.find((x) => x.id === id || id.startsWith(`${x.id}-`)),
    };
    return { s, studio };
  };

  it('an empty file carries the name and nothing else', () => {
    const { studio } = setup();
    const target: MoveTarget = { branch: 'document', origin: 's' };
    expect(allowedAxes(target, studio)).toEqual({ x: true, y: true, z: false });
    expect(targetPosition(target, studio)).toEqual([3, 3, 0]);
    expect(rotScaleAxes(target, studio)).toEqual({ rot: none, scale: none });
    expect(targetRotScale(target, studio)).toEqual({ rot: [0, 0, 0], scale: one });
  });

  it('un sub-id resuelve a la escalera entera', () => {
    const { studio } = setup();
    const target: MoveTarget = { branch: 'document', origin: 's-f2' };
    expect(allowedAxes(target, studio)).toEqual({ x: true, y: true, z: false });
    expect(targetPosition(target, studio)).toEqual([3, 3, 0]);
  });
});
