import { describe, expect, it, vi } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { createLiveHost, pngSize, type LiveHostDeps } from '../src/assistant/studio/live-host';

const root = { path: '/p', name: 'p', origin: 'p', attributes: {}, children: [], parent: null } as ComposedNode;

/** Minimal PNG with a 640 x 480 IHDR header (the only thing `pngSize` reads). */
function pngHeader(w: number, h: number): string {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;
}

function deps(over: Partial<LiveHostDeps> = {}): LiveHostDeps {
  return {
    ws: {
      model: () => ({ name: 'Torre', path: 'C:/t.ifcx', root }),
      levels: () => [], selection: () => [], select: vi.fn(), selectMany: vi.fn(), openView: vi.fn(), fit: vi.fn(),
      highlight: vi.fn(), clearHighlight: vi.fn(), provenance: () => null, materials: () => [],
      setToggle: vi.fn(), layers: () => [], setLayerHidden: () => false, screenshot: () => null, libraryFolder: () => null,
    },
    doc: { hasDocument: true, isDirty: () => false, editable: () => 'studio', idle: async () => {} },
    edit: {
      asAgent: <T,>(fn: () => T): T => fn(),
      editPaths: (p) => p.map((x) => 'e:' + x),
      setColors: vi.fn(async () => true),
      assignMaterial: vi.fn(async () => true),
      setMaterial: vi.fn(async () => true),
      buildModel: vi.fn(async () => ({ levels: 0, walls: 0, floors: 0, levelIds: [] })),
      placeAssets: vi.fn(async () => ({ summary: { total: 0, targets: 0, pieces: [] }, ids: [] })),
      stairSpots: vi.fn(() => ({ risers: 17, riser: 3 / 17, spots: [] })),
      placeStairs: vi.fn(async () => ({ summary: { total: 0, stairs: [], openings: 0 }, ids: [] })),
      elementIds: vi.fn((p: string[]) => p.map((x) => 'e:' + x)),
      removeElements: vi.fn(async (ids: string[]) => ids.length),
      reviewPlan: vi.fn(async () => ({ review: { ok: true, checks: [], exits: 0, levels: [] }, stairs: [], buildKey: 'K' })),
      reviewModel: vi.fn(() => ({ ok: true, checks: [], exits: 0, levels: [] })),
    },
    openPath: vi.fn(async () => {}),
    searchLibrary: vi.fn(async () => []),
    cardInfo: vi.fn(async () => null),
    scale: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,SMALL', width: 100, height: 50 })),
    ...over,
  };
}

const RED = { color: '#ff0000', opacity: 1 };

describe('host real de Studio para el Asistente: ediciones', () => {
  it('setColor translates to edit paths and calls setColors inside asAgent with the label', async () => {
    const d = deps();
    const order: string[] = [];
    d.edit.asAgent = <T,>(fn: () => T): T => { order.push('in'); const r = fn(); order.push('out'); return r; };
    (d.edit.setColors as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('call'); return true; });
    await createLiveHost(d).setColor(['/a', '/b'], RED);
    expect(d.edit.setColors).toHaveBeenCalledWith(['e:/a', 'e:/b'], RED, 'Assistant: Set Color (2)');
    expect(order).toEqual(['in', 'call', 'out']);
  });

  it('setColor con null usa la etiqueta de quitar', async () => {
    const d = deps();
    await createLiveHost(d).setColor(['/a'], null);
    expect(d.edit.setColors).toHaveBeenCalledWith(['e:/a'], null, 'Assistant: Clear Color (1)');
  });

  it('una ruta desconocida rechaza sin llamar a setColors', async () => {
    const d = deps();
    d.edit.editPaths = () => null;
    await expect(createLiveHost(d).setColor(['/x'], RED)).rejects.toThrow('not in the open model');
    expect(d.edit.setColors).not.toHaveBeenCalled();
  });

  it('si el controlador devuelve false, rechaza con el mensaje fijado', async () => {
    const d = deps();
    (d.edit.setColors as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(createLiveHost(d).setColor(['/a'], RED)).rejects.toThrow(
      'Dream BIM could not apply the change; the user has been shown why',
    );
  });

  it('en solo lectura o sin documento rechaza sin tocar nada', async () => {
    const ro = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'readonly', idle: async () => {} } });
    await expect(createLiveHost(ro).setColor(['/a'], RED)).rejects.toThrow('The model is read-only');
    expect(ro.edit.setColors).not.toHaveBeenCalled();
    const none = deps({ doc: { hasDocument: false, isDirty: () => false, editable: () => 'readonly', idle: async () => {} } });
    await expect(createLiveHost(none).assignMaterial(['/a'], 'C30')).rejects.toThrow('No model is open');
  });

  it('assignMaterial uses the Assistant label and the edit paths', async () => {
    const d = deps();
    await createLiveHost(d).assignMaterial(['/a'], 'C30');
    expect(d.edit.assignMaterial).toHaveBeenCalledWith(['e:/a'], 'C30', 'Assistant: Assign Material (1)');
  });

  it('createMaterial llama setMaterial(null, def) dentro de asAgent', async () => {
    const d = deps();
    const def = { name: 'C30', code: 'C30', color: '#8a8a8a', opacity: 1 };
    await createLiveHost(d).createMaterial(def);
    expect(d.edit.setMaterial).toHaveBeenCalledWith(null, def);
  });

  it('materials comes from the catalog of the workspace (own and from the model)', () => {
    const list = [{ code: 'LADRILLO', name: 'LADRILLO', color: '#aa5533', opacity: 1, elements: 3 }];
    const d = deps();
    d.ws.materials = () => list;
    expect(createLiveHost(d).materials()).toEqual(list);
  });

  it('selection, selectMany, highlight y provenance pasan al espacio de trabajo', () => {
    const d = deps();
    const host = createLiveHost(d);
    host.selectMany(['/a']);
    host.highlight(['/a'], RED);
    host.clearHighlight(['/a']);
    expect(d.ws.selectMany).toHaveBeenCalledWith(['/a']);
    expect(d.ws.highlight).toHaveBeenCalledWith(['/a'], RED);
    expect(d.ws.clearHighlight).toHaveBeenCalledWith(['/a']);
    expect(host.selection()).toEqual([]);
    expect(host.provenance('/a')).toBeNull();
  });
});

