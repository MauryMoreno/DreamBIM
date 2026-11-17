// Controlador: colocar, buscar y borrar escaleras en un solo paso de deshacer.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { parsePlaceStairs } from '../src/modeling/stairplace';

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

const build = (levels = 2) => {
  const order = Array.from({ length: levels }, (_, i) => ({ name: `Level ${i + 1}`, elevation: i * 3, layout: 'a' }));
  return parseBuildRequest({
    levels: order,
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
  });
};

async function openDoc(levels = 2) {
  const s = newSession();
  applyBuild(s.doc, build(levels));
  s.dirty = false;
  const { ctrl, ws, deps } = make();
  await ctrl.opened(await sessionModel(s), s);
  return { ctrl, ws, deps, s };
}

const req = (at: [number, number] = [3, 3], levels = [1, 2]) =>
  parsePlaceStairs({ items: [{ from: `Level ${levels[0]}`, to: `Level ${levels[1]}`, shape: 'u', at }] });

const byClass = (m: LoadedModel, code: string) =>
  [...m.result.byPath.values()].filter((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === code);

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('placeStairs', () => {
  it('dryRun resume y no toca historial ni documento', async () => {
    const { ctrl, s } = await openDoc();
    const out = await ctrl.placeStairs(req(), true);
    expect(out.summary.total).toBe(1);
    expect(out.summary.stairs[0]).toMatchObject({ shape: 'u', risers: 17, width: 1.1 });
    expect(out.ids).toEqual([]);
    expect(ctrl.history.undo).toBeNull();
    expect(s.doc.stairs).toEqual([]);
    expect(s.dirty).toBe(false);
  });

  it('coloca una U: IfcStair, barandas y el suelo superior pierde volumen', async () => {
    const { ctrl, ws, s } = await openDoc();
    const upper = s.doc.floors.find((f) => f.levelId === s.doc.levels[1].id)!;
    await ctrl.placeStairs(req(), false);
    expect(s.doc.stairs).toHaveLength(1);
    expect(ctrl.history.undo).toBe('Assistant: Place Stairs (1)');
    const m = ws.models.at(-1)!;
    expect(byClass(m, 'IfcStair')).toHaveLength(1);
    expect(byClass(m, 'IfcRailing').length).toBeGreaterThan(0);
    const node = m.result.byOrigin.get(upper.id)![0];
    expect(node.attributes['bsi::ifc::prop::NetVolume']).toBeLessThan(80 * 0.3);
  });

  it('deshacer la quita y el suelo recupera su volumen', async () => {
    const { ctrl, ws, s } = await openDoc();
    const upper = s.doc.floors.find((f) => f.levelId === s.doc.levels[1].id)!;
    await ctrl.placeStairs(req(), false);
    await ctrl.undo();
    expect(s.doc.stairs).toEqual([]);
    const m = ws.models.at(-1)!;
    expect(byClass(m, 'IfcStair')).toHaveLength(0);
    expect(m.result.byOrigin.get(upper.id)![0].attributes['bsi::ifc::prop::NetVolume']).toBeCloseTo(80 * 0.3);
  });

  it('it is chosen per instance in the edit layer and Reset brings back that of the file', async () => {
    const { ctrl, s } = await openDoc();
    await expect(ctrl.placeStairs(req([20, 20]), false)).rejects.toThrow(/place_stairs: items\[0\]: /);
    expect(s.doc.stairs).toEqual([]);
    expect(ctrl.history.undo).toBeNull();
  });
});

describe('stairSpots', () => {
  it('it rejects sets or options that do not exist; the same option writes nothing', async () => {
    const { ctrl } = await openDoc();
    const res = ctrl.stairSpots({ from: 'Level 1', to: 'Level 2', shape: 'u', width: 1.1, limit: 10 });
    expect(res.risers).toBe(17);
    expect(res.spots.length).toBeGreaterThan(0);
    expect(ctrl.stairSpots({ from: 'level 1', to: 'LEVEL 2', shape: 'u', width: 1.1, limit: 3 }).spots.length).toBeLessThanOrEqual(3);
    expect(() => ctrl.stairSpots({ from: 'N9', to: 'Level 2', shape: 'u', width: 1.1, limit: 10 }))
      .toThrow(/stair_spots: no level named 'N9'/);
  });
});

describe('removeElements con escaleras', () => {
  it('el id de un tramo borra la escalera entera y cuenta una vez', async () => {
    const { ctrl, s } = await openDoc();
    const out = await ctrl.placeStairs(req(), false);
    const stair = s.doc.stairs[0];
    const n = await ctrl.removeElements([`${stair.id}-f1`, `${stair.id}-l`, out.ids[0]], 'Assistant: Delete Elements (3)');
    expect(n).toBe(1);
    expect(s.doc.stairs).toEqual([]);
  });

  it('un id que no es nada lo dice con escaleras en la lista', async () => {
    const { ctrl } = await openDoc();
    await expect(ctrl.removeElements(['nope'], 'x')).rejects.toThrow(/not a wall, floor, stair or placed piece/);
  });
});
