import { describe, expect, it, vi } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import type { CardInfo } from '../src/collection/cardinfo';
import { createExecutor } from '../src/assistant/studio/executor';
import type { ModelSnapshot, StudioHost, ViewRequest } from '../src/assistant/studio/host';
import type { ElementColor } from '../src/render/coloroverride';
import type { MaterialDef } from '../src/materials/state';
import type { SpotResult } from '../src/modeling/stairspots';
import type { Review, ReviewOptions } from '../src/modeling/egress';
import type { Plan, PlanReview } from '../src/modeling/planreview';

const COMMANDS = [
  'help', 'model_info', 'find_elements', 'element', 'selection', 'layers', 'library_search', 'screenshot',
  'open_view', 'fit', 'select', 'set_toggle', 'set_layer_hidden', 'open_model',
  'provenance', 'highlight', 'clear_highlight', 'list_materials', 'set_color', 'assign_material', 'create_material',
  'build_model', 'walls', 'place_in_wall', 'place_furniture', 'stair_spots', 'place_stairs', 'delete_elements',
  'review_plan', 'review_model',
];

function node(name: string, cls: string | null, parent: ComposedNode | null, attrs: Record<string, unknown> = {}): ComposedNode {
  const n: ComposedNode = {
    path: `${parent ? parent.path : ''}/${name}`,
    name,
    origin: name,
    attributes: { ...(cls ? { 'bsi::ifc::class': { code: cls } } : {}), ...attrs },
    children: [],
    parent,
  };
  parent?.children.push(n);
  return n;
}

/** Proyecto › sitio › edificio › N00 (muros 0..walls0-1) y N01 (1 losa). */
function tree(walls0 = 2): { root: ComposedNode; n00: ComposedNode; n01: ComposedNode } {
  const root = node('p', 'IfcProject', null);
  const site = node('site', 'IfcSite', root);
  const b = node('b', 'IfcBuilding', site);
  const n00 = node('N00', 'IfcBuildingStorey', b);
  const n01 = node('N01', 'IfcBuildingStorey', b);
  for (let i = 0; i < walls0; i++) {
    node(`wall_${i}`, 'IfcWall', n00, {
      'bsi::ifc::prop::Name': `Muro ${i}`,
      'bsi::ifc::prop::Height': 3,
      'ifcx-studio::wall': { start: [0, i], end: [4, i], thickness: 0.2 },
    });
  }
  node('slab_0', 'IfcSlab', n01);
  return { root, n00, n01 };
}

class FakeHost implements StudioHost {
  calls: [string, ...unknown[]][] = [];
  snapshot: ModelSnapshot | null;
  folder: string | null = null;
  selected: string[] = [];
  materialList: { code: string; name: string; color: string; opacity: number; elements: number }[] = [];
  writeError: Error | null = null;
  shot: { dataUrl: string; width: number; height: number } | null = { dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 5 };
  openError: Error | null = null;
  layerList = [{ id: 'l1', name: 'ARQ', uri: 'a.ifcx', enabled: true, hidden: false }];
  library: { path: string; name: string }[] = [];
  cards = new Map<string, CardInfo>();

