// deleting one of two doors keeps the layer; deleting the last one removes it
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { parsePlaceFurniture, parsePlaceInWall } from '../src/modeling/place';
import { worldOrigin } from '../src/composer/xform';

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
const CHAIR = '/library/architecture/furniture/chair.ifcx';
const piece = (name: string, cls: string, w: number, d: number, h: number) =>
  JSON.stringify({
    data: [{
      path: name,
      attributes: {
        'bsi::ifc::class': { code: cls },
        'bsi::ifc::prop::Name': name,
        'bsi::ifc::prop::Width': w,
        'bsi::ifc::prop::Depth': d,
        'bsi::ifc::prop::Height': h,
      },
    }],
  });
const doorFile = piece('Door', 'IfcDoor', 1, 0.1, 2.1);
const chairFile = piece('Chair', 'IfcFurniture', 0.5, 0.5, 0.9);

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

/** Documento abierto con un muro [0,0]→[4,0] en el nivel a cota 0. */
async function openDoc(read?: (path: string) => Promise<string>) {
  const s = newSession();
  const level = s.doc.levels[0];
  const w = s.addWall([0, 0], [4, 0], level.id)!;
  s.dirty = false;
  const { ctrl, ws, deps } = make(read);
  await ctrl.opened(await sessionModel(s), s);
  return { ctrl, ws, deps, s, level, w };
}

const files = async (path: string) => {
  if (path === LIB) return doorFile;
  if (path === CHAIR) return chairFile;
  throw new Error('not found');
};
const twoDoors = (wall: string) =>
  parsePlaceInWall({ items: [{ asset: LIB, wall, offset: 1 }, { asset: LIB, wall, offset: 3 }] });
