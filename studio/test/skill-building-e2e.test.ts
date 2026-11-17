// Extremo a extremo de la skill: plan revisado, construido y revisado otra vez con el controlador real.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import type { ComposedNode } from '../src/ifcx/types';
import { createExecutor } from '../src/assistant/studio/executor';
import type { StudioHost } from '../src/assistant/studio/host';
import { parsePlan } from '../src/modeling/planreview';
import type { BuildRequest } from '../src/modeling/build';
import type { PlaceRequest } from '../src/modeling/place';
import type { StairRequest } from '../src/modeling/stairplace';
import type { StairShape } from '../src/modeling/stairlayout';
import type { Review, ReviewOptions } from '../src/modeling/egress';

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

function make() {
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (path: string) => {
      if (path === LIB) return doorFile;
      throw new Error('not found');
    }),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  return { ctrl: new DocumentController(deps), ws, deps };
}

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

const levels = [1, 2, 3].map((n) => ({ name: `Level ${n}`, elevation: (n - 1) * 3, layout: 'a' }));
const build = { levels, layouts: { a: { walls, floors: [[[0, 0], [12, 0], [12, 10], [0, 10]]] } } };
const doors = [
  { asset: LIB, level: 'Level 1', at: [6, 0.15] },
  ...levels.flatMap((l) => [
    { asset: LIB, level: l.name, at: [2.5, 4.25] },
    { asset: LIB, level: l.name, at: [9.5, 4.25] },
    { asset: LIB, level: l.name, at: [2.5, 5.75] },
    { asset: LIB, level: l.name, at: [9.5, 5.75] },
  ]),
];
const plan = {
  lot: { width: 14, depth: 12 },
  apartments: { 'Level 1': 4, 'Level 2': 4, 'Level 3': 4 },
  build,
  doors,
  stairs: [
    { from: 'Level 1', to: 'Level 2', shape: 'u' as StairShape },
    { from: 'Level 2', to: 'Level 3', shape: 'u' as StairShape },
  ],
};

const dummyRoot = { path: '/p', name: 'p', origin: 'p', attributes: {}, children: [], parent: null } as ComposedNode;

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('end-to-end design skill', () => {
  it('revisa el plan, construye lo revisado y vuelve a revisar el modelo', async () => {
    const { ctrl } = make();
    await ctrl.newDocument();
    const host = {
      model: () => ({ name: 'B', path: null, dirty: false, editable: 'studio' as const, root: dummyRoot }),
      levels: () => ctrl.session?.doc.levels.map((l) => ({ name: l.name, elevation: l.elevation, path: l.id })) ?? [],
      selection: () => [],
      openView: () => {},
      fit: () => {},
      buildModel: (req: BuildRequest) => ctrl.buildModel(req),
      placePieces: (req: PlaceRequest, dryRun: boolean) => ctrl.placeAssets(req, dryRun),
      placeStairs: (req: StairRequest, dryRun: boolean) => ctrl.placeStairs(req, dryRun),
      reviewPlan: (p: ReturnType<typeof parsePlan>) => ctrl.reviewPlan(p),
      reviewModel: (opts: ReviewOptions) => Promise.resolve(ctrl.reviewModel(opts)),
    } as unknown as StudioHost;
    const exec = createExecutor(host);
    const ok = async (command: string, args: unknown = {}) => {
      const r = await exec.run(command, args);
      if (!r.ok) throw new Error(r.error);
      return r.result as any;
    };

    const parsed = parsePlan(plan);
    const firstReview = await ok('review_plan', plan);
    expect(firstReview.ok, JSON.stringify(firstReview.checks.filter((c: Review['checks'][number]) => !c.ok))).toBe(true);
    expect(firstReview.stairs).toHaveLength(2);

    await ok('build_model', build);
    await ok('place_stairs', { items: firstReview.stairs });
    await ok('place_in_wall', { items: doors });

    const secondReview = await ok('review_model', { lot: plan.lot, apartments: plan.apartments });
    expect(secondReview.ok, JSON.stringify(secondReview.checks.filter((c: Review['checks'][number]) => !c.ok))).toBe(true);
    expect(secondReview.exits).toBe(firstReview.exits);
    expect(secondReview.levels.map((l: { apartments: number }) => l.apartments)).toEqual(
      firstReview.levels.map((l: { apartments: number }) => l.apartments),
    );

    // borrar la puerta de un apartamento deja el recinto sin salida
    const ids = ctrl.session!.doc.composer.placements.map((p) => p.id);
    await ctrl.removeElements([ids[1]], 'Assistant: Delete Elements');
    const broken = await ok('review_model', { lot: plan.lot, apartments: plan.apartments });
    expect(broken.ok).toBe(false);
    const access = broken.checks.filter((c: Review['checks'][number]) => c.id === 'rooms-access' && !c.ok);
    expect(access).toHaveLength(1);
    expect(access[0].level).toBe('Level 1');
    expect(access[0].at[0]).toBeGreaterThan(0);
    expect(access[0].at[0]).toBeLessThan(5.25);
    expect(access[0].at[1]).toBeLessThan(5);

    await ctrl.undo();
    const fixed = await ok('review_model', { lot: plan.lot, apartments: plan.apartments });
    expect(fixed.ok).toBe(true);
    expect(parsed.build.fresh).toBe(true);
  });
});
