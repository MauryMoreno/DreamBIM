// Characterization tests of the undo history of DocumentController. They pin the behavior before the controller
// is split into services and must stay green through that split.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionModel } from '../src/modeling/session';
import type { IfcxFile } from '../src/ifcx/types';

class Ws implements DocWorkspace {
  setModel() {}
  updateModel() {}
  setEditable() {}
  setDirty() {}
  showPlan() {}
}

const LIB_PATH = 'C:/p/lib.ifcx';
const LIB: IfcxFile = {
  header: { id: 'lib', ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'a', timestamp: '2026-01-01T00:00:00Z' },
  imports: [],
  schemas: {},
  data: [{ path: 'lib-a', attributes: {} }],
};

async function openDocument() {
  const toast = vi.fn();
  const deps: ControllerDeps = {
    ws: new Ws(),
    pickSavePath: async () => 'C:/p/casa.ifcx',
    askSaveChanges: async () => 'discard',
    toast,
    remember: async () => {},
    buildModel: sessionModel,
    readText: async (p: string) => {
      if (p === LIB_PATH) return JSON.stringify(LIB);
      throw new Error(`not found: ${p}`);
    },
    confirm: async () => true,
  };
  const ctrl = new DocumentController(deps);
  await ctrl.newDocument();
  await ctrl.session!.saveTo('C:/p/casa.ifcx');
  const session = ctrl.session!;
  return { ctrl, session, toast, level: session.doc.levels[0] };
}

const undoAll = async (ctrl: DocumentController): Promise<number> => {
  let n = 0;
  while (await ctrl.undo()) n++;
  return n;
};

beforeEach(() =>
  tauri.invoke.mockImplementation(async (cmd: string, args?: { path?: string }) =>
    cmd === 'read_text_file' && args?.path === LIB_PATH ? JSON.stringify(LIB) : undefined,
  ),
);

describe('DocumentController history (characterization)', () => {
  it('a rejected edit adds no undo step', async () => {
    const t = await openDocument();
    expect(await t.ctrl.renameLevel(t.level.id, '')).toBe(false); // 'A level needs a name'
    expect(t.ctrl.history).toEqual({ undo: null, redo: null });
    expect(await t.ctrl.setLevelElevation(t.level.id, 3)).toBe(true);
    expect(await t.ctrl.renameLevel(t.level.id, '')).toBe(false);
    expect(t.ctrl.history).toEqual({ undo: 'Change Level Elevation', redo: null });
  });

  it('an edit that changes nothing adds no undo step', async () => {
    const t = await openDocument();
    expect(await t.ctrl.setLevelElevation(t.level.id, t.level.elevation)).toBe(true);
    expect(t.ctrl.history).toEqual({ undo: null, redo: null });
  });

  it('undo then redo restores exactly the same document', async () => {
    const t = await openDocument();
    const before = JSON.stringify(t.session.doc);
    await t.ctrl.setLevelElevation(t.level.id, 3);
    await t.ctrl.renameLevel(t.level.id, 'Ground');
    const after = JSON.stringify(t.session.doc);
    expect(after).not.toBe(before);

    expect(await undoAll(t.ctrl)).toBe(2);
    expect(JSON.stringify(t.session.doc)).toBe(before);
    expect(await t.ctrl.redo()).toBe(true);
    expect(await t.ctrl.redo()).toBe(true);
    expect(JSON.stringify(t.session.doc)).toBe(after);
  });

  it('the history keeps at most 100 steps', async () => {
    const t = await openDocument();
    for (let i = 1; i <= 105; i++) await t.ctrl.setLevelElevation(t.level.id, i);
    expect(await undoAll(t.ctrl)).toBe(100);
    expect(t.session.doc.levels[0].elevation).toBe(5); // the 5 oldest steps fell off the end
  });

  it('undo across a library file first touched after the snapshot restores its original content', async () => {
    const t = await openDocument();
    await t.ctrl.setLevelElevation(t.level.id, 3); // snapshot taken before the library is known to the session
    const added = { path: 'lib-b', attributes: {} };
    expect(await t.ctrl.changeImportedFile(LIB_PATH, 'Edit Library', (f) => ({ ...f, data: [...f.data, added] }))).toBe(true);

    const peek = async (): Promise<IfcxFile> => {
      let seen: IfcxFile | null = null;
      await t.ctrl.changeImportedFile(LIB_PATH, 'Peek', (f) => {
        seen = f;
        return 'just looking';
      });
      return seen!;
    };
    expect((await peek()).data.map((n) => n.path)).toEqual(['lib-a', 'lib-b']);
    expect(await undoAll(t.ctrl)).toBe(2);
    expect((await peek()).data.map((n) => n.path)).toEqual(['lib-a']);
    await t.ctrl.redo();
    await t.ctrl.redo();
    expect((await peek()).data.map((n) => n.path)).toEqual(['lib-a', 'lib-b']);
  });
});