  constructor(root?: ComposedNode) {
    this.snapshot = root ? { name: 'Torre', path: 'C:/t.ifcx', dirty: false, editable: 'studio', root } : null;
  }
  model() { return this.snapshot; }
  levels() { return [{ name: 'N00', elevation: 0, path: '/p/site/b/N00' }, { name: 'N01', elevation: 3, path: '/p/site/b/N01' }]; }
  selection() { return this.selected; }
  select(path: string | null) { this.calls.push(['select', path]); this.selected = path ? [path] : []; }
  selectMany(paths: string[]) { this.calls.push(['selectMany', paths]); this.selected = paths; }
  provenance(path: string) { this.calls.push(['provenance', path]); return { sources: ['model.ifcx'], attributes: { 'bsi::ifc::prop::Name': { from: 'model.ifcx' } } }; }
  highlight(paths: string[], c: ElementColor) { this.calls.push(['highlight', paths, c]); }
  clearHighlight(paths?: string[]) { this.calls.push(['clearHighlight', paths]); }
  materials() { return this.materialList; }
  async setColor(paths: string[], c: ElementColor | null) {
    this.calls.push(['setColor', paths, c]);
    if (this.writeError) throw this.writeError;
  }
  async assignMaterial(paths: string[], code: string | null) {
    this.calls.push(['assignMaterial', paths, code]);
    if (this.writeError) throw this.writeError;
  }
  async createMaterial(def: MaterialDef) {
    this.calls.push(['createMaterial', def]);
    if (this.writeError) throw this.writeError;
  }
  buildModel = vi.fn(async () => ({ levels: 0, walls: 0, floors: 0, levelIds: [] }));
  placePieces = vi.fn(async () => ({
    summary: { total: 1, targets: 1, pieces: [{ name: 'Door', ifc_class: 'IfcDoor', count: 1, width: 1, height: 2.1 }] },
    ids: ['c1'],
  }));
  stairSpots = vi.fn((): SpotResult => ({
    risers: 17,
    riser: 3 / 17,
    spots: [{ origin: [3, 3] as [number, number], angle: 0, stacked: false, walls: 1, length: 3.34, depth: 2.3 }],
  }));
  placeStairs = vi.fn(async () => ({
    summary: {
      total: 1,
      stairs: [{ from: 'N00', to: 'N01', shape: 'u' as const, risers: 17, riser: 3 / 17, width: 1.1, railings: 8, handrails: 3 }],
      openings: 1,
    },
    ids: ['s1'],
  }));
  deleteElements = vi.fn(async (paths: string[]) => paths.length);
  reviewPlan = vi.fn(async (_plan: Plan): Promise<PlanReview> => ({
    review: { ok: true, checks: [], exits: 1, levels: [{ level: 'N00', rooms: 1, apartments: 1, common: 0, max_travel: 3 }] },
    stairs: [{ from: 'N00', to: 'N01', shape: 'u', at: [3, 3], rotation: 0, width: 1.1 }],
    buildKey: 'KEY',
  }));
  reviewModel = vi.fn(async (_opts: ReviewOptions): Promise<Review> => ({ ok: true, checks: [], exits: 1, levels: [] }));
  openView(v: ViewRequest) { this.calls.push(['openView', v]); }
  fit(path: string | null) { this.calls.push(['fit', path]); }
  setToggle(name: string, on: boolean) { this.calls.push(['setToggle', name, on]); }
  layers() { return this.layerList; }
  setLayerHidden(id: string, hidden: boolean) {
    this.calls.push(['setLayerHidden', id, hidden]);
    return this.layerList.some((l) => l.id === id);
  }
  async screenshot(maxSize: number) { this.calls.push(['screenshot', maxSize]); return this.shot; }
  libraryFolder() { return this.folder; }
  async searchLibrary(query: string, limit: number) { this.calls.push(['searchLibrary', query, limit]); return this.library; }
  async cardInfo(path: string) { return this.cards.get(path) ?? null; }
  async openModel(path: string) {
    this.calls.push(['openModel', path]);
    if (this.openError) throw this.openError;
  }
}

const run = (host: StudioHost, command: string, args: unknown = {}) => createExecutor(host).run(command, args);
const ok = async (host: StudioHost, command: string, args: unknown = {}) => {
  const r = await run(host, command, args);
  if (!r.ok) throw new Error(`esperaba ok, vino: ${r.error}`);
  return r.result as any;
};
const err = async (host: StudioHost, command: string, args: unknown = {}) => {
  const r = await run(host, command, args);
  if (r.ok) throw new Error('esperaba un error');
  return r.error;
};

