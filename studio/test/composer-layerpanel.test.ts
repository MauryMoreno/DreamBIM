import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLayerPanel, type LayerPanelCallbacks } from '../src/composer/layerpanel';
import { LAYER_DRAG_TYPE, type StackRow } from '../src/composer/rows';
import { DOCUMENT_COLOR, LAYER_COLORS } from '../src/composer/stack';

type FileRow = Extract<StackRow, { kind: 'file' }>;

const file = (id: string, over: Partial<FileRow> = {}): FileRow => ({
  kind: 'file', id, name: `${id}.ifcx`, path: `C:/p/${id}.ifcx`, color: LAYER_COLORS[Number(id) % 8],
  enabled: true, missing: false, editCount: 0, editsEnabled: true, orphans: [], ...over,
});
const doc: StackRow = { kind: 'document', name: 'casa.ifcx', path: 'C:/p/casa.ifcx' };

function setup() {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const cb = {
    onAdd: vi.fn(), onToggle: vi.fn(), onToggleEdits: vi.fn(), onRemove: vi.fn(), onMoveLayer: vi.fn(), onRelink: vi.fn(),
    onPlace: vi.fn(), onUnplace: vi.fn(), onRemoveEdit: vi.fn(), onHiddenLayersChange: vi.fn(),
  } satisfies LayerPanelCallbacks;
  const panel = mountLayerPanel(host, cb);
  return { host, cb, panel };
}

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.layer-row')];

/** target line */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: 'none', effectAllowed: 'all',
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
  };
}

function drag(type: string, target: HTMLElement, dt: ReturnType<typeof dataTransfer>, clientY = 0) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { dataTransfer: dt, clientY });
  target.dispatchEvent(e);
  return e;
}

