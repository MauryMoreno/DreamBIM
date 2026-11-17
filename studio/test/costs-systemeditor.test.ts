import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askSystemEdit } from '../src/costs/systemeditor';
import type { CostCode, CostSystem } from '../src/costs/system';
import type { DocState } from '../src/costs/docpicker';

beforeEach(() => {
  document.body.replaceChildren();
});

const code = (c: string, parent: string | null, over: Partial<CostCode> = {}): CostCode => ({
  path: `n-${c}`, code: c, name: `Name ${c}`, parent, medicion: null, manualPrice: null, origin: null,
  unitPrice: 0, priceFrom: 'none', warning: null, role: 'import', location: 'C:/t/costos.ifcx', ...over,
});
const codes = [
  code('01.00', null),
  code('01.01', '01.00', { medicion: { unit: 'm³', measure: 'volume' } }),
  code('01.02', '01.00', { medicion: { unit: 'ml', measure: 'length' }, manualPrice: 12, origin: { doc: 'C:/q/vieja.pdf', cell: 'pg1.3' } }),
  code('02.00', null),
];
const system: CostSystem = {
  id: 's', name: 's', attribute: 'a', currency: 'USD', codes, warning: null, rootPath: 'root', role: 'import', location: 'C:/t/costos.ifcx',
  byCode: new Map(codes.map((c) => [c.code, c])),
  children: (p) => codes.filter((c) => c.parent === p),
};
const dialog = () => document.querySelector<HTMLElement>('.cost-sys-dialog');
const rows = () => [...document.querySelectorAll<HTMLElement>('.cost-sys-row')];
const rowOf = (c: string) => rows().find((r) => r.querySelector<HTMLInputElement>('.cost-sys-code')!.value === c)!;
const cell = <T extends HTMLElement>(r: HTMLElement, cls: string) => r.querySelector<T>(cls)!;
const click = (text: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click();
const type = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const open = (o: Partial<Parameters<typeof askSystemEdit>[1]> = {}) => askSystemEdit(system, { currency: 'USD', ...o });

describe('editor del sistema de costos', () => {
  it('it shows the columns and the codes as a tree; the code of those that exist is not edited', async () => {
    const done = open();
    expect([...dialog()!.querySelectorAll('.cost-sys-head span')].map((s) => s.textContent)).toEqual(['Code', 'Description', 'Unit', 'Price (USD)', 'Reference', '', '']);
    expect(rows().map((r) => cell<HTMLInputElement>(r, '.cost-sys-code').value)).toEqual(['01.00', '01.01', '01.02', '02.00']);
    // the columns do not move: the indentation goes only in the code cell, and header and rows have the same cells
    const indent = (c: string) => parseInt(cell<HTMLElement>(rowOf(c), '.cost-sys-codecell').style.paddingLeft, 10);
    expect(indent('01.01')).toBeGreaterThan(indent('01.00'));
    expect(rowOf('01.01').style.paddingLeft).toBe('');
    expect(rowOf('01.01').children).toHaveLength(dialog()!.querySelectorAll('.cost-sys-head span').length);
    expect(cell<HTMLInputElement>(rowOf('01.01'), '.cost-sys-code').readOnly).toBe(true);
    expect(cell<HTMLInputElement>(rowOf('01.01'), '.cost-sys-name').value).toBe('Name 01.01');
    expect(cell<HTMLSelectElement>(rowOf('01.01'), '.cost-sys-unit').value).toBe('m³');
    expect(cell<HTMLSelectElement>(rowOf('01.00'), '.cost-sys-unit').value).toBe('');
    // a unit of the file itself is kept as an option
    expect(cell<HTMLSelectElement>(rowOf('01.02'), '.cost-sys-unit').value).toBe('ml');
    expect(cell<HTMLInputElement>(rowOf('01.02'), '.cost-sys-price').value).toBe('12');
    // the reference is the file the price came from, in its column, with the button to choose it
    expect(cell(rowOf('01.02'), '.cost-sys-refcell .cost-sys-origin').textContent).toBe('vieja.pdf · page 1');
    expect(rowOf('01.01').querySelector('.cost-sys-refcell .cost-sys-doc')).not.toBeNull();
    expect(rowOf('01.01').querySelector('.cost-sys-refcell .cost-sys-origin')).toBeNull();
    click('Cancel');
    expect(await done).toBeNull();
  });

  it('Save returns all the codes with what changed, and the unit decides the measurement', async () => {
    const done = open();
    type(cell(rowOf('01.01'), '.cost-sys-name'), ' Losas ');
    type(cell(rowOf('01.01'), '.cost-sys-unit'), 'm²');
    type(cell(rowOf('01.01'), '.cost-sys-price'), '7,5');
    type(cell(rowOf('02.00'), '.cost-sys-unit'), 'kg');
    click('Save');
    const out = (await done)!;
    expect(out.find((e) => e.code === '01.01')).toEqual({ code: '01.01', name: 'Losas', parent: '01.00', medicion: { unit: 'm²', measure: 'area' }, manualPrice: 7.5, origin: null });
    expect(out.find((e) => e.code === '01.02')).toEqual({ code: '01.02', name: 'Name 01.02', parent: '01.00', medicion: { unit: 'ml', measure: 'length' }, manualPrice: 12, origin: { doc: 'C:/q/vieja.pdf', cell: 'pg1.3' } });
    expect(out.find((e) => e.code === '02.00')!.medicion).toEqual({ unit: 'kg', measure: 'weight' });
    expect(out.find((e) => e.code === '01.00')!.medicion).toBeNull();
    expect(out).toHaveLength(4);
  });

  it('+ Code adds a row at the root and + on a row adds a child; the new ones are saved', async () => {
    const done = open();
    click('+ Code');
    const root = rows().at(-1)!;
    expect(cell<HTMLInputElement>(root, '.cost-sys-code').readOnly).toBe(false);
    type(cell(root, '.cost-sys-code'), '03.00');
    type(cell(root, '.cost-sys-name'), 'Instalaciones');
    rowOf('03.00').querySelector<HTMLButtonElement>('.cost-sys-add')!.click();
    const child = rows()[rows().indexOf(rowOf('03.00')) + 1];
    type(cell(child, '.cost-sys-code'), '03.01');
    type(cell(child, '.cost-sys-unit'), 'u');
    click('Save');
    const out = (await done)!;
    expect(out.find((e) => e.code === '03.00')).toEqual({ code: '03.00', name: 'Instalaciones', parent: null, medicion: null, manualPrice: null, origin: null });
    expect(out.find((e) => e.code === '03.01')).toMatchObject({ parent: '03.00', medicion: { unit: 'u', measure: 'count' } });
  });

  it('borrar una fila quita su rama; si deja elementos sin partida pregunta antes', async () => {
    const confirm = vi.fn(async () => false);
    const done = open({ confirm, elementsIn: (c) => (c === '01.00' ? 3 : 0) });
    rowOf('01.00').querySelector<HTMLButtonElement>('.cost-sys-del')!.click();
    await Promise.resolve();
    expect(confirm).toHaveBeenCalledWith('Delete 01.00 and 2 codes below it? 3 elements will be left without an item.', 'Delete');
    expect(rows()).toHaveLength(4);
    confirm.mockResolvedValueOnce(true);
    rowOf('01.00').querySelector<HTMLButtonElement>('.cost-sys-del')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(rows().map((r) => cell<HTMLInputElement>(r, '.cost-sys-code').value)).toEqual(['02.00']);
    rowOf('02.00').querySelector<HTMLButtonElement>('.cost-sys-del')!.click();
    await Promise.resolve();
    expect(rows()).toHaveLength(0);
    click('Save');
    expect(await done).toEqual([]);
  });

  it('it warns and does not close with an empty or repeated code or a price that is not a number', async () => {
    const done = open();
    click('+ Code');
    click('Save');
    expect(dialog()!.querySelector('.cost-error')!.textContent).toBe('Enter a code');
    type(cell(rows().at(-1)!, '.cost-sys-code'), '02.00');
    click('Save');
    expect(dialog()!.querySelector('.cost-error')!.textContent).toBe('This code already exists');
    type(cell(rows().at(-1)!, '.cost-sys-code'), '04.00');
    type(cell(rowOf('01.02'), '.cost-sys-price'), 'abc');
    click('Save');
    expect(dialog()!.querySelector('.cost-error')!.textContent).toBe('Enter a valid number');
    expect(dialog()).not.toBeNull();
    click('Cancel');
    expect(await done).toBeNull();
  });

  it('the search filters by code or description', async () => {
    const done = open();
    type(dialog()!.querySelector<HTMLInputElement>('.cost-sys-search')!, 'name 01.02');
    expect(rows().map((r) => cell<HTMLInputElement>(r, '.cost-sys-code').value)).toEqual(['01.02']);
    type(dialog()!.querySelector<HTMLInputElement>('.cost-sys-search')!, '');
    expect(rows()).toHaveLength(4);
    click('Cancel');
    await done;
  });

  it('collapsing a heading line hides its branch without losing what was edited', async () => {
    const done = open();
    type(cell(rowOf('01.01'), '.cost-sys-name'), 'Cambiado');
    rowOf('01.00').querySelector<HTMLButtonElement>('.cost-sys-toggle')!.click();
    expect(rows().map((r) => cell<HTMLInputElement>(r, '.cost-sys-code').value)).toEqual(['01.00', '02.00']);
    click('Save');
    expect((await done)!.find((e) => e.code === '01.01')!.name).toBe('Cambiado');
  });

  it('Esc cancela', async () => {
    const done = open();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await done).toBeNull();
    expect(dialog()).toBeNull();
  });
});

