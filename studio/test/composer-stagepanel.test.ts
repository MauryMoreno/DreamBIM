import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { mountStagePanel, type StageData } from '../src/composer/stagepanel';
import { DOCUMENT_COLOR, LAYER_COLORS } from '../src/composer/stack';
import { LAYER_DRAG_TYPE } from '../src/composer/rows';
import { mountLibraryPanel } from '../src/library/librarypanel';

/** neither it nor its parents have an origin */
function node(parent: ComposedNode | null, name: string, origin: string, attributes: Record<string, unknown> = {}): ComposedNode {
  const n: ComposedNode = { path: parent ? `${parent.path}/${name}` : '', name, origin, attributes, children: [], parent };
  parent?.children.push(n);
  return n;
}

/** root / proj / site / bldg / storey / {wall, door}; y un archivo enlazado "ext" con una viga. */
function model() {
  const root = node(null, 'root', '');
  const proj = node(root, 'proj', 'proj');
  const site = node(proj, 'site', 'site');
  const bldg = node(site, 'bldg', 'bldg');
  const storey = node(bldg, 'storey', 'storey');
  const wall = node(storey, 'wall', 'wall', { 'bsi::ifc::class': { code: 'IfcWall' } });
  const door = node(storey, 'door', 'door', { 'bsi::ifc::prop::Name': 'Puerta' });
  const ext = node(root, 'ext', 'ext');
  const beam = node(ext, 'beam', 'beam');
  return { root, proj, site, bldg, storey, wall, door, ext, beam };
}

function data(m = model(), over: Partial<StageData> = {}): StageData {
  return {
    root: m.root,
    sourceOf: new Map([['proj', 'document'], ['site', 'document'], ['bldg', 'document'], ['storey', 'document'],
      ['wall', 'document'], ['door', 'document'], ['ext', '1'], ['beam', '1']]),
    colors: new Map([['document', DOCUMENT_COLOR], ['1', LAYER_COLORS[2]]]),
    marks: new Map(),
    ...over,
  };
}

function setup() {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const cb = { onSelect: vi.fn(), onFit: vi.fn(), onHiddenChange: vi.fn() };
  const stage = mountStagePanel(host, cb);
  return { host, cb, stage };
}

const row = (host: HTMLElement, origin: string) => host.querySelector<HTMLElement>(`.stage-row[data-origin="${origin}"]`);
const swatch = (r: HTMLElement) => r.querySelector<HTMLElement>('.layer-swatch')!.style.getPropertyValue('--layer-color');