describe('ejecutor de comandos de Studio', () => {
  it('help lista todos los comandos con sus argumentos', async () => {
    const r = await ok(new FakeHost(tree().root), 'help');
    expect(r.commands.map((c: { name: string }) => c.name).sort()).toEqual([...COMMANDS].sort());
    for (const c of r.commands) {
      expect(typeof c.args).toBe('string');
      expect(c.description.length).toBeGreaterThan(5);
    }
  });

  it('an unknown command says how to continue', async () => {
    expect(await err(new FakeHost(), 'make_coffee')).toBe("Unknown command 'make_coffee'. Run 'help' to list commands.");
  });

  it('args que no es un objeto se rechaza', async () => {
    expect(await err(new FakeHost(), 'help', 'x')).toBe('help: args must be an object');
    expect(await err(new FakeHost(), 'help', [1])).toBe('help: args must be an object');
  });

  it('sin modelo lo dice', async () => {
    const host = new FakeHost();
    for (const c of ['model_info', 'find_elements']) expect(await err(host, c)).toBe('No model is open');
    expect(await err(host, 'open_view', { kind: '3d' })).toBe('No model is open');
    // even if it asks for a level: the cause is that there is no model, not that the level does not exist (without a model there are no levels)
    host.levels = () => [];
    expect(await err(host, 'find_elements', { level: 'N01' })).toBe('No model is open');
  });

  it('un nivel desconocido en un modelo sin niveles lo dice', async () => {
    const host = new FakeHost(tree().root);
    host.levels = () => [];
    expect(await err(host, 'find_elements', { level: 'N1' })).toBe("Unknown level 'N1'. The model has no levels");
  });

  it('los nombres y rutas largos se cortan a 200 caracteres', async () => {
    const { root, n00 } = tree(0);
    node('y'.repeat(300), 'IfcWall', n00);
    const host = new FakeHost(root);
    const r = await ok(host, 'find_elements', { ifc_class: 'IfcWall' });
    expect(r.items[0].name).toHaveLength(201);
    expect(r.items[0].path).toHaveLength(201);
    host.selected = [r.items[0].path];
    expect(r.items[0].path.endsWith('…')).toBe(true);
  });

  it('model_info cuenta clases y niveles', async () => {
    const r = await ok(new FakeHost(tree().root), 'model_info');
    expect(r).toMatchObject({ name: 'Torre', path: 'C:/t.ifcx', dirty: false, editable: 'studio', elements: 3 });
    expect(r.classes).toEqual({ IfcWall: 2, IfcSlab: 1 });
    expect(r.levels.map((l: { name: string }) => l.name)).toEqual(['N00', 'N01']);
  });

  it('find_elements filtra por clase, nombre y nivel', async () => {
    const host = new FakeHost(tree().root);
    const muros = await ok(host, 'find_elements', { ifc_class: 'ifcwall' });
    expect(muros.total).toBe(2);
    expect(muros.items[0]).toEqual({ path: '/p/site/b/N00/wall_0', name: 'wall_0', ifc_class: 'IfcWall', level: 'N00' });
    // the name is also looked up in the IFC Name, which is what the user sees in Properties
    expect((await ok(host, 'find_elements', { name: 'MURO 1' })).items.map((i: { name: string }) => i.name)).toEqual(['wall_1']);
    expect((await ok(host, 'find_elements', { level: 'n01' })).items.map((i: { ifc_class: string }) => i.ifc_class)).toEqual(['IfcSlab']);
  });

  it('find_elements respeta limit y da el total real', async () => {
    const host = new FakeHost(tree(300).root);
    const por_defecto = await ok(host, 'find_elements', { ifc_class: 'IfcWall' });
    expect(por_defecto.items).toHaveLength(50);
    expect(por_defecto.total).toBe(300);
    const mucho = await ok(host, 'find_elements', { ifc_class: 'IfcWall', limit: 500 });
    expect(mucho.items).toHaveLength(200);
    expect(mucho.total).toBe(300);
  });

  it('find_elements with a level that does not exist lists the levels', async () => {
    expect(await err(new FakeHost(tree().root), 'find_elements', { level: 'N9' })).toBe("Unknown level 'N9'. Levels: N00, N01");
  });

  it('element corta los textos largos y devuelve solo valores simples', async () => {
    const { root, n00 } = tree();
    const w = node('wall_x', 'IfcWall', n00, { largo: 'x'.repeat(500), n: 3, b: true, obj: { a: 1 }, lista: [1] });
    const r = await ok(new FakeHost(root), 'element', { path: w.path });
    expect(r).toMatchObject({ path: w.path, name: 'wall_x', ifc_class: 'IfcWall', level: 'N00', children: 0 });
    expect(r.attributes.largo).toHaveLength(201); // 200 + «…»
    expect(r.attributes.n).toBe(3);
    expect(r.attributes.b).toBe(true);
    expect('obj' in r.attributes).toBe(false);
    expect('lista' in r.attributes).toBe(false);
  });

  it('element con una ruta inexistente', async () => {
    expect(await err(new FakeHost(tree().root), 'element', { path: '/x' })).toBe("No element at '/x'");
    expect(await err(new FakeHost(tree().root), 'element', {})).toBe("element: 'path' must be string");
  });

  it('selection returns total, primary and items; without a selection, empty', async () => {
    const host = new FakeHost(tree().root);
    expect(await ok(host, 'selection')).toEqual({ total: 0, primary: null, items: [] });
    host.selected = ['/p/site/b/N00/wall_0', '/p/site/b/N00/wall_1'];
    const r = await ok(host, 'selection');
    expect(r.total).toBe(2);
    expect(r.primary).toBe('/p/site/b/N00/wall_1');
    expect(r.items.map((i: { name: string }) => i.name)).toEqual(['wall_0', 'wall_1']);
    expect(r.items[0]).toMatchObject({ path: '/p/site/b/N00/wall_0', ifc_class: 'IfcWall', level: 'N00' });
  });

  it('select y fit validan la ruta y llaman al host', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'select', { path: '/x' })).toBe("No element at '/x'");
    expect(await ok(host, 'select', { path: '/p/site/b/N00/wall_0' })).toEqual({ total: 1, primary: '/p/site/b/N00/wall_0' });
    expect(await ok(host, 'select', { path: null })).toEqual({ total: 0, primary: null });
    await ok(host, 'fit');
    await ok(host, 'fit', { path: '/p/site/b/N00/wall_0' });
    expect(host.calls).toEqual([
      ['select', '/p/site/b/N00/wall_0'], ['select', null], ['fit', null], ['fit', '/p/site/b/N00/wall_0'],
    ]);
  });

  it('open_view plan con un nivel desconocido lista los niveles', async () => {
    expect(await err(new FakeHost(tree().root), 'open_view', { kind: 'plan', level: 'N9' })).toBe("Unknown level 'N9'. Levels: N00, N01");
  });

  it('open_view traduce las vistas al host', async () => {
    const host = new FakeHost(tree().root);
    await ok(host, 'open_view', { kind: 'plan', level: 'n01' });
    await ok(host, 'open_view', { kind: 'plan' });
    await ok(host, 'open_view', { kind: 'front' });
    await ok(host, 'open_view', { kind: 'side' });
    await ok(host, 'open_view', { kind: '3d' });
    expect(host.calls).toEqual([
      ['openView', { kind: 'plan', level: 'N01' }],
      ['openView', { kind: 'plan', level: null }],
      ['openView', { kind: 'elevation', side: 'front' }],
      ['openView', { kind: 'elevation', side: 'side' }],
      ['openView', { kind: '3d' }],
    ]);
    expect(await err(host, 'open_view', { kind: 'roof' })).toBe("open_view: 'kind' must be one of 3d, plan, front, side");
  });

  it('set_toggle valida el tipo y el nombre', async () => {
    const host = new FakeHost();
    expect(await err(host, 'set_toggle', { name: 'xray', on: 'yes' })).toBe("set_toggle: 'on' must be boolean");
    expect(await err(host, 'set_toggle', { name: 'fog', on: true })).toBe("set_toggle: 'name' must be one of xray, section, shadows, grid");
    expect(await ok(host, 'set_toggle', { name: 'xray', on: true })).toEqual({ name: 'xray', on: true });
    expect(host.calls).toEqual([['setToggle', 'xray', true]]);
  });

  it('layers y set_layer_hidden', async () => {
    const host = new FakeHost();
    expect(await ok(host, 'layers')).toEqual(host.layerList);
    expect(await ok(host, 'set_layer_hidden', { id: 'l1', hidden: true })).toEqual({ id: 'l1', hidden: true });
    expect(await err(host, 'set_layer_hidden', { id: 'zz', hidden: true })).toBe("Unknown layer 'zz'. Layers: l1");
  });

  it('screenshot uses 1024 by default and warns if there is no view', async () => {
    const host = new FakeHost(tree().root);
    expect(await ok(host, 'screenshot')).toEqual({ image: 'data:image/png;base64,AAAA', width: 10, height: 5 });
    await ok(host, 'screenshot', { max_size: 512 });
    await ok(host, 'screenshot', { max_size: 4096 }); // the API rejects images of more than ~5 MB: cap at 1568
    expect(host.calls).toEqual([['screenshot', 1024], ['screenshot', 512], ['screenshot', 1568]]);
    host.shot = null;
    expect(await err(host, 'screenshot')).toBe('No view to capture');
  });

  it('library_search sin carpeta abierta', async () => {
    expect(await err(new FakeHost(), 'library_search', { query: 'silla' })).toBe('No library folder is open in the Library panel');
  });

  it('library_search adds class and measures of the Collection and respects the limit', async () => {
    const host = new FakeHost();
    host.folder = 'C:/lib';
    host.library = [{ path: 'C:/lib/silla.ifcx', name: 'silla.ifcx' }, { path: 'C:/lib/otra.ifcx', name: 'otra.ifcx' }];
    host.cards.set('C:/lib/silla.ifcx', { ifcClass: 'IfcFurniture', dims: { width: 0.5, depth: 0.5, height: 0.9 } } as CardInfo);
    const r = await ok(host, 'library_search', { query: 'silla', limit: 999 });
    expect(r.folder).toBe('C:/lib');
    expect(r.items).toEqual([
      { path: 'C:/lib/silla.ifcx', name: 'silla.ifcx', ifc_class: 'IfcFurniture', dims: { width: 0.5, depth: 0.5, height: 0.9 } },
      { path: 'C:/lib/otra.ifcx', name: 'otra.ifcx', ifc_class: null, dims: null },
    ]);
    expect(host.calls).toEqual([['searchLibrary', 'silla', 100]]);
  });

  it('open_model exige un .ifcx y devuelve el error del host tal cual', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'open_model', { path: 'C:/a.txt' })).toBe("open_model: 'path' must be an .ifcx file");
    host.openError = new Error('The open model has unsaved changes: ask the user to save or discard them first');
    expect(await err(host, 'open_model', { path: 'C:/a.ifcx' })).toBe('The open model has unsaved changes: ask the user to save or discard them first');
    host.openError = null;
    expect(await ok(host, 'open_model', { path: 'C:/a.ifcx' })).toEqual({ name: 'Torre' });
  });

  describe('selection, provenance, color and materials', () => {
    const W0 = '/p/site/b/N00/wall_0';
    const W1 = '/p/site/b/N00/wall_1';
    const S0 = '/p/site/b/N01/slab_0';
    const RED = { color: '#ff0000', opacity: 1 };
    const writes = (h: FakeHost) => h.calls.filter((c) => ['setColor', 'assignMaterial', 'createMaterial'].includes(c[0]));

    it('select with filters selects everything that matches and add joins with the selection', async () => {
      const host = new FakeHost(tree(3).root);
      expect(await ok(host, 'select', { ifc_class: 'IfcWall', level: 'N00' })).toMatchObject({ total: 3 });
      expect(host.selected).toHaveLength(3);
      expect(await ok(host, 'select', { ifc_class: 'IfcSlab', add: true })).toMatchObject({ total: 4, primary: S0 });
      expect(host.selected.at(-1)).toBe(S0);
    });

    it('select con paths valida cada ruta; sin argumentos o sin coincidencias falla', async () => {
      const host = new FakeHost(tree().root);
      expect(await ok(host, 'select', { paths: [W0, W1] })).toEqual({ total: 2, primary: W1 });
      expect(await err(host, 'select', { paths: [W0, '/x'] })).toBe("No element at '/x'");
      expect(await err(host, 'select', {})).toBe("select: give 'path', 'paths' or a filter");
      expect(await err(host, 'select', { name: 'no existe' })).toBe('select: nothing matches the filter');
      expect(host.selected).toEqual([W0, W1]);
    });

    it('provenance uses the selection by default and returns sources and origin of attributes', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0];
      const r = await ok(host, 'provenance');
      expect(r.total).toBe(1);
      expect(r.items[0]).toMatchObject({ path: W0, name: 'wall_0', sources: ['model.ifcx'] });
      expect(r.items[0].attributes['bsi::ifc::prop::Name']).toEqual({ from: 'model.ifcx' });
      expect(await err(new FakeHost(tree().root), 'provenance')).toBe('Nothing is selected');
    });

    it('highlight valida el color y llama al host con las rutas; clear_highlight lo quita', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0, W1];
      expect(await ok(host, 'highlight', { color: '#FF0000' })).toEqual({ count: 2 });
      expect(host.calls).toContainEqual(['highlight', [W0, W1], { color: '#ff0000', opacity: 1 }]);
      expect(await err(host, 'highlight', { color: 'rojo' })).toBe("highlight: 'color' must be '#rrggbb'");
      expect(await err(host, 'highlight', { color: '#ff0000', opacity: 2 })).toBe("highlight: 'opacity' must be a number between 0 and 1");
      expect(await ok(host, 'clear_highlight')).toEqual({ ok: true });
      expect(host.calls).toContainEqual(['clearHighlight', undefined]);
      expect(await ok(host, 'clear_highlight', { paths: [W0] })).toEqual({ ok: true });
      expect(host.calls).toContainEqual(['clearHighlight', [W0]]);
      expect(await err(host, 'clear_highlight', { paths: 'x' })).toBe("clear_highlight: 'paths' must be an array of strings");
    });

    it('set_color without a selection fails with Nothing is selected and does not call the host', async () => {
      const host = new FakeHost(tree().root);
      expect(await err(host, 'set_color', RED)).toBe('Nothing is selected');
      expect(writes(host)).toEqual([]);
    });

    it('set_color with a bad path fails naming it and edits nothing', async () => {
      const host = new FakeHost(tree().root);
      expect(await err(host, 'set_color', { ...RED, paths: [W0, '/p/no-existe'] })).toBe("No element at '/p/no-existe'");
      expect(writes(host)).toEqual([]);
    });

    it('en un modelo de solo lectura las escrituras fallan sin llamar al host', async () => {
      const host = new FakeHost(tree().root);
      host.snapshot!.editable = 'readonly';
      host.selected = [W0];
      for (const [cmd, args] of [['set_color', RED], ['assign_material', { code: null }], ['create_material', { code: 'A', name: 'A', color: '#000000' }]] as const) {
        expect(await err(host, cmd, args)).toBe('The model is read-only');
      }
      expect(writes(host)).toEqual([]);
    });

    it('set_color uses the selection, normalizes the color and counts; null removes', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0, W1];
      expect(await ok(host, 'set_color', { color: '#0000FF', opacity: 0.5 })).toEqual({ count: 2 });
      expect(host.calls).toContainEqual(['setColor', [W0, W1], { color: '#0000ff', opacity: 0.5 }]);
      expect(await ok(host, 'set_color', { color: null, paths: [W0] })).toEqual({ count: 1 });
      expect(host.calls).toContainEqual(['setColor', [W0], null]);
      expect(await err(host, 'set_color', { color: '#12', paths: [W0] })).toBe("set_color: 'color' must be '#rrggbb'");
      expect(await err(host, 'set_color', { color: '#ff0000', paths: [] })).toBe("set_color: 'paths' must be a non-empty array of strings");
    });

    it('a saved color or a material removes the temporary highlight of those elements (otherwise it would cover it)', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0, W1];
      host.materialList = [{ code: 'GLASS', name: 'Glass', color: '#9ec9e8', opacity: 0.4, elements: 0 }];
      await ok(host, 'set_color', RED);
      expect(host.calls).toContainEqual(['clearHighlight', [W0, W1]]);
      host.calls.length = 0;
      await ok(host, 'assign_material', { code: 'GLASS', paths: [W1] });
      expect(host.calls).toContainEqual(['clearHighlight', [W1]]);
    });

    it('si la escritura falla no se toca el resaltado', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0];
      host.writeError = new Error('boom');
      await err(host, 'set_color', RED);
      expect(host.calls.some((c) => c[0] === 'clearHighlight')).toBe(false);
    });

    it('un error del host llega tal cual al agente', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [W0];
      host.writeError = new Error('Dream BIM could not apply the change; the user has been shown why');
      expect(await err(host, 'set_color', RED)).toBe('Dream BIM could not apply the change; the user has been shown why');
    });

    it('list_materials and assign_material: an unknown code lists the ones that exist', async () => {
      const host = new FakeHost(tree().root);
      host.selected = [S0];
      expect(await err(host, 'assign_material', { code: 'C30' })).toBe("Unknown material 'C30'. The model has no materials");
      host.materialList = [{ code: 'GLASS', name: 'Glass', color: '#9ec9e8', opacity: 0.4, elements: 0 }];
      expect((await ok(host, 'list_materials')).materials).toEqual(host.materialList);
      expect(await err(host, 'assign_material', { code: 'C30' })).toBe("Unknown material 'C30'. Materials: GLASS");
      expect(await ok(host, 'assign_material', { code: 'GLASS' })).toEqual({ count: 1, code: 'GLASS' });
      expect(await ok(host, 'assign_material', { code: null, paths: [W0] })).toEqual({ count: 1, code: null });
      expect(host.calls).toContainEqual(['assignMaterial', [S0], 'GLASS']);
      expect(host.calls).toContainEqual(['assignMaterial', [W0], null]);
      expect(await err(host, 'assign_material', {})).toBe("assign_material: 'code' must be string");
    });

    it('create_material validates and rejects a repeated code', async () => {
      const host = new FakeHost(tree().root);
      expect(await ok(host, 'create_material', { code: 'C30', name: 'Concrete C30', color: '#8A8A8A' })).toEqual({ code: 'C30' });
      expect(host.calls).toContainEqual(['createMaterial', { code: 'C30', name: 'Concrete C30', color: '#8a8a8a', opacity: 1 }]);
      host.materialList = [{ code: 'C30', name: 'Concrete C30', color: '#8a8a8a', opacity: 1, elements: 0 }];
      expect(await err(host, 'create_material', { code: 'C30', name: 'Otro', color: '#000000' })).toBe("Material 'C30' already exists");
      expect(await err(host, 'create_material', { name: 'X', color: '#000000' })).toBe("create_material: 'code' must be string");
    });

    it('sin modelo, las escrituras y la procedencia lo dicen', async () => {
      const host = new FakeHost();
      for (const c of ['provenance', 'set_color', 'assign_material', 'list_materials']) {
        expect(await err(host, c, c === 'assign_material' ? { code: null } : RED)).toBe('No model is open');
      }
    });
  });
});