describe('host real de Studio para el Asistente: construir y borrar', () => {
  const req = () => ({ levels: [{ name: 'L1', elevation: 0, height: 3, layout: 'a' }], layouts: { a: { walls: [], floors: [] } } });

  it('buildModel nuevo se niega con cambios sin guardar', async () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => true, editable: () => 'studio', idle: async () => {} } });
    await expect(createLiveHost(d).buildModel({ ...req(), fresh: true })).rejects.toThrow('unsaved changes');
    expect(d.edit.buildModel).not.toHaveBeenCalled();
  });

  it('buildModel nuevo funciona sin documento abierto', async () => {
    const d = deps({ doc: { hasDocument: false, isDirty: () => false, editable: () => 'readonly', idle: async () => {} } });
    await createLiveHost(d).buildModel({ ...req(), fresh: true });
    expect(d.edit.buildModel).toHaveBeenCalledTimes(1);
  });

  it('a new buildModel waits for idle before checking whether it is dirty', async () => {
    const order: string[] = [];
    const d = deps({
      doc: {
        hasDocument: true,
        isDirty: () => {
          order.push('dirty');
          return false;
        },
        editable: () => 'studio',
        idle: async () => {
          order.push('idle');
        },
      },
    });
    await createLiveHost(d).buildModel({ ...req(), fresh: true });
    expect(order).toEqual(['idle', 'dirty']);
  });

  it('buildModel sobre el actual exige un documento de Studio', async () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'foreign', idle: async () => {} } });
    await expect(createLiveHost(d).buildModel({ ...req(), fresh: false })).rejects.toThrow('not made in Dream BIM');
    expect(d.edit.buildModel).not.toHaveBeenCalled();
  });

  it('buildModel corre dentro de asAgent', async () => {
    const d = deps();
    const asAgent = vi.fn(<T,>(fn: () => T): T => fn());
    d.edit.asAgent = asAgent as <T>(fn: () => T) => T;
    await createLiveHost(d).buildModel({ ...req(), fresh: false });
    expect(asAgent).toHaveBeenCalledTimes(1);
  });

  it('deleteElements translates paths and returns the number', async () => {
    const d = deps();
    const n = await createLiveHost(d).deleteElements(['/a', '/b']);
    expect(n).toBe(2);
    expect(d.edit.elementIds).toHaveBeenCalledWith(['/a', '/b']);
    expect(d.edit.removeElements).toHaveBeenCalledWith(['e:/a', 'e:/b'], 'Assistant: Delete Elements (2)');
  });

  it('deleteElements refuses if a path is not in the model', async () => {
    const d = deps();
    d.edit.elementIds = () => null;
    await expect(createLiveHost(d).deleteElements(['/x'])).rejects.toThrow('Some paths are not in the open model');
    expect(d.edit.removeElements).not.toHaveBeenCalled();
  });

  it('placePieces traduce la ruta del muro a su id y llama a placeAssets', async () => {
    const d = deps();
    const req = { kind: 'wall' as const, items: [{ asset: '/lib/door.ifcx', wall: '/w', offset: 1 }] };
    await createLiveHost(d).placePieces(req, false);
    expect(d.edit.elementIds).toHaveBeenCalledWith(['/w']);
    expect(d.edit.placeAssets).toHaveBeenCalledWith(
      { kind: 'wall', items: [{ asset: '/lib/door.ifcx', wall: 'e:/w', offset: 1 }] },
      false,
    );
  });

  it('placePieces en un modelo que no es de Studio rechaza y no llama a placeAssets', async () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'foreign', idle: async () => {} } });
    await expect(
      createLiveHost(d).placePieces({ kind: 'wall', items: [{ asset: '/lib/door.ifcx', wall: '/w', offset: 1 }] }, false),
    ).rejects.toThrow('not made in Dream BIM');
    expect(d.edit.placeAssets).not.toHaveBeenCalled();
  });

  it('placePieces with a path that is not in the model rejects', async () => {
    const d = deps();
    d.edit.elementIds = () => null;
    await expect(
      createLiveHost(d).placePieces({ kind: 'wall', items: [{ asset: '/lib/door.ifcx', wall: '/x', offset: 1 }] }, true),
    ).rejects.toThrow('Some paths are not in the open model');
  });

  it('placePieces con la forma por nivel y punto no traduce rutas', async () => {
    const d = deps();
    const req = { kind: 'wall' as const, items: [{ asset: '/lib/door.ifcx', level: 'Level 1', at: [2, 0] as [number, number] }] };
    await createLiveHost(d).placePieces(req, false);
    expect(d.edit.elementIds).not.toHaveBeenCalled();
    expect(d.edit.placeAssets).toHaveBeenCalledWith(req, false);
  });
});

