// A document saved before this test must open and save again without changing what is written:
// same files, same bytes. It also pins that legacy materials and classification sidecars migrate
// once and are not applied again after the next save.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionFromFile, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { editPath } from '../src/composer/edits';
import { K_ASSIGN_21 } from '../src/classification/state';
import { K_DIFFUSE, K_MATERIAL } from '../src/materials/nodes';
import { buildSystem, systemFromFile, type ClassSystemInfo, type ClassTableRef } from '../src/classification/system';
import type { ScheduleState, Task } from '../src/schedule/state';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel(m: LoadedModel | null) { if (m) this.models.push(m); }
  updateModel(m: LoadedModel) { this.models.push(m); }
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

const MODEL = 'C:/p/casa.ifcx';
const COLORS = 'C:/p/casa.colors.ifcx';
const CRONO = 'C:/p/casa.cronograma.ifcx';
const LEGACY_MATERIALS = 'C:/p/casa.materials.ifcx';
const LEGACY_CLASSIFICATION = 'C:/p/casa.classification.ifcx';
const LIB = 'C:/p/lib.ifcx';
const TABLE = 'C:/p/omniclass-21.ifcx';
const SHELL = '21-02 00 00';
const INTERIORS = '21-03 00 00';
const INFO: ClassSystemInfo = { id: 'omniclass-21', name: 'OmniClass', table: '21', title: 'Elements', edition: '2012', starter: false };
const TASK: Task = { id: 'tk-1', name: 'Walls', phase: 'Structure', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [] };
const RED = { color: '#ff0000', opacity: 1 };

const header = (id: string) => ({ id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' });

const libText = JSON.stringify({
  header: header('lib'),
  imports: [],
  schemas: {},
  data: [{ path: 'M', attributes: { [K_MATERIAL]: { code: 'Concrete' }, [K_DIFFUSE]: [0.5, 0.5, 0.5] } }],
});
const tableFile = () => buildSystem(INFO, [{ code: SHELL, title: 'Shell' }, { code: INTERIORS, title: 'Interiors' }]);
const tableText = () => JSON.stringify(tableFile());
const tableRef = (): ClassTableRef => ({ path: TABLE, system: systemFromFile(tableFile(), TABLE)! });

interface Disk {
  text: Map<string, string>;
  writes: [string, string][];
}

function fakeDisk(initial: Record<string, string>): Disk {
  const disk: Disk = { text: new Map(Object.entries(initial)), writes: [] };
  tauri.invoke.mockImplementation(async (cmd: string, a: { path: string; contents: string }) => {
    if (cmd === 'read_text_file') {
      const t = disk.text.get(a.path);
      if (t === undefined) throw new Error(`not found: ${a.path}`);
      return t;
    }
    if (cmd === 'write_text_file') {
      disk.text.set(a.path, a.contents);
      disk.writes.push([a.path, a.contents]);
    }
  });
  return disk;
}

function makeController(disk: Disk, pick = MODEL) {
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => pick),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (p: string) => {
      const t = disk.text.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    }),
    writeText: vi.fn(async (p: string, t: string) => { disk.text.set(p, t); disk.writes.push([p, t]); }),
    exists: vi.fn(async (p: string) => disk.text.has(p)),
    confirm: vi.fn(async () => true),
    classTables: vi.fn(async () => [tableRef()]),
  } satisfies ControllerDeps;
  return { ctrl: new DocumentController(deps), ws, deps };
}