describe('mountStagePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('without a model shows No model loaded', () => {
    const { host, stage } = setup();
    stage.setStage({ root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() });
    expect(host.textContent).toContain('No model loaded');
    stage.setStage(data());
    expect(host.textContent).not.toContain('No model loaded');
  });

  it('rows get the colour of their source layer', () => {
    const { host, stage } = setup();
    stage.setStage(data());
    expect(swatch(row(host, 'proj')!)).toBe(DOCUMENT_COLOR);
    expect(swatch(row(host, 'ext')!)).toBe(LAYER_COLORS[2]);
    expect(row(host, 'proj')!.classList.contains('pb-node')).toBe(true); // mismo estilo que el navegador
  });

  it('rows are collapsed except the first levels of the project', () => {
    const { host, stage } = setup();
    stage.setStage(data());
    expect(row(host, 'storey')).not.toBeNull();
    expect(row(host, 'wall')).toBeNull(); // dentro de la planta: plegado
    expect(row(host, 'storey')!.getAttribute('aria-expanded')).toBe('false');
    row(host, 'storey')!.querySelector<HTMLElement>('.pb-toggle')!.click();
    expect(row(host, 'wall')).not.toBeNull();
    expect(row(host, 'storey')!.getAttribute('aria-expanded')).toBe('true');
    // The format of the system: the root and each code (flat nodes) at the top of the tree, and the APUs and inputs of the price file.
    stage.setStage(data());
    expect(row(host, 'wall')).not.toBeNull();
  });

  it('a row with no source of its own takes its nearest ancestor source, else the document', () => {
    const m = model();
    const bolt = node(m.beam, 'bolt', 'bolt'); // llega por herencia o import: sin entrada propia
    const orphan = node(m.root, 'orphan', 'orphan'); // an element with a class that carries its code written: it is still part of the model
    const { host, stage } = setup();
    stage.setStage(data(m));
    stage.reveal(bolt.path);
    expect(swatch(row(host, 'bolt')!)).toBe(LAYER_COLORS[2]);
    expect(swatch(row(host, orphan.origin)!)).toBe(DOCUMENT_COLOR);
  });

  it('a mark shows as a chip with text moved', () => {
    const { host, stage } = setup();
    stage.setStage(data(model(), { marks: new Map([['ext', ['moved', 'edited']]]) }));
    const chips = [...row(host, 'ext')!.querySelectorAll('.stage-mark')].map((c) => c.textContent);
    expect(chips).toEqual(['moved', 'edited']);
    expect(row(host, 'proj')!.querySelector('.stage-mark')).toBeNull();
  });

  it('the search filters the tree and unfolds the matches', () => {
    vi.useFakeTimers();
    try {
      const { host, stage } = setup();
      stage.setStage(data());
      const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
      expect(input.placeholder).toBe('Search…');
      input.value = 'puerta';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      expect(row(host, 'ext')).not.toBeNull(); // con retardo
      vi.advanceTimersByTime(200);
      expect(row(host, 'door')).not.toBeNull(); // la coincidencia, con sus padres desplegados
      for (const o of ['proj', 'site', 'bldg', 'storey']) expect(row(host, o)!.getAttribute('aria-expanded')).toBe('true');
      expect(row(host, 'wall')).toBeNull();
      expect(row(host, 'ext')).toBeNull();
      input.value = 'zzz';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
      expect(host.querySelectorAll('.stage-row')).toHaveLength(0);
      expect(host.textContent).toContain('No results');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
      expect(row(host, 'ext')).not.toBeNull();
      expect(row(host, 'door')).toBeNull(); // vuelve al plegado anterior
    } finally {
      vi.useRealTimers();
    }
  });

  describe('cost system', () => {
    /** A model with an imported classification table: its root carries `system` and hangs 50 items. */
    function withCostSystem() {
      const m = model();
      node(m.root, 'costos', 'costos', { 'prj::costos::sistema': { id: 'costos', name: 'C', attribute: 'prj::costos::codigo', currency: 'USD' } });
      for (let i = 0; i < 5; i++) node(m.root, `costcode${i}`, `costcode${i}`, { 'prj::costos::codigo': { code: `0${i}`, name: `Code ${i}` } });
      node(m.root, 'costapu', 'costapu', { 'studio::cost::price': { code: 'APU', description: 'x', unit: 'm', price: 1 } });
      node(m.root, 'costins', 'costins', { 'prj::apu::insumo': { codigo: 'I', descripcion: 'x', unidad: 'u', tipo: 'material', precio: 1 } });
      // markSelected marks several rows and survives repainting the tree
      node(m.root, 'slab', 'slab', { 'bsi::ifc::class': { code: 'IfcSlab' }, 'prj::costos::codigo': { code: '01' } });
      return m;
    }

    it('its root, its flat codes and the price nodes are not listed in the Stage; an element with a code stays', () => {
      const { host, stage } = setup();
      stage.setStage(data(withCostSystem()));
      for (const o of ['costos', 'costcode0', 'costcode4', 'costapu', 'costins']) expect(row(host, o)).toBeNull();
      expect(row(host, 'slab')).not.toBeNull();
      expect(row(host, 'proj')).not.toBeNull();
    });
  });

  describe('classification tables', () => {
    /** Minimal DataTransfer: happy-dom does not create it in synthetic events. */
    function withTable() {
      const m = model();
      const table = node(m.root, 'omniclass-21', 'omniclass-21', { 'studio::classification::system': { id: 'omniclass-21', table: '21' } });
      for (let i = 0; i < 50; i++) {
        const code = `21-${String(i + 1).padStart(2, '0')} 00 00`;
        node(table, `i${i}`, `item${i}`, { 'omniclass::Table21': { code, name: i === 7 ? 'Bored Piles' : `Item ${i}` } });
      }
      return { ...m, table };
    }

    it('are not listed in the Stage, and the rest of the tree is untouched', () => {
      const { host, stage } = setup();
      const m = withTable();
      stage.setStage(data(m));
      expect(row(host, 'omniclass-21')).toBeNull();
      expect(host.querySelectorAll('.stage-row[data-origin^="item"]')).toHaveLength(0);
      expect(row(host, 'proj')).not.toBeNull();
      expect(row(host, 'ext')).not.toBeNull();
    });

    it('do not come up in a search, but the elements do', () => {
      vi.useFakeTimers();
      try {
        const { host, stage } = setup();
        stage.setStage(data(withTable()));
        const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
        input.value = 'bored';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(host.querySelectorAll('.stage-row')).toHaveLength(0);
        expect(host.textContent).toContain('No results');
        input.value = 'puerta';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(row(host, 'door')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('the imported schedule (IfcWorkSchedule) is not listed in the Stage', () => {
    const { host, stage } = setup();
    const m = model();
    const ws = node(m.root, 'cronograma', 'ws-1', { 'prj::ifc::WorkSchedule': { PredefinedType: 'PLANNED' } });
    node(ws, 'tk-1', 'ws-1-tk-1', { 'prj::ifc::Task': { PredefinedType: 'CONSTRUCTION', IsMilestone: false } });
    stage.setStage(data(m));
    expect(row(host, 'ws-1')).toBeNull();
    expect(row(host, 'ws-1-tk-1')).toBeNull();
    expect(row(host, 'proj')).not.toBeNull();
  });

  it('reveal unfolds ancestors and selects the row', () => {
    const { host, stage } = setup();
    const m = model();
    stage.setStage(data(m));
    expect(row(host, 'wall')).toBeNull();
    stage.reveal(m.wall.path);
    expect(row(host, 'storey')!.getAttribute('aria-expanded')).toBe('true');
    expect(row(host, 'wall')!.classList.contains('selected')).toBe(true);
    expect(row(host, 'wall')!.getAttribute('aria-selected')).toBe('true');
    stage.reveal(m.beam.path);
    expect(row(host, 'beam')!.classList.contains('selected')).toBe(true);
    expect(row(host, 'wall')!.classList.contains('selected')).toBe(false);
    stage.reveal(null);
    expect(host.querySelector('.stage-row.selected')).toBeNull();
    stage.reveal('/no/such/path');
    expect(host.querySelector('.stage-row.selected')).toBeNull();
  });

  it('clicking a row calls onSelect(origin, path); double click fits', () => {
    const { host, cb, stage } = setup();
    stage.setStage(data());
    const r = row(host, 'ext')!;
    r.click();
    expect(cb.onSelect).toHaveBeenCalledWith('ext', '/ext', false);
    expect(r.classList.contains('selected')).toBe(true);
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cb.onFit).toHaveBeenCalledWith('ext', '/ext');
  });

  it('Ctrl+clic en una fila pasa toggle=true; el clic normal, false', () => {
    const { host, cb, stage } = setup();
    stage.setStage(data());
    row(host, 'ext')!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(cb.onSelect).toHaveBeenLastCalledWith('ext', '/ext', true);
    row(host, 'ext')!.click();
    expect(cb.onSelect).toHaveBeenLastCalledWith('ext', '/ext', false);
  });

  it('it is accepted so that the drop arrives', () => {
    const { host, stage } = setup();
    const m = model();
    stage.setStage(data(m));
    stage.reveal(m.wall.path);
    stage.markSelected([m.wall.path, m.door.path]);
    expect(row(host, 'wall')!.classList.contains('is-multi')).toBe(true);
    expect(row(host, 'door')!.classList.contains('is-multi')).toBe(true);
    stage.setStage(data(m));
    stage.reveal(m.wall.path);
    expect(row(host, 'door')!.classList.contains('is-multi')).toBe(true);
    stage.markSelected([m.wall.path]);
    expect(row(host, 'door')!.classList.contains('is-multi')).toBe(false);
  });

  describe('a reused element (two instances of one origin)', () => {
    /** ext / {a / beam, b / beam}: la viga reutilizada bajo dos padres. */
    function reused() {
      const m = model();
      const a = node(m.ext, 'a', 'a');
      const b = node(m.ext, 'b', 'b');
      const first = node(a, 'beam', 'shared');
      const second = node(b, 'beam', 'shared');
      return { ...m, first, second };
    }
    const at = (host: HTMLElement, p: string) => host.querySelector<HTMLElement>(`.stage-row[data-path="${p}"]`);

    it('clicking the second instance selects its own path, and Enter / double click fit it', () => {
      const { host, cb, stage } = setup();
      const m = reused();
      stage.setStage(data(m));
      stage.reveal(m.second.path);
      const r = at(host, m.second.path)!;
      r.click();
      expect(cb.onSelect).toHaveBeenLastCalledWith('shared', m.second.path, false);
      expect(r.classList.contains('selected')).toBe(true);
      expect(at(host, m.first.path)!.classList.contains('selected')).toBe(false);
      r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(cb.onFit).toHaveBeenLastCalledWith('shared', m.second.path);
      host.querySelector('.stage-tree')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(cb.onFit).toHaveBeenLastCalledWith('shared', m.second.path);
      // con las flechas se pasa a la fila anterior (la b), con su propia ruta
      host.querySelector('.stage-tree')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(cb.onSelect).toHaveBeenLastCalledWith('b', '/ext/b', false);
    });

    it('revealing the second instance selects its row, not the first one', () => {
      const { host, stage } = setup();
      const m = reused();
      stage.setStage(data(m));
      stage.reveal(m.second.path);
      expect(at(host, m.second.path)!.classList.contains('selected')).toBe(true);
      expect(at(host, m.first.path)?.classList.contains('selected') ?? false).toBe(false);
    });
  });

  it('names with HTML go in as text', () => {
    const m = model();
    const evil = node(m.root, '<img src=x onerror=alert(1)>', 'evil');
    const { host, stage } = setup();
    stage.setStage(data(m, { marks: new Map([['evil', ['relocated']]]) }));
    expect(host.querySelector('img')).toBeNull();
    expect(row(host, 'evil')!.querySelector('.pb-label')!.textContent).toBe(evil.name);
  });

  it('a long list of children is paged with Show more', () => {
    const root = node(null, 'root', '');
    for (let i = 0; i < 450; i++) node(root, `n${i}`, `o${i}`);
    const { host, stage } = setup();
    stage.setStage({ root, sourceOf: new Map(), colors: new Map(), marks: new Map() });
    const more = host.querySelector<HTMLButtonElement>('.stage-more')!;
    expect(more.textContent).toBe('Show 50 more of 50');
    expect(host.querySelectorAll('.stage-row')).toHaveLength(400);
    more.click();
    expect(host.querySelectorAll('.stage-row')).toHaveLength(450);
    expect(host.querySelector('.stage-more')).toBeNull();
  });

  describe('relocating by dragging', () => {
    /** a level, but from the linked file */
    const dataTransfer = () => {
      const d = new Map<string, string>();
      return {
        dropEffect: 'none', effectAllowed: 'all',
        setData: (k: string, v: string) => void d.set(k, v),
        getData: (k: string) => d.get(k) ?? '',
      };
    };
    const fire = (type: string, target: HTMLElement, dt: ReturnType<typeof dataTransfer>) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { dataTransfer: dt });
      target.dispatchEvent(e);
      return e;
    };
    /** Arrastra `from` sobre `to` y suelta; devuelve el dragover y el DataTransfer. */
    const dragOnto = (from: HTMLElement, to: HTMLElement) => {
      const dt = dataTransfer();
      fire('dragstart', from, dt);
      const over = fire('dragover', to, dt);
      const denied = to.classList.contains('drop-denied');
      const effect = dt.dropEffect;
      fire('drop', to, dt);
      fire('dragend', from, dt);
      return { over, denied, effect };
    };

    /** El modelo de siempre y, en la capa 1, ext / {lvl1 / beam2 / bolt, lvl2}; en la capa 2, other / x. */
    function relocModel() {
      const m = model();
      const lvl1 = node(m.ext, 'lvl1', 'lvl1');
      const beam2 = node(lvl1, 'beam2', 'beam2');
      const bolt = node(beam2, 'bolt', 'bolt');
      const lvl2 = node(m.ext, 'lvl2', 'lvl2');
      const other = node(m.root, 'other', 'other');
      const x = node(other, 'x', 'x');
      const d = data(m);
      for (const o of ['lvl1', 'beam2', 'lvl2']) d.sourceOf.set(o, '1');
      d.sourceOf.set('other', '2');
      d.sourceOf.set('x', '2');
      return { ...m, lvl1, beam2, bolt, lvl2, other, x, d };
    }

    function mounted() {
      document.body.innerHTML = '';
      const host = document.createElement('div');
      document.body.append(host);
      const cb = { onSelect: vi.fn(), onFit: vi.fn(), onReparent: vi.fn() };
      const stage = mountStagePanel(host, cb);
      const m = relocModel();
      stage.setStage(m.d);
      stage.reveal(m.bolt.path);
      stage.reveal(m.x.path);
      stage.reveal(m.wall.path);
      return { host, cb, stage, m };
    }

    it('rows are draggable; a drop onto a row of the same source layer calls onReparent', () => {
      const { host, cb } = mounted();
      expect(row(host, 'beam2')!.draggable).toBe(true);
      const r = dragOnto(row(host, 'beam2')!, row(host, 'lvl2')!);
      expect(r.over.defaultPrevented).toBe(true);
      expect(r.effect).toBe('move');
      expect(r.denied).toBe(false);
      expect(cb.onReparent).toHaveBeenCalledWith('beam2', 'lvl2', { node: '/ext/lvl1/beam2', parent: '/ext/lvl2', layer: '1' });
    });

    it('drop onto another source layer does not call onReparent', () => {
      const { host, cb } = mounted();
      const r = dragOnto(row(host, 'beam2')!, row(host, 'x')!);
      expect(r.over.defaultPrevented).toBe(false);
      expect(r.effect).toBe('none');
      expect(r.denied).toBe(true); // cursor not-allowed
      expect(cb.onReparent).not.toHaveBeenCalled();
      expect(host.querySelector('.drop-denied')).toBeNull(); // se limpia al soltar
    });

    it('drop onto a descendant does nothing', () => {
      const { host, cb } = mounted();
      expect(dragOnto(row(host, 'lvl1')!, row(host, 'bolt')!).denied).toBe(true);
      expect(dragOnto(row(host, 'lvl1')!, row(host, 'lvl1')!).denied).toBe(true);
      // ni sobre su padre actual
      expect(dragOnto(row(host, 'beam2')!, row(host, 'lvl1')!).denied).toBe(true);
      expect(cb.onReparent).not.toHaveBeenCalled();
    });

    it('document element drop shows the toast', () => {
      const { host, cb } = mounted();
      const r = dragOnto(row(host, 'wall')!, row(host, 'bldg')!);
      expect(r.over.defaultPrevented).toBe(true); // The level does not expand on its own (it is deeper than OPEN_DEPTH): it is opened to see its children.
      expect(cb.onReparent).not.toHaveBeenCalled();
      expect(document.getElementById('toasts')!.textContent).toBe('Use Properties › Level to move Dream BIM elements between levels');
    });

    it('a document element drag cancelled with Esc shows no toast', () => {
      const { host } = mounted();
      const dt = dataTransfer();
      fire('dragstart', row(host, 'wall')!, dt);
      fire('dragover', row(host, 'bldg')!, dt);
      fire('dragend', row(host, 'wall')!, dt);
      expect(document.getElementById('toasts')?.textContent ?? '').toBe('');
    });

    it('drop onto another instance of the dragged element (or inside it) does nothing', () => {
      const m = relocModel();
      const copy = node(m.lvl2, 'beam2', 'beam2'); // otra instancia de beam2
      node(copy, 'bolt', 'bolt');
      document.body.innerHTML = '';
      const host = document.createElement('div');
      document.body.append(host);
      const cb = { onSelect: vi.fn(), onReparent: vi.fn() };
      const stage = mountStagePanel(host, cb);
      stage.setStage(m.d);
      stage.reveal(m.bolt.path);
      const at = (p: string) => host.querySelector<HTMLElement>(`.stage-row[data-path="${p}"]`)!;
      // la segunda instancia, desplegada para tener sus filas
      if (!at('/ext/lvl2/beam2/bolt')) at('/ext/lvl2/beam2').querySelector<HTMLElement>('.pb-toggle')!.click();
      expect(dragOnto(at('/ext/lvl1/beam2'), at('/ext/lvl2/beam2')).denied).toBe(true);
      expect(dragOnto(at('/ext/lvl1/beam2'), at('/ext/lvl2/beam2/bolt')).denied).toBe(true);
      expect(cb.onReparent).not.toHaveBeenCalled();
    });

    it('the instance that is dragged is the one passed, even when its element is reused', () => {
      const m = relocModel();
      node(m.lvl2, 'beam2', 'beam2'); // otra instancia de beam2
      document.body.innerHTML = '';
      const host = document.createElement('div');
      document.body.append(host);
      const cb = { onSelect: vi.fn(), onReparent: vi.fn() };
      const stage = mountStagePanel(host, cb);
      stage.setStage(m.d);
      stage.reveal(m.bolt.path);
      const second = host.querySelector<HTMLElement>('.stage-row[data-path="/ext/lvl2/beam2"]')!;
      expect(second).not.toBeNull();
      dragOnto(second, row(host, 'lvl1')!);
      expect(cb.onReparent).toHaveBeenCalledWith('beam2', 'lvl1', { node: '/ext/lvl2/beam2', parent: '/ext/lvl1', layer: '1' });
    });

    it('the node shows the relocated mark', () => {
      const { host, stage, m } = mounted();
      stage.setStage({ ...m.d, marks: new Map([['beam2', ['relocated']]]) });
      const chips = [...row(host, 'beam2')!.querySelectorAll('.stage-mark')].map((c) => c.textContent);
      expect(chips).toEqual(['relocated']);
    });
  });

  describe('placing a linked file by dragging its Layer row', () => {
    /** DataTransfer de un arrastre desde el panel Layer: `types` lleva el tipo propio. */
    const layerDrag = (id: string) => ({
      dropEffect: 'none', effectAllowed: 'copyMove', types: [LAYER_DRAG_TYPE, 'text/plain'],
      setData: () => {},
      getData: (k: string) => (k === LAYER_DRAG_TYPE ? id : ''),
    });
    const fire = (type: string, target: HTMLElement, dt: unknown) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { dataTransfer: dt });
      target.dispatchEvent(e);
      return e;
    };
    function mounted(canPlace?: () => boolean) {
      document.body.innerHTML = '';
      const host = document.createElement('div');
      document.body.append(host);
      const cb = { onSelect: vi.fn(), onPlace: vi.fn(), ...(canPlace ? { canPlace } : {}) };
      const stage = mountStagePanel(host, cb);
      const m = model();
      m.proj.attributes = { 'bsi::ifc::class': { code: 'IfcProject' } };
      m.bldg.attributes = { 'bsi::ifc::class': { code: 'IfcBuilding' } };
      m.storey.attributes = { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } };
      m.beam.attributes = { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } }; // the children are shown dimmed, but their eye keeps its own state
      stage.setStage(data(m));
      stage.reveal(m.wall.path);
      stage.reveal(m.beam.path);
      return { host, cb };
    }
    const dropOn = (to: HTMLElement) => {
      const dt = layerDrag('7');
      const over = fire('dragover', to, dt);
      const denied = to.classList.contains('drop-denied');
      const target = to.classList.contains('drop-target');
      fire('drop', to, dt);
      return { over, denied, target, effect: dt.dropEffect };
    };

    it('a drop onto the project or a level of the document calls onPlace', () => {
      const { host, cb } = mounted();
      const r = dropOn(row(host, 'proj')!);
      expect(r.over.defaultPrevented).toBe(true);
      expect(r.target).toBe(true);
      expect(r.effect).toBe('copy');
      expect(cb.onPlace).toHaveBeenLastCalledWith('7', 'proj');
      dropOn(row(host, 'storey')!);
      expect(cb.onPlace).toHaveBeenLastCalledWith('7', 'storey');
      expect(host.querySelector('.drop-target')).toBeNull();
    });

    it('when the document cannot take placements (read-only) the project and the levels deny the drop too', () => {
      let allowed = false;
      const { host, cb } = mounted(() => allowed);
      for (const o of ['proj', 'storey']) {
        const r = dropOn(row(host, o)!);
        expect(r.over.defaultPrevented).toBe(false);
        expect(r.denied).toBe(true);
        expect(r.effect).toBe('none');
      }
      expect(cb.onPlace).not.toHaveBeenCalled();
      allowed = true; // se consulta en cada arrastre
      dropOn(row(host, 'proj')!);
      expect(cb.onPlace).toHaveBeenCalledWith('7', 'proj');
    });

    it('a drop onto any other node (building, wall, a node of a linked file) places it there', () => {
      const { host, cb } = mounted();
      for (const o of ['bldg', 'wall', 'ext', 'beam']) {
        const r = dropOn(row(host, o)!);
        expect(r.over.defaultPrevented).toBe(true);
        expect(r.target).toBe(true);
        expect(cb.onPlace).toHaveBeenLastCalledWith('7', o);
      }
    });

    it('a drop onto the empty area of the tree places it under the project', () => {
      const { host, cb } = mounted();
      const tree = host.querySelector<HTMLElement>('.stage-tree')!;
      const dt = layerDrag('7');
      expect(fire('dragover', tree, dt).defaultPrevented).toBe(true);
      expect(tree.classList.contains('drop-target')).toBe(true);
      fire('drop', tree, dt);
      expect(tree.classList.contains('drop-target')).toBe(false);
      expect(cb.onPlace).toHaveBeenCalledWith('7', 'proj');
    });

    it('a library tile dropped onto a node calls onPlaceAsset with that node', async () => {
      const { host, cb } = mounted();
      const onPlaceAsset = vi.fn();
      Object.assign(cb, { onPlaceAsset });
      const libHost = document.createElement('div');
      document.body.append(libHost);
      const lib = mountLibraryPanel(libHost, {
        chooseFolder: async () => null,
        list: async () => [{ name: 'Puerta.ifcx', path: 'C:/lib/Puerta.ifcx', isDir: false }],
        onActivate: () => {},
      });
      await lib.setFolder('C:/lib');
      lib.setEnabled(true);
      const tile = libHost.querySelector<HTMLElement>('.lib-tile')!;
      const plain = { dropEffect: 'none', effectAllowed: 'copy', types: ['text/plain'], setData: () => {}, getData: () => '' };
      fire('dragstart', tile, plain);
      const wall = row(host, 'wall')!;
      expect(fire('dragover', wall, plain).defaultPrevented).toBe(true);
      fire('drop', wall, plain);
      const storey = row(host, 'storey')!;
      expect(fire('dragover', storey, plain).defaultPrevented).toBe(true);
      fire('drop', storey, plain);
      fire('dragend', tile, plain);
      expect(onPlaceAsset.mock.calls).toEqual([['C:/lib/Puerta.ifcx', 'wall'], ['C:/lib/Puerta.ifcx', 'storey']]);
      expect(cb.onPlace).not.toHaveBeenCalled();
      // terminado el arrastre ya no cuenta como ficha
      expect(fire('dragover', storey, plain).defaultPrevented).toBe(false);
    });
  });

  describe('ocultar', () => {
    const eye = (host: HTMLElement, origin: string) => row(host, origin)!.querySelector<HTMLButtonElement>('.stage-eye')!;
    /** same hierarchy: nothing changes */
    const openStorey = (host: HTMLElement) => row(host, 'storey')!.querySelector<HTMLElement>('.pb-toggle')!.click();
    const lastHidden = (cb: { onHiddenChange: ReturnType<typeof vi.fn> }) => [...(cb.onHiddenChange.mock.calls.at(-1)![0] as Set<string>)];

    it('every row has an eye button that starts as visible', () => {
      const { host, stage } = setup();
      stage.setStage(data());
      for (const r of host.querySelectorAll('.stage-row')) {
        const b = r.querySelector<HTMLButtonElement>('.stage-eye')!;
        expect(b).toBeTruthy();
        expect(b.getAttribute('aria-pressed')).toBe('false');
        expect(b.getAttribute('aria-label')).toBe('Hide');
      }
    });

    it('the eye hides the element and its descendants without selecting it; a second click shows it', () => {
      const { host, cb, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      openStorey(host);
      eye(host, 'storey').click();
      expect(cb.onSelect).not.toHaveBeenCalled();
      expect(lastHidden(cb)).toEqual([m.storey.path]);
      expect(row(host, 'storey')!.classList.contains('is-hidden')).toBe(true);
      expect(eye(host, 'storey').getAttribute('aria-pressed')).toBe('true');
      expect(eye(host, 'storey').getAttribute('aria-label')).toBe('Show');
      // without rebuilding the tree
      expect(row(host, 'wall')!.classList.contains('in-hidden')).toBe(true);
      expect(row(host, 'wall')!.classList.contains('is-hidden')).toBe(false);
      expect(row(host, 'bldg')!.classList.contains('in-hidden')).toBe(false);
      eye(host, 'storey').click();
      expect(lastHidden(cb)).toEqual([]);
      expect(row(host, 'storey')!.classList.contains('is-hidden')).toBe(false);
      expect(row(host, 'wall')!.classList.contains('in-hidden')).toBe(false);
    });

    it('hidden elements stay hidden when the stage is recomposed; vanished paths are dropped', () => {
      const { host, cb, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      openStorey(host);
      eye(host, 'wall').click();
      eye(host, 'beam').click();
      cb.onHiddenChange.mockClear();
      stage.setStage(data(m)); // it is canonical: no duplicated ./, collapsed .. and no backslashes
      expect(cb.onHiddenChange).not.toHaveBeenCalled();
      expect(row(host, 'wall')!.classList.contains('is-hidden')).toBe(true);
      const m2 = model();
      m2.root.children.splice(m2.root.children.indexOf(m2.ext), 1); // el archivo enlazado desaparece
      stage.setStage(data(m2));
      expect(lastHidden(cb)).toEqual([m2.wall.path]);
    });
  });

  describe('it does not go above the root', () => {
    it('revealing a row that is already painted keeps every row element', () => {
      const { host, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      const before = [...host.querySelectorAll('.stage-row')];
      stage.reveal(m.bldg.path);
      expect([...host.querySelectorAll('.stage-row')]).toEqual(before);
      expect(row(host, 'bldg')!.classList.contains('selected')).toBe(true);
      stage.reveal(m.site.path);
      expect(row(host, 'bldg')!.classList.contains('selected')).toBe(false);
      expect(row(host, 'site')!.classList.contains('selected')).toBe(true);
    });

    it('revealing inside a collapsed branch opens only that branch', () => {
      const { host, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      const site = row(host, 'site');
      stage.reveal(m.wall.path);
      expect(row(host, 'site')).toBe(site);
      expect(row(host, 'wall')!.classList.contains('selected')).toBe(true);
      expect(row(host, 'storey')!.getAttribute('aria-expanded')).toBe('true');
      expect(row(host, 'storey')!.querySelector('.pb-toggle')!.textContent).toBe('−');
    });

    it('opening and closing a branch keeps the other rows; closing drops its rows', () => {
      const { host, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      const beam = row(host, 'beam');
      const toggle = () => row(host, 'storey')!.querySelector<HTMLElement>('.pb-toggle')!.click();
      toggle();
      expect(row(host, 'beam')).toBe(beam);
      expect(row(host, 'wall')).toBeTruthy();
      toggle();
      expect(row(host, 'wall')).toBeNull();
      expect(row(host, 'beam')).toBe(beam);
      expect(row(host, 'storey')!.getAttribute('aria-expanded')).toBe('false');
      toggle(); // vuelve a abrirse sin duplicar filas
      expect(host.querySelectorAll('.stage-row[data-origin="wall"]').length).toBe(1);
    });

    it('the eye only touches the toggled row and its descendants', () => {
      const { host, stage } = setup();
      const m = model();
      stage.setStage(data(m));
      row(host, 'storey')!.querySelector<HTMLElement>('.pb-toggle')!.click();
      const bldgEye = row(host, 'bldg')!.querySelector('.stage-eye svg');
      row(host, 'storey')!.querySelector<HTMLElement>('.stage-eye')!.click();
      expect(row(host, 'bldg')!.querySelector('.stage-eye svg')).toBe(bldgEye);
      expect(row(host, 'wall')!.classList.contains('in-hidden')).toBe(true);
    });
  });
});