describe('mountLayerPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('one row per layer and the document last; the edits row only when there are any', () => {
    const { host, cb, panel } = setup();
    panel.setStack([file('1', { editCount: 3 }), file('2'), doc]);
    const r = rows(host);
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.querySelector('.layer-name')!.textContent)).toEqual([
      '1.ifcx', '↳ Edits · 1.ifcx', '2.ifcx', 'casa.ifcx',
    ]);
    // archivo: asa, casilla, color, nombre, link y ×; tooltip con la ruta
    expect(r[0].querySelector('.layer-grip')!.textContent).toBe('⠿');
    expect(r[0].querySelector('.layer-tag')!.textContent).toBe('link');
    expect(r[0].querySelector('.layer-remove')).not.toBeNull();
    expect(r[0].title).toBe('C:/p/1.ifcx');
    expect(r[0].querySelector<HTMLElement>('.layer-swatch')!.style.getPropertyValue('--layer-color')).toBe(LAYER_COLORS[1]);
    // dropping on the document leads to the last place among the links
    expect(r[1].querySelector('.layer-count')!.textContent).toBe('3 edits');
    expect(r[1].querySelector('.layer-grip')).toBeNull();
    expect(r[1].querySelector('.layer-remove')).toBeNull();
    // documento: al final, etiqueta Document, sin asa ni ×, casilla fija
    expect(r[3].querySelector('.layer-tag')!.textContent).toBe('Document');
    expect(r[3].querySelector('.layer-grip')).toBeNull();
    expect(r[3].querySelector('.layer-remove')).toBeNull();
    expect(r[3].querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(r[3].querySelector<HTMLElement>('.layer-swatch')!.style.getPropertyValue('--layer-color')).toBe(DOCUMENT_COLOR);

    const check = r[0].querySelector<HTMLInputElement>('input')!;
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    expect(cb.onToggle).toHaveBeenCalledWith('1', false);
    const edits = r[1].querySelector<HTMLInputElement>('input')!;
    expect(edits.checked).toBe(true);
    edits.checked = false;
    edits.dispatchEvent(new Event('change'));
    expect(cb.onToggleEdits).toHaveBeenCalledWith('1', false);
    r[2].querySelector<HTMLButtonElement>('.layer-remove')!.click();
    expect(cb.onRemove).toHaveBeenCalledWith('2');

    panel.setStack([file('1', { editCount: 1, enabled: false }), doc]);
    const again = rows(host);
    expect(again[0].classList.contains('disabled')).toBe(true);
    expect(again[1].querySelector('.layer-count')!.textContent).toBe('1 edit');
  });

  it('the missing state shows Relink… and calls onRelink', () => {
    const { host, cb, panel } = setup();
    panel.setStack([file('1', { missing: true }), file('2'), doc]);
    const [missing, ok] = rows(host);
    expect(missing.classList.contains('missing')).toBe(true);
    expect(missing.title).toBe('File not found: C:/p/1.ifcx');
    expect(ok.querySelector('.layer-relink')).toBeNull();
    const relink = missing.querySelector<HTMLButtonElement>('.layer-relink')!;
    expect(relink.textContent).toBe('Relink…');
    relink.click();
    expect(cb.onRelink).toHaveBeenCalledWith('1');
  });

  it('drag a grip onto another row calls onMoveLayer(id, index)', () => {
    const { host, cb, panel } = setup();
    panel.setStack([file('1'), file('2'), file('3'), doc]);
    const dt = dataTransfer();
    let r = rows(host);
    drag('dragstart', r[0].querySelector<HTMLElement>('.layer-grip')!, dt);
    const over = drag('dragover', r[1], dt);
    expect(over.defaultPrevented).toBe(true); // permite soltar
    expect(host.querySelector('.drop-before, .drop-after')).not.toBeNull(); // when recomposing it stays expanded; without orphans the notice and the button disappear
    drag('drop', r[1], dt);
    expect(cb.onMoveLayer).toHaveBeenCalledWith('1', 1);
    expect(host.querySelector('.drop-before, .drop-after')).toBeNull();

    // it acts like the eye: it notifies with the set and marks the row
    r = rows(host);
    drag('dragstart', r[0].querySelector<HTMLElement>('.layer-grip')!, dt);
    drag('dragover', r[3], dt);
    drag('drop', r[3], dt);
    expect(cb.onMoveLayer).toHaveBeenLastCalledWith('1', 2);

    // de abajo arriba: el tercero sobre la mitad superior del primero
    r = rows(host);
    r[0].getBoundingClientRect = () => ({ top: 0, bottom: 20, height: 20, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} });
    drag('dragstart', r[2].querySelector<HTMLElement>('.layer-grip')!, dt);
    drag('dragover', r[0], dt, 2);
    drag('drop', r[0], dt, 2);
    expect(cb.onMoveLayer).toHaveBeenLastCalledWith('3', 0);
  });

  it('+ calls onAdd and is disabled with rows null', () => {
    const { host, cb, panel } = setup();
    const add = host.querySelector<HTMLButtonElement>('.ws-layers-add')!;
    expect(add.title).toBe('Add layer from an .ifcx file');
    expect(add.disabled).toBe(true);
    expect(rows(host)).toHaveLength(0);
    panel.setStack([doc]);
    expect(add.disabled).toBe(false);
    add.click();
    expect(cb.onAdd).toHaveBeenCalledOnce();
    panel.setStack(null);
    expect(add.disabled).toBe(true);
    expect(rows(host)).toHaveLength(0);
  });

  it('names with HTML go in as text', () => {
    const { host, panel } = setup();
    panel.setStack([
      file('1', { name: '<b>extra</b>.ifcx', editCount: 1 }),
      { kind: 'document', name: '<img src=x onerror=alert(1)>', path: null },
    ]);
    expect(host.querySelector('b, img')).toBeNull();
    const r = rows(host);
    expect(r[0].querySelector('.layer-name')!.textContent).toBe('<b>extra</b>.ifcx');
    expect(r[1].querySelector('.layer-name')!.textContent).toBe('↳ Edits · <b>extra</b>.ifcx');
    expect(r[2].querySelector('.layer-name')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  describe('orphaned edits', () => {
    const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.layer-edits .layer-toggle');

    it('orphan listed and removable', () => {
      const { host, cb, panel } = setup();
      panel.setStack([file('1', { editCount: 3, orphans: ['G1', 'P/g2'] }), doc]);
      expect(rows(host)[1].querySelector('.layer-count')!.textContent).toBe('3 edits · 2 orphaned');
      // plegada: solo el archivo, sus ediciones y el documento
      expect(rows(host)).toHaveLength(3);
      const t = toggle(host)!;
      expect(t.getAttribute('aria-expanded')).toBe('false');
      t.click();
      expect(toggle(host)!.getAttribute('aria-expanded')).toBe('true');
      const r = rows(host);
      expect(r).toHaveLength(5);
      expect(r.map((x) => x.dataset.kind)).toEqual(['file', 'edits', 'orphan', 'orphan', 'document']);
      expect(r[2].querySelector('.layer-name')!.textContent).toBe('G1');
      expect(r[2].title).toBe('Element no longer exists in 1.ifcx');
      const rm = r[3].querySelector<HTMLButtonElement>('button')!;
      expect(rm.textContent).toBe('×');
      expect(rm.getAttribute('aria-label')).toBe('Remove orphaned edit P/g2');
      rm.click();
      expect(cb.onRemoveEdit).toHaveBeenCalledWith('1', 'P/g2');
      // with an id that is not a layer it returns false and does not notify
      panel.setStack([file('1', { editCount: 2, orphans: ['G1'] }), doc]);
      expect(rows(host)).toHaveLength(4);
      expect(rows(host)[1].querySelector('.layer-count')!.textContent).toBe('2 edits · 1 orphaned');
      panel.setStack([file('1', { editCount: 1 }), doc]);
      expect(rows(host)).toHaveLength(3);
      expect(rows(host)[1].querySelector('.layer-count')!.textContent).toBe('1 edit');
      expect(toggle(host)).toBeNull();
    });

    it('folds back and writes paths and names as text', () => {
      const { host, panel } = setup();
      panel.setStack([file('1', { name: '<i>a</i>.ifcx', editCount: 1, orphans: ['<b>x</b>'] }), doc]);
      toggle(host)!.click();
      expect(host.querySelector('b, i')).toBeNull();
      expect(rows(host)[2].querySelector('.layer-name')!.textContent).toBe('<b>x</b>');
      expect(rows(host)[2].title).toBe('Element no longer exists in <i>a</i>.ifcx');
      toggle(host)!.click();
      expect(rows(host)).toHaveLength(3);
    });
  });

  describe('placing a file in the document', () => {
    const editable: StackRow = { ...doc, targets: [{ id: 'proj', name: 'Project' }, { id: 'lvl1', name: 'Level 1' }] } as StackRow;
    const menuItems = () => [...document.querySelectorAll<HTMLElement>('.ribbon-menu [role="menuitemradio"]')];

    it('Place… opens a menu with the project and the levels; choosing one calls onPlace', () => {
      const { host, cb, panel } = setup();
      panel.setStack([file('1'), editable]);
      const place = rows(host)[0].querySelector<HTMLButtonElement>('.layer-place')!;
      expect(place.textContent).toBe('Place…');
      expect(place.getAttribute('aria-haspopup')).toBe('menu');
      place.click();
      expect(menuItems().map((i) => i.textContent)).toEqual(['Project', 'Level 1']);
      menuItems()[1].click();
      expect(cb.onPlace).toHaveBeenCalledWith('1', 'lvl1');
      expect(menuItems()).toHaveLength(0); // se cierra al elegir
    });

    it('a placed file marks its parent in the menu, shows a placed tag and offers Unplace', () => {
      const { host, cb, panel } = setup();
      panel.setStack([file('1', { placedIn: 'lvl1' }), editable]);
      const r = rows(host)[0];
      expect([...r.querySelectorAll('.layer-tag')].map((t) => t.textContent)).toContain('placed');
      r.querySelector<HTMLButtonElement>('.layer-place')!.click();
      const items = menuItems();
      expect(items.map((i) => i.textContent)).toEqual(['Project', 'Level 1', 'Unplace']);
      expect(items[1].getAttribute('aria-checked')).toBe('true');
      items[2].click();
      expect(cb.onUnplace).toHaveBeenCalledWith('1');
      expect(cb.onPlace).not.toHaveBeenCalled();
    });

    it('without places in the document (read-only) there is no Place…', () => {
      const { host, panel } = setup();
      panel.setStack([file('1'), doc]);
      expect(rows(host)[0].querySelector('.layer-place')).toBeNull();
    });

    it('dragging the grip carries the layer id for the Stage', () => {
      const { host, panel } = setup();
      panel.setStack([file('1'), editable]);
      const dt = dataTransfer();
      drag('dragstart', rows(host)[0].querySelector<HTMLElement>('.layer-grip')!, dt);
      expect(dt.getData(LAYER_DRAG_TYPE)).toBe('1');
      expect(dt.effectAllowed).toBe('copyMove');
    });
  });

  describe('ojo', () => {
    const eye = (host: HTMLElement, i: number) => rows(host)[i].querySelector<HTMLButtonElement>('.layer-eye')!;
    const last = (cb: { onHiddenLayersChange: ReturnType<typeof vi.fn> }) => [...(cb.onHiddenLayersChange.mock.calls.at(-1)![0] as Set<string>)];

    it('each linked file has an eye; the document does not', () => {
      const { host, panel } = setup();
      panel.setStack([file('1'), file('2'), doc]);
      expect(eye(host, 0).getAttribute('aria-pressed')).toBe('false');
      expect(eye(host, 0).getAttribute('aria-label')).toBe('Hide 1.ifcx in the view');
      expect(rows(host).at(-1)!.querySelector('.layer-eye')).toBeNull();
    });

    it('the eye hides the layer in the view without disabling it, and survives a repaint', () => {
      const { host, cb, panel } = setup();
      panel.setStack([file('1'), file('2'), doc]);
      eye(host, 1).click();
      expect(last(cb)).toEqual(['2']);
      expect(cb.onToggle).not.toHaveBeenCalled();
      expect(eye(host, 1).getAttribute('aria-pressed')).toBe('true');
      expect(rows(host)[1].classList.contains('is-hidden')).toBe(true);
      panel.setStack([file('1'), file('2', { editCount: 1 }), doc]);
      expect(eye(host, 1).getAttribute('aria-pressed')).toBe('true');
      eye(host, 1).click();
      expect(last(cb)).toEqual([]);
    });

    it('a removed layer leaves the hidden set', () => {
      const { host, cb, panel } = setup();
      panel.setStack([file('1'), file('2'), doc]);
      eye(host, 0).click();
      panel.setStack([file('2'), doc]);
      expect(last(cb)).toEqual([]);
    });
  });
});

describe('LayerPanel.setHidden (el agente oculta una capa)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('A linked layer with packed meshes (typed arrays, as the parse worker returns them)', () => {
    const { host, cb, panel } = setup();
    panel.setStack([file('1'), file('2'), doc]);
    expect(panel.setHidden('2', true)).toBe(true);
    expect([...(cb.onHiddenLayersChange.mock.calls.at(-1)![0] as Set<string>)]).toEqual(['2']);
    expect(rows(host)[1].classList.contains('is-hidden')).toBe(true);
    expect(panel.setHidden('2', false)).toBe(true);
    expect([...(cb.onHiddenLayersChange.mock.calls.at(-1)![0] as Set<string>)]).toEqual([]);
    expect(rows(host)[1].classList.contains('is-hidden')).toBe(false);
  });

  it('it composes and draws the same geometry as without packing', () => {
    const { cb, panel } = setup();
    panel.setStack([file('1'), doc]);
    expect(panel.setHidden('zz', true)).toBe(false);
    expect(cb.onHiddenLayersChange).not.toHaveBeenCalled();
  });
});
