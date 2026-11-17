import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_SYSTEM } from '../src/costs/boqpanel';
import { COST_CODE_DRAG, mountCostTree } from '../src/costs/treepanel';
import type { CostCode, CostSystem } from '../src/costs/system';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});

const code = (c: string, parent: string | null, item = false): CostCode => ({
  path: `n-${c}`, code: c, name: `Name ${c}`, parent, medicion: item ? { unit: 'm³', measure: 'volume' } : null,   manualPrice: null, origin: null, unitPrice: 0, priceFrom: 'none', warning: null, role: 'import', location: 'C:/t/costos.ifcx',
});
// el dibujo del usuario: 01.00 Structure › 01.01, 01.02; 02.00 Arq › 02.01 › 02.01.01; 03.00
const codes = [
  code('01.00', null), code('01.01', '01.00', true), code('01.02', '01.00', true),
  code('02.00', null), code('02.01', '02.00'), code('02.01.01', '02.01', true), code('03.00', null),
];
const system: CostSystem = {
  id: 's', name: 's', attribute: 'a', currency: 'USD', codes, warning: null, rootPath: 'root', role: 'import', location: 'C:/t/costos.ifcx',
  byCode: new Map(codes.map((c) => [c.code, c])),
  children: (p) => codes.filter((c) => c.parent === p),
};
const counts = new Map([['01.00', 5], ['01.01', 3], ['01.02', 2]]);
const cb = () => ({ onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onOpenEditor: vi.fn() });
const rows = () => [...host.querySelectorAll<HTMLElement>('.cost-tree-row')];
const rowOf = (c: string) => host.querySelector<HTMLElement>(`.cost-tree-row[data-code="${c}"]`)!;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
/** Un evento de arrastre con su dataTransfer (jsdom no trae DragEvent). */
function drag(el: HTMLElement, type: string, data: Record<string, string> = {}) {
  const store: Record<string, string> = { ...data };
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: Object.keys(store), setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '', effectAllowed: '', dropEffect: '' },
  });
  el.dispatchEvent(ev);
  return store;
}

describe('cost system tree', () => {
  it('it shows the hierarchy of the file with its indentation and the counter of each branch', () => {
    mountCostTree(host, cb()).setSystem(system, counts);
    expect(rows().map((r) => r.dataset.code)).toEqual(['01.00', '01.01', '01.02', '02.00', '02.01', '02.01.01', '03.00']);
    const pad = (c: string) => parseInt(rowOf(c).style.paddingLeft, 10);
    expect(pad('02.01')).toBeGreaterThan(pad('02.00'));
    expect(pad('02.01.01')).toBeGreaterThan(pad('02.01'));
    expect(rowOf('01.01').textContent).toContain('Name 01.01');
    expect(rowOf('01.00').querySelector('.cost-tree-count')!.textContent).toBe('5');
    expect(rowOf('03.00').querySelector('.cost-tree-count')).toBeNull();
    expect(rowOf('01.00').querySelector('.cost-tree-toggle')).not.toBeNull();
    expect(rowOf('01.01').querySelector('.cost-tree-toggle')).toBeNull();
  });

  it('collapsing a heading line hides its branch', () => {
    mountCostTree(host, cb()).setSystem(system, counts);
    rowOf('02.00').querySelector<HTMLElement>('.cost-tree-toggle')!.click();
    expect(rows().map((r) => r.dataset.code)).toEqual(['01.00', '01.01', '01.02', '02.00', '03.00']);
  });

  it('clic selecciona, doble clic y Enter editan', () => {
    const c = cb();
    const tree = mountCostTree(host, c);
    tree.setSystem(system, counts);
    rowOf('01.01').click();
    expect(c.onSelect).toHaveBeenCalledWith('01.01');
    rowOf('01.01').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(c.onEdit).toHaveBeenLastCalledWith('01.01');
    rowOf('02.00').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c.onEdit).toHaveBeenLastCalledWith('02.00');
  });

  it('setSelected marca la fila sin avisar y sobrevive a un nuevo sistema', () => {
    const c = cb();
    const tree = mountCostTree(host, c);
    tree.setSystem(system, counts);
    tree.setSelected('01.02');
    expect(rowOf('01.02').getAttribute('aria-selected')).toBe('true');
    tree.setSystem(system, counts);
    expect(rowOf('01.02').getAttribute('aria-selected')).toBe('true');
    expect(c.onSelect).not.toHaveBeenCalled();
  });

  it('the panel only has the Edit… button, which opens the editor; without a system or in read-only it is disabled', () => {
    const c = cb();
    const tree = mountCostTree(host, c);
    expect([...host.querySelectorAll('button')].filter((b) => !b.classList.contains('cost-tree-toggle')).map((b) => b.textContent)).toEqual(['Edit…']);
    expect(button('Edit…').disabled).toBe(true);
    tree.setSystem(system, counts);
    expect(button('Edit…').disabled).toBe(false);
    button('Edit…').click();
    expect(c.onOpenEditor).toHaveBeenCalledOnce();
    tree.setEditable(false);
    expect(button('Edit…').disabled).toBe(true);
  });

  it('dragging a row onto another moves it; onto the header it goes to the root; onto itself or a descendant it does not', () => {
    const c = cb();
    mountCostTree(host, c).setSystem(system, counts);
    const store = drag(rowOf('01.02'), 'dragstart');
    expect(store[COST_CODE_DRAG]).toBe('01.02');
    expect(COST_CODE_DRAG).toBe('application/x-ifcx-cost-code');
    drag(rowOf('02.00'), 'drop', store);
    expect(c.onMove).toHaveBeenLastCalledWith('01.02', '02.00');
    drag(rowOf('01.02'), 'dragstart');
    drag(host.querySelector<HTMLElement>('.cost-tree header')!, 'drop', { [COST_CODE_DRAG]: '01.02' });
    expect(c.onMove).toHaveBeenLastCalledWith('01.02', null);
    c.onMove.mockClear();
    drag(rowOf('02.00'), 'dragstart');
    drag(rowOf('02.01.01'), 'drop', { [COST_CODE_DRAG]: '02.00' });
    drag(rowOf('02.00'), 'drop', { [COST_CODE_DRAG]: '02.00' });
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it('en solo lectura las filas no se arrastran', () => {
    const tree = mountCostTree(host, cb());
    tree.setSystem(system, counts);
    tree.setEditable(false);
    expect(rowOf('01.01').draggable).toBe(false);
  });

  it('without a system it shows the same text as the BOQ', () => {
    mountCostTree(host, cb()).setSystem(null, new Map());
    expect(host.querySelector('.cost-empty')!.textContent).toBe(NO_SYSTEM);
    expect(rows()).toHaveLength(0);
  });
});