const BUILD_ARGS = {
  levels: [
    { name: 'L1', elevation: 0, layout: 'a' },
    { name: 'L2', elevation: 3, layout: 'a' },
  ],
  layouts: {
    a: {
      walls: [
        { from: [0, 0], to: [10, 0], thickness: 0.3 },
        { from: [10, 0], to: [10, 6], thickness: 0.3 },
        { from: [10, 6], to: [0, 6], thickness: 0.3 },
        { from: [0, 6], to: [0, 0], thickness: 0.3 },
      ],
      floors: [[[0, 0], [10, 0], [10, 6], [0, 6]]],
    },
  },
};

const preview = (host: StudioHost, command: string, args: unknown = {}) => createExecutor(host).preview(command, args);

describe('build_model y delete_elements', () => {
  const W0 = '/p/site/b/N00/wall_0';
  const W1 = '/p/site/b/N00/wall_1';

  it('build_model construye, pasa a 3D, encuadra y devuelve el resumen', async () => {
    const host = new FakeHost(tree().root);
    const out = await ok(host, 'build_model', BUILD_ARGS);
    expect(out).toMatchObject({ new: true, totals: { levels: 2, walls: 8, floors: 2 } });
    expect(host.buildModel).toHaveBeenCalledTimes(1);
    expect(host.calls).toContainEqual(['openView', { kind: '3d' }]);
    expect(host.calls).toContainEqual(['fit', null]);
  });

  it('an invalid build_model returns the error and does not call the host', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'build_model', { levels: [] })).toBe("build_model: 'levels' must be a non-empty array");
    expect(host.buildModel).not.toHaveBeenCalled();
    expect(host.calls).not.toContainEqual(['openView', { kind: '3d' }]);
  });

  it('build_model devuelve tal cual el rechazo del host', async () => {
    const host = new FakeHost(tree().root);
    host.buildModel.mockRejectedValueOnce(new Error('The open model has unsaved changes: ask the user to save or discard them first'));
    expect(await err(host, 'build_model', BUILD_ARGS)).toBe(
      'The open model has unsaved changes: ask the user to save or discard them first',
    );
    expect(host.calls).not.toContainEqual(['openView', { kind: '3d' }]);
  });

  it('preview de build_model devuelve el resumen sin tocar el host', async () => {
    const host = new FakeHost(tree().root);
    expect(await preview(host, 'build_model', BUILD_ARGS)).toMatchObject({ ok: true, summary: { totals: { walls: 8 } } });
    expect(host.buildModel).not.toHaveBeenCalled();
  });

  it('preview of an invalid build_model returns the error', async () => {
    const host = new FakeHost(tree().root);
    expect(await preview(host, 'build_model', { levels: [] })).toEqual({
      ok: false,
      error: "build_model: 'levels' must be a non-empty array",
    });
  });

  it('preview de otro comando no tiene resumen', async () => {
    expect(await preview(new FakeHost(tree().root), 'set_color', {})).toEqual({ ok: true, summary: null });
  });

  it('preview de un comando inexistente falla', async () => {
    expect(await preview(new FakeHost(tree().root), 'x', {})).toEqual({
      ok: false,
      error: "Unknown command 'x'. Run 'help' to list commands.",
    });
  });

  it('delete_elements borra la selecci�n si no hay paths', async () => {
    const host = new FakeHost(tree().root);
    host.selected = [W0, W1];
    expect(await ok(host, 'delete_elements')).toEqual({ count: 2 });
    expect(host.deleteElements).toHaveBeenCalledWith([W0, W1]);
    expect(host.calls).toContainEqual(['clearHighlight', [W0, W1]]);
  });

  it('delete_elements se niega en solo lectura', async () => {
    const host = new FakeHost(tree().root);
    host.snapshot!.editable = 'readonly';
    host.selected = [W0];
    expect(await err(host, 'delete_elements')).toBe('The model is read-only');
    expect(host.deleteElements).not.toHaveBeenCalled();
  });

  it('help lista build_model y delete_elements', async () => {
    const out = await ok(new FakeHost(tree().root), 'help');
    const names = out.commands.map((c: { name: string }) => c.name);
    expect(names).toContain('build_model');
    expect(names).toContain('delete_elements');
    expect(names).toContain('walls');
    expect(names).toContain('place_in_wall');
    expect(names).toContain('place_furniture');
  });

  it('walls lista inicio, fin y longitud y filtra por nivel', async () => {
    const host = new FakeHost(tree().root);
    const out = await ok(host, 'walls');
    expect(out.total).toBe(2);
    expect(out.items[0]).toMatchObject({
      path: W0, level: 'N00', start: [0, 0], end: [4, 0], length: 4, thickness: 0.2, height: 3, pieces: [],
    });
    expect(await ok(host, 'walls', { level: 'N01' })).toEqual({ total: 0, items: [] });
    expect(await err(host, 'walls', { level: 'N9' })).toBe("Unknown level 'N9'. Levels: N00, N01");
  });

  it('place_in_wall con items mal formado no llama al host', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'place_in_wall', { items: [] })).toBe(
      "place_in_wall: 'items' must be an array of 1 to 200 pieces",
    );
    expect(await err(host, 'place_furniture', { items: [] })).toBe(
      "place_furniture: 'items' must be an array of 1 to 200 pieces",
    );
    expect(host.placePieces).not.toHaveBeenCalled();
  });

  it('place_in_wall: preview llama con dryRun true y run con false', async () => {
    const host = new FakeHost(tree().root);
    const args = { items: [{ asset: '/lib/door.ifcx', wall: W0, offset: 1 }] };
    expect(await preview(host, 'place_in_wall', args)).toMatchObject({ ok: true, summary: { total: 1 } });
    expect(host.placePieces).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'wall' }), true);
    const out = await ok(host, 'place_in_wall', args);
    expect(host.placePieces).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'wall' }), false);
    expect(out).toMatchObject({ total: 1, targets: 1, paths: [] });
  });

  it('place_furniture: preview llama con dryRun true y run con false', async () => {
    const host = new FakeHost(tree().root);
    const args = { items: [{ asset: '/lib/chair.ifcx', level: 'N00', at: [2, 3] }] };
    expect(await preview(host, 'place_furniture', args)).toMatchObject({ ok: true, summary: { total: 1 } });
    expect(host.placePieces).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'floor' }), true);
    await ok(host, 'place_furniture', args);
    expect(host.placePieces).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'floor' }), false);
  });

  it('a host error when placing arrives as { ok: false, error }', async () => {
    const host = new FakeHost(tree().root);
    host.placePieces.mockRejectedValueOnce(new Error('The piece does not fit there in its wall'));
    expect(await err(host, 'place_in_wall', { items: [{ asset: '/lib/door.ifcx', wall: W0, offset: 1 }] })).toBe(
      'The piece does not fit there in its wall',
    );
  });

  it('place_in_wall se niega en solo lectura', async () => {
    const host = new FakeHost(tree().root);
    host.snapshot!.editable = 'readonly';
    expect(await err(host, 'place_in_wall', { items: [{ asset: '/lib/door.ifcx', wall: W0, offset: 1 }] })).toBe(
      'The model is read-only',
    );
    expect(host.placePieces).not.toHaveBeenCalled();
  });
});