const wallPath = (ws: FakeWs): string => {
  const model = ws.models.at(-1)!;
  const node = [...model.result.byPath.values()].find(
    (n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall',
  )!;
  return editPath(node, model.result);
};

/** Builds a document with a wall, a floor, a linked library and table, a material, a classification, a task and a colour. */
async function buildDocument(disk: Disk) {
  const { ctrl, ws, deps } = makeController(disk);
  await ctrl.newDocument();
  const level = ctrl.session!.doc.levels[0].id;
  ctrl.editor.addWall([0, 0], [4, 0], level);
  expect(await ctrl.editor.addFloor([[0, -2], [4, -2], [4, 0], [0, 0]], level)).not.toBeNull();
  await ctrl.idle();
  expect(await ctrl.linkFile(LIB)).toBe(true);
  expect(await ctrl.linkFile(TABLE)).toBe(true);
  const wall = wallPath(ws);
  expect(await ctrl.classify([wall], SHELL)).toBe(true);
  expect(await ctrl.assignMaterial([wall], 'Concrete')).toBe(true);
  expect(await ctrl.save()).toBe(true); // a schedule or a colour needs the document to live on disk
  expect(await ctrl.changeSchedule('New Task', (s: ScheduleState) => ({ ...s, tasks: [TASK] }))).toBe(true);
  expect(await ctrl.setColors([wall], RED, 'Set Color')).toBe(true);
  return { ctrl, ws, deps, wall };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  tauri.invoke.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('document round trip', () => {
  it('saving, reopening and saving again writes the same files with the same bytes', async () => {
    const disk = fakeDisk({ [LIB]: libText, [TABLE]: tableText() });
    const first = await buildDocument(disk);
    disk.writes = [];
    expect(await first.ctrl.save()).toBe(true);
    const saved = new Map(disk.text);
    expect([...saved.keys()].sort()).toEqual([COLORS, CRONO, LIB, MODEL, TABLE].sort());

    const session = sessionFromFile(JSON.parse(disk.text.get(MODEL)!), MODEL)!;
    const model = await sessionModel(session);
    const second = makeController(disk);
    await second.ctrl.opened(model, session);
    disk.writes = [];
    expect(await second.ctrl.saveAs()).toBe(true);
    expect(new Map(disk.text)).toEqual(saved);
    for (const [path, bytes] of disk.writes) expect(saved.get(path)).toBe(bytes);
  });

  it('opens a model with legacy .materials.ifcx and .classification.ifcx and migrates them once', async () => {
    const first = fakeDisk({ [LIB]: libText, [TABLE]: tableText() });
    const base = await buildDocument(first);
    expect(await base.ctrl.save()).toBe(true);
    const modelText = first.text.get(MODEL)!;

    const legacyMaterials = JSON.stringify({
      header: header('studio-materials/casa'),
      imports: [],
      schemas: {},
      data: [
        { path: 'studio-material-Concrete', attributes: { 'studio::material::def': { name: 'Concrete', code: 'Concrete', color: '#8a8a8a', opacity: 1 } } },
        { path: base.wall, attributes: { [K_MATERIAL]: { code: 'Glass' } } },
      ],
    });
    const legacyClassification = JSON.stringify({
      header: header('studio-classification/casa'),
      imports: [],
      schemas: {},
      data: [{ path: base.wall, attributes: { [K_ASSIGN_21]: { code: INTERIORS, title: 'Interiors' } } }],
    });

    const disk = fakeDisk({
      [MODEL]: modelText,
      [LIB]: libText,
      [TABLE]: tableText(),
      [LEGACY_MATERIALS]: legacyMaterials,
      [LEGACY_CLASSIFICATION]: legacyClassification,
    });
    const legacy = makeController(disk);
    const session = sessionFromFile(JSON.parse(modelText), MODEL)!;
    await legacy.ctrl.opened(await sessionModel(session), session);
    expect(legacy.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Converted 1 material assignment'), 'info');
    expect(legacy.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Converted 1 classification assignment'), 'info');

    expect(await legacy.ctrl.save()).toBe(true);
    expect(JSON.parse(disk.text.get(LEGACY_MATERIALS)!).data).toEqual([]);
    expect(JSON.parse(disk.text.get(LEGACY_CLASSIFICATION)!).data).toEqual([]);

    const again = makeController(disk);
    const reopened = sessionFromFile(JSON.parse(disk.text.get(MODEL)!), MODEL)!;
    await again.ctrl.opened(await sessionModel(reopened), reopened);
    expect(again.deps.toast).not.toHaveBeenCalledWith(expect.stringContaining('Converted'), 'info');
  });
});
