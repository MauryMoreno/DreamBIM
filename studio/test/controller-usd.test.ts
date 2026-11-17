// Controlador: variantes de elementos enlazados y carga de payloads.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel(m: LoadedModel | null) { if (m) this.models.push(m); }
  updateModel(m: LoadedModel) { this.models.push(m); }
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

async function linkedDoc(files: Record<string, string>, links = ['C:/p/a.ifcx']) {
  const disk = new Map(Object.entries(files));
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'C:/p/casa.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (p: string) => {
      const t = disk.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    }),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  const ctrl = new DocumentController(deps);
  await ctrl.newDocument();
  await ctrl.session!.saveTo('C:/p/casa.ifcx');
  for (const link of links) await ctrl.linkFile(link);
  const layer = ctrl.composerLayers[0];
  const at = (p: string) => ws.models.at(-1)!.result.byPath.get(p)!;
  const kids = (p: string) => at(p)?.children.map((c) => c.name).sort();
  ctrl.session!.dirty = false;
  return { ctrl, ws, deps, layer, at, kids };
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('variantes de elementos enlazados', () => {
  const doors = JSON.stringify({
    data: [
      { path: 'P', children: { d1: 'door', d2: 'door' } },
      { path: 'door', variants: { tipo: { simple: 'ds', doble: 'dd' } } },
      { path: 'ds', children: { Hoja: 'leaf' } },
      { path: 'dd', children: { HojaA: 'leaf', HojaB: 'leaf' } },
      { path: 'leaf' },
    ],
  });

  it('Session opened from disk (already saved at `path`).', async () => {
    const t = await linkedDoc({ 'C:/p/a.ifcx': doors });
    expect(t.at('/P/d1').variantSets).toEqual({ tipo: { options: ['simple', 'doble'], selected: 'simple' } });
    expect(t.ctrl.linkedVariantEdited(t.layer.id, t.at('/P/d1'), 'tipo')).toBe(false);

    expect(await t.ctrl.setLinkedVariant(t.layer.id, t.at('/P/d1'), 'tipo', 'doble')).toBe(true);
    expect(t.ctrl.composerLayers[0].edits).toEqual([{ path: 'P/d1', variantSelection: { tipo: 'doble' } }]);
    expect(t.kids('/P/d1')).toEqual(['HojaA', 'HojaB']);
    expect(t.kids('/P/d2')).toEqual(['Hoja']);
    expect(t.ctrl.session!.dirty).toBe(true);
    expect(t.ctrl.linkedVariantEdited(t.layer.id, t.at('/P/d1'), 'tipo')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Select Variant');

    expect(await t.ctrl.resetLinkedVariant(t.layer.id, t.at('/P/d1'), 'tipo')).toBe(true);
    expect(t.ctrl.composerLayers[0].edits).toEqual([]);
    expect(t.kids('/P/d1')).toEqual(['Hoja']);
  });

  it('New: model of the session, without changes, editable and opens the plan', async () => {
    const t = await linkedDoc({ 'C:/p/a.ifcx': doors });
    expect(await t.ctrl.setLinkedVariant(t.layer.id, t.at('/P/d1'), 'tipo', 'triple')).toBe(false);
    expect(await t.ctrl.setLinkedVariant(t.layer.id, t.at('/P/d1'), 'nope', 'simple')).toBe(false);
    expect(await t.ctrl.setLinkedVariant(t.layer.id, t.at('/P/d1'), 'tipo', 'simple')).toBe(true);
    expect(t.ctrl.composerLayers[0].edits).toEqual([]);
    expect(t.ctrl.session!.dirty).toBe(false);
  });
});

describe('payloads', () => {
  const site = JSON.stringify({
    data: [
      { path: 'S', children: { A: 'slot' } },
      { path: 'slot', payloads: { geo: { uri: './geo/b.ifcx', path: 'bld' } } },
    ],
  });
  const bld = JSON.stringify({ data: [{ path: 'bld', children: { L1: 'lvl' } }, { path: 'lvl' }] });

  it('cargar lee el archivo junto al que lo declara y compone su contenido, sin ensuciar el documento', async () => {
    const t = await linkedDoc({ 'C:/p/a.ifcx': site, 'C:/p/geo/b.ifcx': bld });
    expect(t.at('/S/A').payloads).toEqual({ geo: { uri: './geo/b.ifcx', path: 'bld', key: 'C:/p/geo/b.ifcx', loaded: false } });
    expect(t.kids('/S/A')).toEqual([]);

    expect(await t.ctrl.setPayloadLoaded('./geo/b.ifcx', true, t.layer.id)).toBe(true);
    expect(t.deps.readText).toHaveBeenLastCalledWith('C:/p/geo/b.ifcx');
    expect(t.kids('/S/A')).toEqual(['L1']);
    expect(t.at('/S/A').payloads!.geo.loaded).toBe(true);
    expect(t.ctrl.session!.dirty).toBe(false);
    expect(t.ctrl.history.undo).toBe('Link a.ifcx');

    expect(await t.ctrl.setPayloadLoaded('./geo/b.ifcx', false, t.layer.id)).toBe(true);
    expect(t.kids('/S/A')).toEqual([]);
  });

  it('un archivo que no se encuentra avisa y no carga nada', async () => {
    const t = await linkedDoc({ 'C:/p/a.ifcx': site });
    expect(await t.ctrl.setPayloadLoaded('./geo/b.ifcx', true, t.layer.id)).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining('b.ifcx'), 'error');
    expect(t.at('/S/A').payloads!.geo.loaded).toBe(false);
  });

  it('two layers that declare the same relative payload uri load their own file', async () => {
    const layerA = JSON.stringify({
      data: [
        { path: 'PA', children: { A: 'slotA' } },
        { path: 'slotA', payloads: { d: { uri: './detail.ifcx' } } },
      ],
    });
    const layerB = JSON.stringify({
      data: [
        { path: 'PB', children: { B: 'slotB' } },
        { path: 'slotB', payloads: { d: { uri: './detail.ifcx' } } },
      ],
    });
    const t = await linkedDoc(
      {
        'C:/p/a/l.ifcx': layerA,
        'C:/p/b/l.ifcx': layerB,
        'C:/p/a/detail.ifcx': JSON.stringify({ data: [{ path: 'da', attributes: { from: 'A' } }] }),
        'C:/p/b/detail.ifcx': JSON.stringify({ data: [{ path: 'db', attributes: { from: 'B' } }] }),
      },
      ['C:/p/a/l.ifcx', 'C:/p/b/l.ifcx'],
    );
    const [a, b] = t.ctrl.composerLayers;
    expect(await t.ctrl.setPayloadLoaded('./detail.ifcx', true, a.id)).toBe(true);
    expect(t.deps.readText).toHaveBeenLastCalledWith('C:/p/a/detail.ifcx');
    expect(t.at('/PA/A').payloads!.d.loaded).toBe(true);
    expect(t.at('/PB/B').payloads!.d.loaded).toBe(false);
    expect(t.kids('/PA/A')).toEqual(['da']);
    expect(t.kids('/PB/B')).toEqual([]);

    expect(await t.ctrl.setPayloadLoaded('./detail.ifcx', true, b.id)).toBe(true);
    expect(t.deps.readText).toHaveBeenLastCalledWith('C:/p/b/detail.ifcx');
    expect(t.at('/PB/B').payloads!.d.loaded).toBe(true);
    expect(t.kids('/PA/A')).toEqual(['da']);
    expect(t.kids('/PB/B')).toEqual(['db']);
  });

  it('al abrir otro documento los payloads cargados se olvidan', async () => {
    const t = await linkedDoc({ 'C:/p/a.ifcx': site, 'C:/p/geo/b.ifcx': bld });
    await t.ctrl.setPayloadLoaded('./geo/b.ifcx', true, t.layer.id);
    await t.ctrl.newDocument();
    expect(t.ctrl.loadedPayloads).toEqual([]);
  });
});
