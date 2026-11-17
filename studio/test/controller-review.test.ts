// opening the structure model reads the tasks of the schedule it imports
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { parsePlan } from '../src/modeling/planreview';

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

const LIB = '/library/architecture/doors/door.ifcx';
const doorFile = JSON.stringify({
  data: [{
    path: 'Door',
    attributes: {
      'bsi::ifc::class': { code: 'IfcDoor' },
      'bsi::ifc::prop::Name': 'Door',
      'bsi::ifc::prop::Width': 1,
      'bsi::ifc::prop::Depth': 0.1,
      'bsi::ifc::prop::Height': 2.1,
    },
  }],
});

function make(read: (path: string) => Promise<string> = async () => { throw new Error('not found'); }) {
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(read),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  return { ctrl: new DocumentController(deps), ws, deps };
}

const files = async (path: string) => {
  if (path === LIB) return doorFile;
  throw new Error('not found');
};

const walls = [
  { from: [0.15, 0.15], to: [11.85, 0.15], thickness: 0.3 },
  { from: [11.85, 0.15], to: [11.85, 9.85], thickness: 0.3 },
  { from: [11.85, 9.85], to: [0.15, 9.85], thickness: 0.3 },
  { from: [0.15, 9.85], to: [0.15, 0.15], thickness: 0.3 },
  { from: [0.15, 4.25], to: [5.25, 4.25], thickness: 0.15 },
  { from: [6.75, 4.25], to: [11.85, 4.25], thickness: 0.15 },
  { from: [0.15, 5.75], to: [4.7, 5.75], thickness: 0.15 },
  { from: [7.3, 5.75], to: [11.85, 5.75], thickness: 0.15 },
  { from: [5.25, 0.15], to: [5.25, 4.25], thickness: 0.15 },
  { from: [6.75, 0.15], to: [6.75, 4.25], thickness: 0.15 },
  { from: [4.7, 5.75], to: [4.7, 9.85], thickness: 0.15 },
  { from: [7.3, 5.75], to: [7.3, 9.85], thickness: 0.15 },
];

const BPLAN = {
  lot: { width: 14, depth: 12 },
  apartments: { 'Level 1': 4, 'Level 2': 4 },
  build: {
    levels: [
      { name: 'Level 1', elevation: 0, layout: 'a' },
      { name: 'Level 2', elevation: 3, layout: 'a' },
    ],
    layouts: { a: { walls, floors: [[[0, 0], [12, 0], [12, 10], [0, 10]]] } },
  },
  doors: [
    { asset: LIB, level: 'Level 1', at: [6, 0.15] },
    { asset: LIB, level: 'Level 1', at: [2.5, 4.25] },
    { asset: LIB, level: 'Level 1', at: [9.5, 4.25] },
    { asset: LIB, level: 'Level 1', at: [2.5, 5.75] },
    { asset: LIB, level: 'Level 1', at: [9.5, 5.75] },
    { asset: LIB, level: 'Level 2', at: [2.5, 4.25] },
    { asset: LIB, level: 'Level 2', at: [9.5, 4.25] },
    { asset: LIB, level: 'Level 2', at: [2.5, 5.75] },
    { asset: LIB, level: 'Level 2', at: [9.5, 5.75] },
  ],
  stairs: [{ from: 'Level 1', to: 'Level 2', shape: 'u' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('reviewPlan del controlador', () => {
  it('revisa sin documento abierto y no crea documento, capas ni historial', async () => {
    const { ctrl, ws } = make(files);
    const out = await ctrl.reviewPlan(parsePlan(BPLAN));
    expect(out.review.ok, JSON.stringify(out.review.checks.filter((c) => !c.ok))).toBe(true);
    expect(ctrl.session).toBeNull();
    expect(ctrl.composerLayers).toEqual([]);
    expect(ctrl.history.undo).toBeNull();
    expect(ws.models).toHaveLength(0);
  });

  it('un archivo de puerta ilegible rechaza con el prefijo', async () => {
    const { ctrl } = make(async () => {
      throw new Error('missing');
    });
    await expect(ctrl.reviewPlan(parsePlan(BPLAN))).rejects.toThrow(/review_plan: could not read '.*door\.ifcx': missing/);
  });
});

describe('reviewModel del controlador', () => {
  it('revisa el modelo construido, falla al borrar una puerta y vuelve a pasar al deshacer', async () => {
    const { ctrl } = make(files);
    const plan = parsePlan(BPLAN);
    const planned = await ctrl.reviewPlan(plan);
    await ctrl.newDocument();
    await ctrl.buildModel(plan.build);
    await ctrl.placeAssets(plan.doors!, false);
    await ctrl.placeStairs({ items: planned.stairs }, false);

    const opts = { lot: plan.lot, apartments: plan.apartments };
    expect(ctrl.reviewModel(opts).ok).toBe(true);

    const ids = ctrl.session!.doc.composer.placements.map((p) => p.id);
    await ctrl.removeElements([ids[1]], 'Assistant: Delete Elements');
    const broken = ctrl.reviewModel(opts);
    expect(broken.ok).toBe(false);
    const access = broken.checks.filter((c) => c.id === 'rooms-access' && !c.ok);
    expect(access.length).toBeGreaterThan(0);
    expect(access[0].level).toBe('Level 1');

    await ctrl.undo();
    expect(ctrl.reviewModel(opts).ok).toBe(true);
  });

  it('sin modelo abierto rechaza', () => {
    const { ctrl } = make();
    expect(() => ctrl.reviewModel({})).toThrow('No model is open');
  });
});
