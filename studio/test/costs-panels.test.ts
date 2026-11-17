import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBoq, NO_SYSTEM } from '../src/costs/boqpanel';
import { askCode } from '../src/costs/codedialog';
import { parseNumber } from '../src/costs/format';
import { mountCostProps } from '../src/costs/propspanel';
import type { Budget, BudgetNode } from '../src/costs/budget';
import type { CostCode, CostSystem } from '../src/costs/system';
import type { ElementMeasures } from '../src/costs/takeoff';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});

const code = (c: string, over: Partial<CostCode> = {}): CostCode => ({
  path: `n-${c}`, code: c, name: `Name ${c}`, parent: null, medicion: null, manualPrice: null, origin: null,
  unitPrice: 0, priceFrom: 'none', warning: null, role: 'import', location: 'C:/t/costos.ifcx', ...over,
});
const item = (c: string, over: Partial<CostCode> = {}): CostCode =>
  code(c, { medicion: { unit: 'm³', measure: 'volume' }, unitPrice: 10, priceFrom: 'manual', manualPrice: 10, ...over });
const node = (c: CostCode, over: Partial<BudgetNode> = {}, children: BudgetNode[] = []): BudgetNode => ({
  code: c, level: 1, elements: [], quantity: 0, total: 0, warning: null, children, ...over,
});
const budget = (roots: BudgetNode[], over: Partial<Budget> = {}): Budget => ({
  currency: 'USD', roots, total: roots.reduce((n, r) => n + r.total, 0), elementCost: new Map(), unassigned: [], ...over,
});
const sample = (): Budget =>
  budget([
    node(code('O'), { total: 65 }, [
      node(item('O.1'), { level: 2, quantity: 5, total: 50, elements: ['/a'] }),
      node(item('O.2', { warning: 'No price' }), { level: 2, quantity: 1.5, total: 15, warning: 'No price' }),
    ]),
  ]);