describe('host real de Studio para el Asistente', () => {
  it('pngSize reads the size from the header', () => {
    expect(pngSize(pngHeader(640, 480))).toEqual({ width: 640, height: 480 });
    expect(pngSize('data:image/png;base64,')).toBeNull();
    expect(pngSize('nada')).toBeNull();
  });

  it('model() adds dirty and editable from the controller', () => {
    const host = createLiveHost(deps({ doc: { hasDocument: true, isDirty: () => true, editable: () => 'foreign', idle: async () => {} } }));
    expect(host.model()).toEqual({ name: 'Torre', path: 'C:/t.ifcx', dirty: true, editable: 'foreign', root });
  });

  it('model() es null sin documento', () => {
    const host = createLiveHost(deps({ doc: { hasDocument: false, isDirty: () => false, editable: () => 'readonly', idle: async () => {} } }));
    expect(host.model()).toBeNull();
  });

  it('open_model con cambios sin guardar se niega sin abrir nada', async () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => true, editable: () => 'studio', idle: async () => {} } });
    await expect(createLiveHost(d).openModel('C:/a.ifcx')).rejects.toThrow(
      'The open model has unsaved changes: ask the user to save or discard them first',
    );
    expect(d.openPath).not.toHaveBeenCalled();
  });

  it('open_model waits for what is queued to finish before checking for changes (no dialog)', async () => {
    // a user edit queued before the lock dirties the document while waiting
    let dirty = false;
    const d = deps({ doc: { hasDocument: true, isDirty: () => dirty, editable: () => 'studio', idle: async () => { dirty = true; } } });
    await expect(createLiveHost(d).openModel('C:/a.ifcx')).rejects.toThrow('unsaved changes');
    expect(d.openPath).not.toHaveBeenCalled();
  });

  it('open_model without changes opens the path; with a wrong extension it refuses', async () => {
    const d = deps();
    const host = createLiveHost(d);
    await host.openModel('C:/a.ifcx');
    expect(d.openPath).toHaveBeenCalledWith('C:/a.ifcx');
    await expect(host.openModel('C:/a.txt')).rejects.toThrow("open_model: 'path' must be an .ifcx file");
  });

  it('screenshot: sin captura da null; si cabe en max_size, la devuelve tal cual', async () => {
    const png = pngHeader(640, 480);
    const d = deps({ ws: { ...deps().ws, screenshot: () => png } });
    const host = createLiveHost(d);
    expect(await host.screenshot(1024)).toEqual({ dataUrl: png, width: 640, height: 480 });
    expect(d.scale).not.toHaveBeenCalled();
    expect(await createLiveHost(deps()).screenshot(1024)).toBeNull();
  });

  it('screenshot: si no cabe, la reduce con scale', async () => {
    const png = pngHeader(2048, 1024);
    const d = deps({ ws: { ...deps().ws, screenshot: () => png } });
    const r = await createLiveHost(d).screenshot(1024);
    expect(d.scale).toHaveBeenCalledWith(png, 2048, 1024, 1024);
    expect(r).toEqual({ dataUrl: 'data:image/png;base64,SMALL', width: 100, height: 50 });
  });

  it('screenshot: un PNG ilegible se trata como sin captura', async () => {
    const d = deps({ ws: { ...deps().ws, screenshot: () => 'data:image/png;base64,' } });
    expect(await createLiveHost(d).screenshot(1024)).toBeNull();
  });

  it('cardInfo looks in the Collection with the date of the last search', async () => {
    const info = { path: 'C:/lib/a.ifcx' } as never;
    const d = deps({
      searchLibrary: vi.fn(async () => [{ path: 'C:/lib/a.ifcx', name: 'a.ifcx', mtime: 7 }]),
      cardInfo: vi.fn(async () => info),
    });
    const host = createLiveHost(d);
    const found = await host.searchLibrary('a', 5);
    expect(found).toEqual([{ path: 'C:/lib/a.ifcx', name: 'a.ifcx' }]);
    expect(await host.cardInfo('C:/lib/a.ifcx')).toBe(info);
    expect(d.cardInfo).toHaveBeenCalledWith('C:/lib/a.ifcx', 7);
    expect(await host.cardInfo('C:/otra.ifcx')).toBeNull();
  });
});