describe('stair_spots y place_stairs', () => {
  const args = { items: [{ from: 'N00', to: 'N01', shape: 'u', at: [3, 3] }] };

  it('help los lista y stair_spots pasa los argumentos al host', async () => {
    const host = new FakeHost(tree().root);
    const help = await ok(host, 'help');
    const names = help.commands.map((c: { name: string }) => c.name);
    expect(names).toContain('stair_spots');
    expect(names).toContain('place_stairs');
    const r = await ok(host, 'stair_spots', { from: 'N00', to: 'N01', shape: 'u' });
    expect(host.stairSpots).toHaveBeenCalledWith({ from: 'N00', to: 'N01', shape: 'u', width: 1.1, limit: 10 });
    expect(r.risers).toBe(17);
    expect(r.spots[0]).toEqual({ at: [3, 3], rotation: 0, stacked: false, walls: 1, length: 3.34, depth: 2.3 });
    host.stairSpots.mockReturnValueOnce({ risers: 0, riser: 0, spots: [], reason: 'no room' });
    expect(await ok(host, 'stair_spots', { from: 'N00', to: 'N01', shape: 'straight' })).toMatchObject({ spots: [], reason: 'no room' });
  });

  it('stair_spots con argumentos mal formados no llama al host', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'stair_spots', { from: 'N00', to: 'N01', shape: 'x' })).toBe(
      "stair_spots: 'shape' must be 'straight' or 'u'",
    );
    expect(host.stairSpots).not.toHaveBeenCalled();
  });

  it('place_stairs: preview con dryRun true y run con false', async () => {
    const host = new FakeHost(tree().root);
    expect(await preview(host, 'place_stairs', args)).toMatchObject({ ok: true, summary: { total: 1 } });
    expect(host.placeStairs).toHaveBeenLastCalledWith(expect.objectContaining({ items: [expect.objectContaining({ shape: 'u' })] }), true);
    const out = await ok(host, 'place_stairs', args);
    expect(host.placeStairs).toHaveBeenLastCalledWith(expect.objectContaining({ items: expect.any(Array) }), false);
    expect(out).toMatchObject({ total: 1, openings: 1, paths: [] });
  });

  it('place_stairs inv�lido o en solo lectura no llama al host', async () => {
    const host = new FakeHost(tree().root);
    expect(await err(host, 'place_stairs', { items: [] })).toBe(
      "place_stairs: 'items' must be an array of 1 to 20 stairs",
    );
    host.snapshot!.editable = 'readonly';
    expect(await err(host, 'place_stairs', args)).toBe('The model is read-only');
    expect(host.placeStairs).not.toHaveBeenCalled();
  });
});