describe('parseNumber', () => {
  it('it accepts a comma or a point and rejects what is not a number', () => {
    expect(parseNumber('7,5')).toBe(7.5);
    expect(parseNumber(' 7.5 ')).toBe(7.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

describe('BOQ', () => {
  const cb = () => ({ onSelect: vi.fn(), onEdit: vi.fn(), onSelectUnassigned: vi.fn() });
  const cells = (tr: Element) => [...tr.querySelectorAll('td,th')].map((c) => c.textContent);

  it('the heading lines carry their subtotal and the item its columns', () => {
    const panel = mountBoq(host, cb());
    panel.setBudget(sample());
    const group = host.querySelectorAll('.cost-group');
    expect(group).toHaveLength(1);
    expect(cells(group[0])).toEqual(['O Name O', '$65.00']);
    const row = host.querySelector('.cost-row[data-code="O.1"]')!;
    expect(cells(row)).toEqual(['O.1', 'Name O.1', 'm³', '5.00', '$10.00', '$50.00']);
    expect(host.querySelector('.cost-total')!.textContent).toContain('$65.00');
    expect([...host.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual(['Code', 'Description', 'Unit', 'Quantity', 'Unit Price', 'Total']);
  });

  it('the indentation grows with the level of the heading line', () => {
    const panel = mountBoq(host, cb());
    const inner = node(code('O.A'), { level: 2 });
    panel.setBudget(budget([node(code('O'), {}, [inner])]));
    const pads = [...host.querySelectorAll<HTMLElement>('.cost-group th')].map((t) => parseInt(t.style.paddingLeft, 10));
    expect(pads[1]).toBeGreaterThan(pads[0]);
  });

  it('it shows the warning of the item', () => {
    mountBoq(host, cb()).setBudget(sample());
    expect(host.querySelector('.cost-row[data-code="O.2"] .cost-warn')!.textContent).toBe('No price');
  });

  it('«Unassigned (n)» va al final, antes del total, y su clic avisa', () => {
    const c = cb();
    const panel = mountBoq(host, c);
    panel.setBudget({ ...sample(), unassigned: [{ path: 'a', reason: 'No code' }, { path: 'b', reason: 'No code' }, { path: 'c', reason: 'Code not in the cost system' }] });
    const un = host.querySelector<HTMLElement>('.cost-unassigned')!;
    expect(un.textContent).toContain('Unassigned (3)');
    const trs = [...host.querySelectorAll('tbody tr')];
    expect(trs.indexOf(un)).toBe(trs.length - 2);
    expect(trs[trs.length - 1].classList.contains('cost-total')).toBe(true);
    un.click();
    expect(c.onSelectUnassigned).toHaveBeenCalledOnce();
  });

  it('sin elementos sin partida no hay fila «Unassigned»', () => {
    mountBoq(host, cb()).setBudget(sample());
    expect(host.querySelector('.cost-unassigned')).toBeNull();
  });

  it('without a system it shows the text and no rows', () => {
    const panel = mountBoq(host, cb());
    panel.setBudget(null);
    expect(host.querySelector('.cost-empty')!.textContent).toBe(NO_SYSTEM);
    expect(NO_SYSTEM).toBe('This model has no cost system. Import a costs IFCx as a layer.');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('click selects; double click and Enter edit, on an item and on a heading line', () => {
    const c = cb();
    mountBoq(host, c).setBudget(sample());
    const row = host.querySelector<HTMLElement>('.cost-row[data-code="O.1"]')!;
    row.click();
    expect(c.onSelect).toHaveBeenCalledWith('O.1');
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(c.onEdit).toHaveBeenLastCalledWith('O.1');
    const group = host.querySelector<HTMLElement>('.cost-group')!;
    group.click();
    expect(c.onSelect).toHaveBeenLastCalledWith('O');
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c.onEdit).toHaveBeenLastCalledWith('O');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(c.onEdit).toHaveBeenLastCalledWith('O.1');
  });

  it('setSelected y markCode marcan las filas sin avisar', () => {
    const c = cb();
    const panel = mountBoq(host, c);
    panel.setBudget(sample());
    panel.setSelected('O.2');
    expect(host.querySelector('.cost-row[data-code="O.2"]')!.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('.cost-row[data-code="O.1"]')!.getAttribute('aria-selected')).toBe('false');
    panel.markCode('O.1');
    expect(host.querySelector('.cost-row[data-code="O.1"]')!.classList.contains('is-marked')).toBe(true);
    expect(c.onSelect).not.toHaveBeenCalled();
  });

  it('the selection survives a new budget', () => {
    const panel = mountBoq(host, cb());
    panel.setBudget(sample());
    panel.setSelected('O.1');
    panel.setBudget(sample());
    expect(host.querySelector('.cost-row[data-code="O.1"]')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('Cost Properties', () => {
  const m: ElementMeasures = { path: '/w', count: 1, length: 4, area: 12, volume: 2.4, weight: null };
  const info = (over: Partial<Parameters<ReturnType<typeof mountCostProps>['show']>[2]> = {}) => ({ code: null, amount: 0, reason: null, ...over });

  it('without a selection it shows the help', () => {
    const p = mountCostProps(host);
    expect(host.querySelector('.cost-empty')!.textContent).toContain('Select an element');
    p.show('/w', null, info(), 'USD');
    expect(host.querySelector('.cost-empty')!.textContent).toContain('Select an element');
  });

  it('an element with an item shows its measures, the item and the amount', () => {
    const p = mountCostProps(host);
    p.show('/w', m, info({ code: item('O.1'), amount: 24 }), 'USD');
    const text = host.textContent!;
    expect(text).toContain('/w');
    expect(text).toContain('12.00');
    expect(text).toContain('—'); // peso sin densidad
    expect(text).toContain('O.1 Name O.1');
    expect(text).toContain('$24.00');
  });

  it('un elemento sin partida dice el motivo', () => {
    const p = mountCostProps(host);
    p.show('/w', m, info({ reason: 'Code not in the cost system' }), 'USD');
    expect(host.textContent).toContain('Code not in the cost system');
    expect(host.querySelector('.cost-share-total')).toBeNull();
  });
});

describe('item dialog', () => {
  const codes = [
    code('O'), code('O.2', { parent: 'O' }), item('O.1', { parent: 'O', name: 'Losa' }), code('P'),
    item('O.1.1', { parent: 'O.1' }),
  ];
  const system: CostSystem = {
    id: 's', name: 's', attribute: 'a', currency: 'USD', codes, warning: null, rootPath: 'root', role: 'import', location: 'C:/t/costos.ifcx', byCode: new Map(codes.map((c) => [c.code, c])),
    children: (p) => codes.filter((c) => c.parent === p),
  };
  const field = (label: string) =>
    [...document.querySelectorAll('.cost-field')].find((f) => f.querySelector('.cost-field-label')!.textContent === label)!.querySelector('input,select') as HTMLInputElement & HTMLSelectElement;
  const click = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click();
  const change = (el: HTMLElement, value: string) => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };
  const get = (c: string) => system.byCode.get(c)!;

  it('the code comes out read-only and the item brings its values', async () => {
    const done = askCode(get('O.1'), system);
    expect(field('Code').readOnly).toBe(true);
    expect(field('Code').value).toBe('O.1');
    expect(field('Description').value).toBe('Losa');
    expect(field('Measure').value).toBe('volume');
    expect(field('Unit').value).toBe('m³');
    expect(field('Heading').value).toBe('O');
    click('Cancel');
    await done;
  });

  it('Save devuelve lo cambiado, con el precio con coma', async () => {
    const done = askCode(get('O.1'), system);
    change(field('Description'), '  Losa nueva ');
    change(field('Heading'), 'P');
    change(field('Measure'), 'area');
    change(field('Unit'), 'm2');
    change(field('Manual price'), '7,5');
    click('Save');
    expect(await done).toEqual({ name: 'Losa nueva', parent: 'P', medicion: { unit: 'm2', measure: 'area' }, manualPrice: 7.5, origin: null });
  });

  it('the parent offers only heading lines, without the code itself or its descendants', async () => {
    const done = askCode(get('O'), system);
    expect([...field('Heading').options].map((o) => o.value)).toEqual(['', 'P']);
    click('Cancel');
    await done;
    const done2 = askCode(get('O.1'), system);
    expect([...field('Heading').options].map((o) => o.value)).toEqual(['', 'O', 'O.2', 'P']);
    click('Cancel');
    await done2;
  });

  it('a price that is not a number warns and leaves the dialog open', async () => {
    const done = askCode(get('O.1'), system);
    change(field('Manual price'), 'abc');
    click('Save');
    expect(document.querySelector('.cost-error')!.textContent).toBe('Enter a valid number');
    expect(document.querySelector('.cost-item-dialog')).not.toBeNull();
    click('Cancel');
    expect(await done).toBeNull();
  });

  it('cambiar el precio a mano borra su origen; no tocarlo no dice nada del origen', async () => {
    const withOrigin = item('W', { origin: { doc: 'C:/q/a.pdf', cell: 'p1!r1' }, manualPrice: 10 });
    const sys2 = { ...system, codes: [...codes, withOrigin], byCode: new Map([...system.byCode, ['W', withOrigin]]) };
    const done = askCode(withOrigin, sys2);
    change(field('Manual price'), '11');
    click('Save');
    expect((await done)!.origin).toBeNull();
    const again = askCode(withOrigin, sys2);
    change(field('Description'), 'Otro');
    click('Save');
    expect('origin' in (await again)!).toBe(false);
  });

  it('it says which file the price came from, and writing it by hand turns it into a manual price', async () => {
    const withOrigin = item('W', { origin: { doc: 'C:/q/Cotización Acme.pdf', cell: 'B3' }, manualPrice: 10 });
    const done = askCode(withOrigin, { ...system, codes: [...codes, withOrigin], byCode: new Map([...system.byCode, ['W', withOrigin]]) });
    const status = () => document.querySelector('.cost-price-status')!.textContent;
    expect(status()).toBe('From Cotización Acme.pdf · cell B3');
    change(field('Manual price'), '11');
    expect(status()).toBe('Manual price');
    click('Cancel');
    await done;
  });

  it('without a measure it is a heading line', async () => {
    const done = askCode(get('O.1'), system);
    change(field('Measure'), 'none');
    click('Save');
    expect((await done)!.medicion).toBeNull();
  });

  it('cambiar la medida rellena la unidad mientras no se haya tocado', async () => {
    const done = askCode(get('O'), system);
    change(field('Measure'), 'length');
    expect(field('Unit').value).toBe('m');
    change(field('Unit'), 'ml');
    change(field('Measure'), 'area');
    expect(field('Unit').value).toBe('ml');
    click('Cancel');
    await done;
  });

  it('an empty description warns', async () => {
    const done = askCode(get('O.1'), system);
    change(field('Description'), ' ');
    click('Save');
    expect(document.querySelector('.cost-error')!.textContent).toBe('Enter a description');
    click('Cancel');
    await done;
  });

  it('Esc cancela', async () => {
    const done = askCode(get('O.1'), system);
    document.querySelector('.cost-item-dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await done).toBeNull();
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
  });
});