describe('host real de Studio para el Asistente: escaleras', () => {
  const q = { from: 'N00', to: 'N01', shape: 'u' as const, width: 1.1, limit: 10 };
  const req = () => ({ items: [{ from: 'N00', to: 'N01', shape: 'u' as const, at: [3, 3] as [number, number], rotation: 0, width: 1.1 }] });

  it('stairSpots en un modelo que no es de Studio rechaza sin llamar al controlador', () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'foreign', idle: async () => {} } });
    expect(() => createLiveHost(d).stairSpots(q)).toThrow('not made in Dream BIM');
    expect(d.edit.stairSpots).not.toHaveBeenCalled();
  });

  it('placeStairs exige un modelo de Studio y usa asAgent al aplicar', async () => {
    const d = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'foreign', idle: async () => {} } });
    await expect(createLiveHost(d).placeStairs(req(), false)).rejects.toThrow('not made in Dream BIM');
    expect(d.edit.placeStairs).not.toHaveBeenCalled();
    const ok = deps();
    const asAgent = vi.fn(<T,>(fn: () => T): T => fn());
    ok.edit.asAgent = asAgent as <T>(fn: () => T) => T;
    await createLiveHost(ok).placeStairs(req(), false);
    expect(asAgent).toHaveBeenCalledTimes(1);
    expect(ok.edit.placeStairs).toHaveBeenCalledWith(expect.objectContaining({ items: expect.any(Array) }), false);
  });

  it('placeStairs con dryRun valida sin asAgent', async () => {
    const d = deps();
    const asAgent = vi.fn(<T,>(fn: () => T): T => fn());
    d.edit.asAgent = asAgent as <T>(fn: () => T) => T;
    await createLiveHost(d).placeStairs(req(), true);
    expect(asAgent).not.toHaveBeenCalled();
    expect(d.edit.placeStairs).toHaveBeenCalledWith(expect.anything(), true);
  });
});

describe('host real de Studio para el Asistente: revisiones', () => {
  it('reviewPlan espera a idle y no exige documento abierto', async () => {
    const order: string[] = [];
    const d = deps({
      doc: {
        hasDocument: false,
        isDirty: () => false,
        editable: () => 'readonly',
        idle: async () => {
          order.push('idle');
        },
      },
    });
    const plan = { lot: { width: 10, depth: 10 } } as never;
    const out = await createLiveHost(d).reviewPlan(plan);
    expect(order).toEqual(['idle']);
    expect(d.edit.reviewPlan).toHaveBeenCalledWith(plan);
    expect(out.buildKey).toBe('K');
  });

  it('reviewModel exige un modelo de Studio', async () => {
    const foreign = deps({ doc: { hasDocument: true, isDirty: () => false, editable: () => 'foreign', idle: async () => {} } });
    await expect(createLiveHost(foreign).reviewModel({})).rejects.toThrow('not made in Dream BIM');
    expect(foreign.edit.reviewModel).not.toHaveBeenCalled();
    const ok = deps();
    await createLiveHost(ok).reviewModel({ lot: { width: 10, depth: 10, setback: 0 } });
    expect(ok.edit.reviewModel).toHaveBeenCalledWith({ lot: { width: 10, depth: 10, setback: 0 } });
  });
});