describe('review_plan y review_model', () => {
  const plan = {
    lot: { width: 14, depth: 12 },
    apartments: { N00: 2 },
    build: { levels: [{ name: 'N00', elevation: 0, layout: 'a' }], layouts: { a: { walls: [], floors: [] } } },
    stairs: [{ from: 'N00', to: 'N01', shape: 'u' }],
  };

  it('review_plan sin build falla sin llamar al host', async () => {
    const host = new FakeHost();
    expect(await err(host, 'review_plan', { lot: { width: 10, depth: 10 } })).toBe(
      "review_plan: 'build' is required",
    );
    expect(host.reviewPlan).not.toHaveBeenCalled();
  });

  it('review_plan returns the report with the stairs and the key of the build', async () => {
    const host = new FakeHost(tree().root);
    const out = await ok(host, 'review_plan', plan);
    expect(host.reviewPlan).toHaveBeenCalledWith(expect.objectContaining({ build: expect.objectContaining({ fresh: true }) }));
    expect(out).toMatchObject({ ok: true, exits: 1, build_key: 'KEY', stairs: [{ at: [3, 3], rotation: 0 }] });
  });

  it('review_model valida las opciones y las pasa al host', async () => {
    const host = new FakeHost(tree().root);
    const out = await ok(host, 'review_model', {
      lot: { width: 10, depth: 20 },
      apartments: { N00: 2 },
      limits: { maxTravel: 30 },
    });
    expect(host.reviewModel).toHaveBeenCalledWith({
      lot: { width: 10, depth: 20, setback: 0 },
      apartments: { N00: 2 },
      limits: { maxTravel: 30 },
    });
    expect(out).toEqual({ ok: true, checks: [], exits: 1, levels: [] });
    expect(await err(host, 'review_model', { lot: { width: 0, depth: 1 } })).toBe(
      "review_model: 'lot' needs width and depth in meters",
    );
  });
});