const countDoors = (m: LoadedModel) =>
  [...m.result.byPath.values()].filter((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcDoor').length;

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('placeAssets', () => {
  it('dryRun resume y no toca nada', async () => {
    const { ctrl, s, w } = await openDoc(files);
    const out = await ctrl.placeAssets(twoDoors(w.id), true);
    expect(out).toMatchObject({ summary: { total: 2, targets: 1 }, ids: [] });
    expect(ctrl.history.undo).toBeNull();
    expect(ctrl.composerLayers).toHaveLength(0);
    expect(s.doc.composer.placements).toEqual([]);
    expect(s.dirty).toBe(false);
  });

  it('Controller: review of the plan before building and of the open model afterwards.', async () => {
    const { ctrl, s, w } = await openDoc(files);
    const out = await ctrl.placeAssets(twoDoors(w.id), false);
    expect(out.ids).toHaveLength(2);
    expect(ctrl.composerLayers).toHaveLength(1);
    expect(s.doc.composer.placements).toHaveLength(2);
    expect(new Set(s.doc.composer.placements.map((p) => p.layerUri)).size).toBe(1);
    expect(ctrl.history.undo).toBe('Assistant: Place (2)');
  });

  it('el modelo mostrado tiene dos IfcDoor y el muro con hueco', async () => {
    const { ctrl, ws, w } = await openDoc(files);
    await ctrl.placeAssets(twoDoors(w.id), false);
    const m = ws.models.at(-1)!;
    expect(countDoors(m)).toBe(2);
    const wall = m.result.byOrigin.get(w.id)![0];
    expect(wall.attributes['bsi::ifc::prop::NetVolume']).toBeCloseTo(4 * 0.2 * 3 - 2 * 1 * 0.2 * 2.1);
  });

  it('deshacer quita piezas, huecos y la capa', async () => {
    const { ctrl, ws, s, w } = await openDoc(files);
    await ctrl.placeAssets(twoDoors(w.id), false);
    await ctrl.undo();
    expect(s.doc.composer.placements).toEqual([]);
    expect(ctrl.composerLayers).toEqual([]);
    const wall = ws.models.at(-1)!.result.byOrigin.get(w.id)![0];
    expect(wall.attributes['bsi::ifc::prop::NetVolume']).toBeCloseTo(4 * 0.2 * 3);
    expect(countDoors(ws.models.at(-1)!)).toBe(0);
  });

  it('una segunda llamada reutiliza la capa', async () => {
    const { ctrl, s, w } = await openDoc(files);
    await ctrl.placeAssets(parsePlaceInWall({ items: [{ asset: LIB, wall: w.id, offset: 1 }] }), false);
    await ctrl.placeAssets(parsePlaceInWall({ items: [{ asset: LIB, wall: w.id, offset: 3 }] }), false);
    expect(ctrl.composerLayers).toHaveLength(1);
    expect(s.doc.composer.placements).toHaveLength(2);
  });

  it('un archivo ilegible rechaza con el motivo y no deja nada', async () => {
    const { ctrl, deps, s, w } = await openDoc(async () => { throw new Error('missing'); });
    await expect(ctrl.placeAssets(twoDoors(w.id), false)).rejects.toThrow(/place_in_wall: could not read/);
    expect(deps.toast).not.toHaveBeenCalled();
    expect(s.doc.composer.placements).toEqual([]);
    expect(ctrl.composerLayers).toEqual([]);
    expect(ctrl.history.undo).toBeNull();
  });

  it('si un item no cabe, nada cambia', async () => {
    const { ctrl, s, w } = await openDoc(files);
    await expect(ctrl.placeAssets(parsePlaceInWall({ items: [{ asset: LIB, wall: w.id, offset: 0.1 }] }), false))
      .rejects.toThrow(/does not fit/);
    expect(s.doc.composer.placements).toEqual([]);
    expect(ctrl.composerLayers).toEqual([]);
    expect(ctrl.history.undo).toBeNull();
  });

  it('mueble en un nivel', async () => {
    const { ctrl, ws, level } = await openDoc(files);
    const out = await ctrl.placeAssets(
      parsePlaceFurniture({ items: [{ asset: CHAIR, level: level.name, at: [2, 3] }] }),
      false,
    );
    const node = ws.models.at(-1)!.result.byOrigin.get(out.ids[0])![0];
    expect(worldOrigin(node)).toEqual([2, 3, 0]);
    expect(ctrl.session!.doc.composer.placements[0].parentId).toBe(level.id);
  });

  it('elementIds lleva de la puerta compuesta a su contenedor', async () => {
    const { ctrl, ws, w } = await openDoc(files);
    const out = await ctrl.placeAssets(twoDoors(w.id), false);
    const m = ws.models.at(-1)!;
    const door = [...m.result.byPath.values()].find((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcDoor')!;
    expect(ctrl.elementIds([door.path])).toEqual([out.ids[0]]);
    expect(ctrl.elementIds(['/nope'])).toBeNull();
  });

  it('--- a foreign IFCx, like the structure model, that imports its schedule --------------------------------', async () => {
    const { ctrl, s, w } = await openDoc(files);
    const out = await ctrl.placeAssets(twoDoors(w.id), false);
    expect(await ctrl.removeElements([out.ids[0]], 'Assistant: Delete Elements (1)')).toBe(1);
    expect(s.doc.composer.placements).toHaveLength(1);
    expect(ctrl.composerLayers).toHaveLength(1);
    await ctrl.removeElements([out.ids[1]], 'Assistant: Delete Elements (1)');
    expect(s.doc.composer.placements).toEqual([]);
    expect(ctrl.composerLayers).toEqual([]);
  });

  it('borrar el muro se lleva sus puertas y su capa', async () => {
    const { ctrl, s, w } = await openDoc(files);
    await ctrl.placeAssets(twoDoors(w.id), false);
    expect(await ctrl.removeElements([w.id], 'Assistant: Delete Elements (1)')).toBe(1);
    expect(s.doc.walls).toEqual([]);
    expect(s.doc.composer.placements).toEqual([]);
    expect(ctrl.composerLayers).toEqual([]);
  });
});
