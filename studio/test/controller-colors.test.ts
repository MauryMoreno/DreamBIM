// like a document just opened from disk
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { editPath } from '../src/composer/edits';
import { COLORS_KIND, EMPTY_COLORS, K_DIFFUSE, K_OPACITY, type ColorsState } from '../src/colors/state';

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
const SIDE = 'C:/p/casa.colors.ifcx';

/** the shown model carries the colors saved by composed path, and undoing removes them */
async function openDoc(sidecar?: (walls: string[]) => ColorsState | string, readOnly = false) {
  const s = newSession();
  s.path = DOC;
  const lvl = s.doc.levels[0].id;
  s.addWall([0, 0], [4, 0], lvl);
  s.addWall([0, 4], [4, 4], lvl);
  s.dirty = false; // colors: agent path and routes
  const model = await sessionModel(s);
  const walls = [...model.result.byPath.values()]
    .filter((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall')
    .map((n) => editPath(n, model.result));
  const disk = new Map<string, string>();
  const content = sidecar?.(walls);
  if (content !== undefined) disk.set(SIDE, typeof content === 'string' ? content : JSON.stringify(COLORS_KIND.toFile(content, 'casa')));
  const ws = new FakeWs();
  const deps = {
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
  const ctrl = new DocumentController(deps);
  const saveTo = vi.spyOn(s, 'saveTo').mockResolvedValue(undefined);
  await ctrl.opened(model, readOnly ? null : s);
  const attrOf = (path: string, key: string) => ws.models.at(-1)!.result.byOrigin.get(path)?.[0]?.attributes[key];
  return { ctrl, ws, deps, disk, s, saveTo, walls, attrOf };
}

const RED = { color: '#ff0000', opacity: 1 };
const withRed = (w: string[]): ColorsState => ({ assign: { [w[0]]: RED } });

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('colores: editar y deshacer', () => {
  it('setColors es un paso: marca cambios, se compone en el modelo y deshacer lo quita', async () => {
    const t = await openDoc();
    expect(await t.ctrl.setColors(t.walls, RED, 'Assistant: Set Color (2)')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Assistant: Set Color (2)');
    expect(t.ctrl.colors.assign[t.walls[0]]).toEqual(RED);
    expect(t.s.dirty).toBe(true);
    expect(t.attrOf(t.walls[0], K_DIFFUSE)).toEqual([1, 0, 0]);
    expect(t.attrOf(t.walls[0], K_OPACITY)).toBe(1);
    await t.ctrl.undo();
    expect(t.ctrl.colors).toEqual(EMPTY_COLORS);
    expect(t.attrOf(t.walls[0], K_DIFFUSE)).toBeUndefined();
    expect(t.s.dirty).toBe(false);
  });

  it('null quita el color de esos elementos', async () => {
    const t = await openDoc(withRed);
    await t.ctrl.setColors([t.walls[0]], null, 'Assistant: Clear Color (1)');
    expect(t.ctrl.colors.assign).toEqual({});
  });

  it('un color que no cambia nada no apila ni marca cambios', async () => {
    const t = await openDoc(withRed);
    expect(await t.ctrl.setColors([t.walls[0]], RED, 'x')).toBe(true);
    expect(t.ctrl.history.undo).toBeNull();
    expect(t.s.dirty).toBe(false);
  });
});

describe('colores: lo que se dibuja', () => {
  const composed = (t: Awaited<ReturnType<typeof openDoc>>, edit: string) =>
    [...t.ws.models.at(-1)!.result.byPath.values()].find((n) => n.origin === edit)!.path;

  it('asAgent returns what the function returns', async () => {
    const t = await openDoc();
    expect(t.ws.models.at(-1)!.savedColors).toBeUndefined();
    await t.ctrl.setColors([t.walls[0]], RED, 'x');
    expect(t.ws.models.at(-1)!.savedColors!.get(composed(t, t.walls[0]))).toEqual(RED);
    await t.ctrl.undo();
    expect(t.ws.models.at(-1)!.savedColors).toBeUndefined();
  });

  it('al abrir un documento con colores guardados el modelo ya los lleva', async () => {
    const t = await openDoc(withRed);
    expect(t.ws.models.at(-1)!.savedColors!.get(composed(t, t.walls[0]))).toEqual(RED);
  });
});

describe('colores: abrir y guardar', () => {
  it('lee <modelo>.colors.ifcx y lo compone encima del modelo sin marcar cambios', async () => {
    const t = await openDoc(withRed);
    expect(t.attrOf(t.walls[0], K_DIFFUSE)).toEqual([1, 0, 0]);
    expect(t.s.dirty).toBe(false);
  });

  it('Save escribe el archivo de colores sin reescribir el modelo', async () => {
    const t = await openDoc();
    await t.ctrl.setColors([t.walls[0]], RED, 'x');
    expect(await t.ctrl.save()).toBe(true);
    expect(t.saveTo).not.toHaveBeenCalled();
    expect(JSON.parse(t.disk.get(SIDE)!).header.id).toBe('studio-colors/casa');
  });

  it('poner un color y deshacerlo antes de guardar no escribe el archivo de colores', async () => {
    const t = await openDoc();
    await t.ctrl.setColors([t.walls[0]], RED, 'x');
    await t.ctrl.undo();
    await t.ctrl.save();
    expect(t.deps.writeText).not.toHaveBeenCalledWith(SIDE, expect.any(String));
  });
});

describe('Controller: the cost assignment is its own IFCx layer (`<model>.costos-asignacion.ifcx`) that the model', () => {
  it('con el bloqueo del usuario setColors falla; asAgent pasa y el flag no se queda puesto', async () => {
    const t = await openDoc();
    t.ctrl.setUserLock(true);
    expect(await t.ctrl.setColors(t.walls, RED, 'x')).toBe(false);
    expect(await t.ctrl.asAgent(() => t.ctrl.setColors(t.walls, RED, 'x'))).toBe(true);
    expect(await t.ctrl.setColors(t.walls, null, 'x')).toBe(false);
  });

  it('imports; the first assignment creates it (or reads the one that exists) and adds the import, in a single history step.', async () => {
    const t = await openDoc();
    expect(t.ctrl.asAgent(() => 7)).toBe(7);
  });

  it('assignMaterial acepta una etiqueta propia', async () => {
    const t = await openDoc();
    await t.ctrl.setMaterial(null, { name: 'C30', code: 'C30', color: '#8a8a8a', opacity: 1 });
    await t.ctrl.assignMaterial([t.walls[0]], 'C30', 'Assistant: Assign Material (1)');
    expect(t.ctrl.history.undo).toBe('Assistant: Assign Material (1)');
  });

  it('editPaths traduce rutas compuestas y devuelve null con una desconocida', async () => {
    const t = await openDoc();
    const composed = [...t.ws.models.at(-1)!.result.byPath.values()].find((n) => n.origin === t.walls[0])!.path;
    expect(t.ctrl.editPaths([composed])).toEqual([t.walls[0]]);
    expect(t.ctrl.editPaths([composed, '/no/existe'])).toBeNull();
  });
});