describe('precio desde un documento', () => {
  const quote = (): DocState => ({ doc: { name: 'cotizacion.txt', path: 'C:/q/cotizacion.txt', grid: [['Concreto', '150,50'], ['Acero', '1,15']] }, decimal: ',' });
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const pickerButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.doc-picker button')].find((b) => b.textContent === text)!;

  it('the document button of an item fills in the price and its origin', async () => {
    const done = open({ docState: quote() });
    rowOf('01.01').querySelector<HTMLButtonElement>('.cost-sys-doc')!.click();
    document.querySelector<HTMLElement>('[data-cell="B1"]')!.click();
    await flush();
    expect(cell<HTMLInputElement>(rowOf('01.01'), '.cost-sys-price').value).toBe('150.5');
    expect(cell(rowOf('01.01'), '.cost-sys-origin').textContent).toBe('cotizacion.txt · cell B1');
    click('Save');
    expect((await done)!.find((e) => e.code === '01.01')).toMatchObject({ manualPrice: 150.5, origin: { doc: 'C:/q/cotizacion.txt', cell: 'B1' } });
  });

  it('cancelling the picker leaves the price and the origin that were there', async () => {
    const done = open({ docState: quote() });
    rowOf('01.02').querySelector<HTMLButtonElement>('.cost-sys-doc')!.click();
    await flush();
    pickerButton('Cancel').click();
    await flush();
    expect(cell<HTMLInputElement>(rowOf('01.02'), '.cost-sys-price').value).toBe('12');
    expect(cell(rowOf('01.02'), '.cost-sys-origin').textContent).toContain('vieja.pdf');
    click('Cancel');
    await done;
  });

  it('writing the price by hand clears the origin; changing the description or the unit does not', async () => {
    const keep = open();
    type(cell(rowOf('01.02'), '.cost-sys-name'), 'Otro');
    type(cell(rowOf('01.02'), '.cost-sys-unit'), 'm');
    click('Save');
    expect((await keep)!.find((e) => e.code === '01.02')!.origin).toEqual({ doc: 'C:/q/vieja.pdf', cell: 'pg1.3' });
    const drop = open();
    type(cell(rowOf('01.02'), '.cost-sys-price'), '13');
    expect(rowOf('01.02').querySelector('.cost-sys-origin')).toBeNull();
    click('Save');
    expect((await drop)!.find((e) => e.code === '01.02')!.origin).toBeNull();
  });

  it('un origen cuyo documento ya no se puede leer abre el selector sin romper el editor', async () => {
    const done = open({ readFile: async () => { throw new Error('not found'); } });
    rowOf('01.02').querySelector<HTMLButtonElement>('.cost-sys-doc')!.click();
    await flush();
    expect(document.querySelector('.doc-picker')!.textContent).toContain('Could not open vieja.pdf');
    pickerButton('Cancel').click();
    await flush();
    expect(dialog()).not.toBeNull();
    click('Cancel');
    expect(await done).toBeNull();
  });

  it('con el selector abierto, Esc cierra el selector y no el editor', async () => {
    const done = open({ docState: quote() });
    const docBtn = rowOf('01.01').querySelector<HTMLButtonElement>('.cost-sys-doc')!;
    docBtn.focus();
    docBtn.click();
    await flush();
    // aunque el foco se haya quedado en el editor, Esc no lo cierra mientras hay un selector encima
    docBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).not.toBeNull();
    // the focus goes to the picker, and there Esc closes it
    expect(document.activeElement?.closest('.doc-picker')).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(document.querySelector('.doc-picker')).toBeNull();
    expect(dialog()).not.toBeNull();
    click('Cancel');
    await done;
  });

  it('heading lines have no document button', async () => {
    const done = open();
    expect(rowOf('01.00').querySelector('.cost-sys-doc')).toBeNull();
    expect(rowOf('01.01').querySelector('.cost-sys-doc')).not.toBeNull();
    click('Cancel');
    await done;
  });

  it('the footer counts the codes and names the file', async () => {
    const done = open({ file: 'costos-sistema.ifcx' });
    expect(dialog()!.querySelector('.cost-sys-foot')!.textContent).toBe('4 codes · costos-sistema.ifcx');
    click('+ Code');
    expect(dialog()!.querySelector('.cost-sys-foot')!.textContent).toBe('5 codes · costos-sistema.ifcx');
    click('Cancel');
    await done;
  });
});
