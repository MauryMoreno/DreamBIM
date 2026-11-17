// Costs mode over a composed model with three layers: the cost system, the prices and the assignment.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import type { LoadedModel } from '../src/model/load';
import type { QuantityRow } from '../src/render/viewer';
import { itemColor } from '../src/costs/colors';
import { createCostsMode, type CostsActions } from '../src/costs/mode';
import { K_COST_SYSTEM, readCostSystem } from '../src/costs/system';
import { NO_MATERIAL } from '../src/materials/catalog';
import { emptyAssignment } from '../src/costs/assign';
import { COST_CODE_DRAG } from '../src/costs/treepanel';
import type { ComposeResult } from '../src/ifcx/compose';

const ATTR = 'prj::costos::codigo';
const file = (id: string, data: IfcxNode[]): IfcxFile => ({
  header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data,
});
const src = (name: string, location: string | undefined = `C:/t/${name}`): ProvenanceSource => ({ role: 'import', name, uri: name, ...(location ? { location } : {}) });
const docSrc: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document' };
const m3 = { unit: 'm³', measure: 'volume' };

const prices = file('precios', [
  { path: 'ins-x', attributes: { 'prj::apu::insumo': { codigo: 'X', descripcion: 'Insumo X', unidad: 'u', tipo: 'material', precio: 7 } } },
  { path: 'apu-1', attributes: { 'studio::cost::price': { code: 'APU-1', description: 'Losa', unit: 'm³', price: 100 } } },
]);
const costs = (): IfcxFile =>
  file('costos', [
    { path: 'root', attributes: { [K_COST_SYSTEM]: { id: 'c', name: 'C', attribute: ATTR, currency: 'USD' } } },
    { path: 'code-01', attributes: { [ATTR]: { code: '01', name: 'Structure' } } },
    { path: 'code-01.01', attributes: { [ATTR]: { code: '01.01', name: 'Slabs', parent: '01' }, 'prj::medicion': m3, 'prj::precio': 100 } },
    { path: 'code-01.02', attributes: { [ATTR]: { code: '01.02', name: 'Posts', parent: '01' }, 'prj::medicion': { unit: 'u', measure: 'count' }, 'prj::precio': 12 } },
  ]);
const cls = { 'bsi::ifc::class': { code: 'IfcSlab' } };
const elements = file('m', [
  { path: 'E1', inherits: { costos: 'code-01.01' }, attributes: cls },
  { path: 'E2', inherits: { costos: 'code-01.01' }, attributes: cls },
  { path: 'E3', inherits: { costos: 'code-01.02' }, attributes: cls },
  { path: 'E4', attributes: cls },
]);

function build(costsSource: ProvenanceSource = src('costos.ifcx')): LoadedModel {
  const result = compose([prices, costs(), elements], { sources: [src('precios.ifcx'), costsSource, docSrc] });
  return { name: 'm', path: 'C:/t/m.ifcx', result, warnings: [] };
}
const path = (m: LoadedModel, origin: string) => m.result.byOrigin.get(origin)![0].path;
const row = (element: string, volume: number): QuantityRow => ({
  element, name: element, cls: 'IfcSlab', storey: 'L1', material: '', materialCode: null, box: [0, 0, 0, 1, 1, volume], volume, area: 1,
});

function setup(over: { model?: LoadedModel | null; editable?: boolean; saveOk?: boolean; confirm?: boolean } = {}) {
  const model = over.model === undefined ? build() : over.model;
  const actions = {
    materials: vi.fn(() => []),
    saveFile: vi.fn(async (_l: string, _label: string, _c: (f: IfcxFile) => IfcxFile | string) => over.saveOk ?? true),
    assign: vi.fn(async (_label: string, _c: (f: IfcxFile, r: ComposeResult) => IfcxFile | string) => true),
    confirm: vi.fn(async (_m: string, _ok: string) => over.confirm ?? true),
    openQuote: vi.fn(async () => ({ name: 'q.txt', path: 'C:/q/q.txt', grid: [['Losa', '99']] })),
    readQuote: vi.fn(async (_p: string) => ({ name: 'q.txt', path: 'C:/q/q.txt', grid: [['Losa', '99']] })),
  } satisfies CostsActions;
  const volumes: [string, number][] = [['E1', 2], ['E2', 3], ['E3', 1], ['E4', 1]];
  const rows = model ? volumes.flatMap(([o, v]) => (model.result.byOrigin.has(o) ? [row(path(model, o), v)] : [])) : [];
  const viewer = { quantities: vi.fn(() => rows), setColorOverride: vi.fn(), selectMany: vi.fn() };
  let selected: string | null = null;
  let many: string[] = [];
  const toast = vi.fn();
  const mode = createCostsMode({
    actions, viewer, model: () => model, selected: () => selected, selection: () => many, wallLength: () => null, toast, editable: over.editable ?? true,
  });
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  host.append(mode.panel(0)!, mode.panel(1)!, mode.panel(2)!);
  return { mode, actions, viewer, toast, host, model, select: (p: string | null) => (selected = p), selectMany: (ps: string[]) => ((many = ps), (selected = ps.at(-1) ?? null)), rows };
}
const lastColors = (v: { setColorOverride: ReturnType<typeof vi.fn> }) => v.setColorOverride.mock.calls.at(-1)![0] as ((p: string) => { color: string; opacity: number }) | null;

beforeEach(() => {
  document.body.replaceChildren();
});

describe('modo Costs', () => {
  it('entering paints the BOQ with the quantities, the prices and the totals', () => {
    const { mode, host } = setup();
    mode.enter();
    // 01.01: (2 + 3) m³ × 100 por la referencia; 01.02: 1 u × 12 a mano
    expect(host.querySelector('.cost-row[data-code="01.01"]')!.textContent).toContain('$500.00');
    expect(host.querySelector('.cost-row[data-code="01.02"]')!.textContent).toContain('$12.00');
    expect(host.querySelector('.cost-group')!.textContent).toContain('$512.00');
    expect(host.querySelector('.cost-total')!.textContent).toContain('$512.00');
    expect(host.querySelector('.cost-unassigned')!.textContent).toContain('Unassigned (1)');
  });

  it('sin sistema de costos la BOQ lo dice y no hay filas', () => {
    const empty = file('m', [{ path: 'E1', attributes: cls }]);
    const model = { name: 'm', path: null, result: compose([empty], { sources: [docSrc] }), warnings: [] } as LoadedModel;
    const { mode, host } = setup({ model });
    mode.enter();
    expect(host.querySelector('.cost-boq .cost-empty')!.textContent).toContain('no cost system');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('un modelo con el presupuesto anterior (IfcCostSchedule) y sin sistema avisa una sola vez', () => {
    const old = file('m', [{ path: 'E1', attributes: cls }, { path: 'budget', attributes: { 'prj::ifc::CostSchedule': { PredefinedType: 'BUDGET', Currency: 'USD' } } }]);
    const model = { name: 'm', path: null, result: compose([old], { sources: [docSrc] }), warnings: [] } as LoadedModel;
    const { mode, toast } = setup({ model });
    mode.enter();
    mode.refresh();
    const calls = toast.mock.calls.filter((c) => String(c[0]).includes('previous budget format'));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('no longer reads');
  });

  it('sin modelo tampoco falla', () => {
    const { mode, host } = setup({ model: null });
    mode.enter();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('clicking an item selects its elements and a heading line those of everything that hangs from it', () => {
    const { mode, host, viewer, model } = setup();
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.01"]')!.click();
    expect(viewer.selectMany).toHaveBeenLastCalledWith([path(model!, 'E1'), path(model!, 'E2')]);
    host.querySelector<HTMLElement>('.cost-group')!.click();
    expect(new Set(viewer.selectMany.mock.calls.at(-1)![0])).toEqual(new Set([path(model!, 'E1'), path(model!, 'E2'), path(model!, 'E3')]));
  });

  it('pulsar «Unassigned» selecciona los elementos sin partida', () => {
    const { mode, host, viewer, model } = setup();
    mode.enter();
    host.querySelector<HTMLElement>('.cost-unassigned')!.click();
    expect(viewer.selectMany).toHaveBeenLastCalledWith([path(model!, 'E4')]);
  });

  it('the selected element shows its item and its amount', () => {
    const { mode, host, model, select } = setup();
    mode.enter();
    const e2 = path(model!, 'E2');
    select(e2);
    mode.selectionChanged(e2);
    const text = host.querySelector('.cost-props')!.textContent!;
    expect(text).toContain('01.01 Slabs');
    expect(text).toContain('$300.00');
    expect(host.querySelector('.cost-row[data-code="01.01"]')!.classList.contains('is-marked')).toBe(true);
  });

  it('an element without a code says why it has no item', () => {
    const { mode, host, model, select } = setup();
    mode.enter();
    const e4 = path(model!, 'E4');
    select(e4);
    mode.selectionChanged(e4);
    expect(host.querySelector('.cost-props')!.textContent).toContain('No code');
  });

  it('Color By: item gives one color per item, cost a ramp and off removes it', () => {
    const { mode, viewer, model } = setup();
    mode.enter();
    const f = lastColors(viewer)!;
    expect(f(path(model!, 'E1')).color).toBe(itemColor(0));
    expect(f(path(model!, 'E3')).color).toBe(itemColor(1));
    expect(f(path(model!, 'E4'))).toEqual(NO_MATERIAL);
    mode.setColorBy('cost');
    const g = lastColors(viewer)!;
    expect(g(path(model!, 'E2')).color).not.toBe(NO_MATERIAL.color);
    expect(g(path(model!, 'E4'))).toEqual(NO_MATERIAL);
    mode.setColorBy('off');
    expect(lastColors(viewer)).toBeNull();
  });

  it('al salir del modo se quita el color', () => {
    const { mode, viewer } = setup();
    mode.enter();
    mode.leave();
    expect(lastColors(viewer)).toBeNull();
  });
});

describe('editar una partida', () => {
  const field = (label: string) =>
    [...document.querySelectorAll('.cost-field')].find((f) => f.querySelector('.cost-field-label')!.textContent === label)!.querySelector('input,select') as HTMLInputElement & HTMLSelectElement;
  const click = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click();
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it('Edit Item opens the dialog of the chosen item and Save writes to the file of the code', async () => {
    const { mode, host, actions } = setup();
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    void mode.editItem();
    expect(field('Code').value).toBe('01.02');
    field('Manual price').value = '15';
    click('Save');
    await flush();
    expect(actions.saveFile).toHaveBeenCalledTimes(1);
    const [location, label, change] = actions.saveFile.mock.calls[0];
    expect([location, label]).toEqual(['C:/t/costos.ifcx', 'Edit Cost Item']);
    const out = change(costs()) as IfcxFile;
    expect(out.data.find((n) => n.path === 'code-01.02')!.attributes!['prj::precio']).toBe(15);
  });

  it('a double click on the row also opens the dialog, and on a heading line', () => {
    const { mode, host } = setup();
    mode.enter();
    host.querySelector('.cost-group')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(field('Code').value).toBe('01');
    click('Cancel');
  });

  it('Cancel no guarda nada', async () => {
    const { mode, host, actions } = setup();
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    void mode.editItem();
    click('Cancel');
    await flush();
    expect(actions.saveFile).not.toHaveBeenCalled();
  });

  it('sin partida elegida Edit Item no hace nada', async () => {
    const { mode, actions } = setup();
    mode.enter();
    await mode.editItem();
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
    expect(actions.saveFile).not.toHaveBeenCalled();
  });

  it('in read-only it does not open the dialog', async () => {
    const { mode, host } = setup({ editable: false });
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    await mode.editItem();
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
  });

  it('if the system file has no path it warns and does not open the dialog', async () => {
    const { mode, host, toast, actions } = setup({ model: build({ role: 'import', name: 'costos.ifcx', uri: 'costos.ifcx' }) });
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    await mode.editItem();
    expect(toast).toHaveBeenCalledWith('Save the costs file first', 'info');
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
    expect(actions.saveFile).not.toHaveBeenCalled();
  });

  it('si guardar falla avisa en lugar de perder el error', async () => {
    const { mode, host, toast, actions } = setup();
    actions.saveFile.mockRejectedValueOnce(new Error('disk full'));
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    void mode.editItem();
    click('Save');
    await flush();
    expect(toast).toHaveBeenCalledWith('Could not save the cost item: disk full', 'error');
  });

  it('a code of a document layer or of the Layer panel is not edited: it would be written over the model on save', async () => {
    const layer: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document', location: 'C:/t/m.ifcx' };
    const { mode, host, toast, actions } = setup({ model: build(layer) });
    mode.enter();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    await mode.editItem();
    expect(toast).toHaveBeenCalledWith('Edit the costs file where it is imported', 'info');
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
    expect(actions.saveFile).not.toHaveBeenCalled();
  });

  it('the system warning (two systems) comes out only once', () => {
    const second = file('otro', [{ path: 'root2', attributes: { [K_COST_SYSTEM]: { id: 'c2', name: 'C2', attribute: ATTR } } }]);
    const result = compose([prices, costs(), second, elements], { sources: [src('precios.ifcx'), src('costos.ifcx'), src('otro.ifcx'), docSrc] });
    expect(readCostSystem(result)!.warning).toContain('c2');
    const { mode, toast } = setup({ model: { name: 'm', path: null, result, warnings: [] } });
    mode.enter();
    mode.refresh();
    expect(toast.mock.calls.filter((c) => String(c[0]).includes('c2'))).toHaveLength(1);
  });
});

describe('system tree and assignment', () => {
  const click = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent === text)!.click();
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const treeRow = (host: HTMLElement, c: string) => host.querySelector<HTMLElement>(`.cost-tree-row[data-code="${c}"]`)!;
  const nodeOf = (f: IfcxFile, p: string) => f.data.find((n) => n.path === p);

  it('the left panel shows the system tree and its selection goes with the BOQ', () => {
    const { mode, host, viewer, model } = setup();
    mode.enter();
    expect([...host.querySelectorAll<HTMLElement>('.cost-tree-row')].map((r) => r.dataset.code)).toEqual(['01', '01.01', '01.02']);
    expect(treeRow(host, '01').querySelector('.cost-tree-count')!.textContent).toBe('3');
    // choosing in the tree does not change the 3D selection: elements are selected first and then the item is chosen
    viewer.selectMany.mockClear();
    treeRow(host, '01.01').click();
    expect(host.querySelector('.cost-row[data-code="01.01"]')!.getAttribute('aria-selected')).toBe('true');
    expect(viewer.selectMany).not.toHaveBeenCalled();
    host.querySelector<HTMLElement>('.cost-row[data-code="01.01"]')!.click();
    expect(viewer.selectMany).toHaveBeenLastCalledWith([path(model!, 'E1'), path(model!, 'E2')]);
    host.querySelector<HTMLElement>('.cost-row[data-code="01.02"]')!.click();
    expect(treeRow(host, '01.02').getAttribute('aria-selected')).toBe('true');
  });

  it('Edit… abre todo el sistema en el editor y Save lo escribe en un solo paso', async () => {
    const { mode, host, actions } = setup();
    mode.enter();
    [...host.querySelectorAll<HTMLButtonElement>('.cost-tree button')].find((b) => b.textContent === 'Edit…')!.click();
    const row = [...document.querySelectorAll<HTMLElement>('.cost-sys-row')].find((r) => r.querySelector<HTMLInputElement>('.cost-sys-code')!.value === '01.01')!;
    const name = row.querySelector<HTMLInputElement>('.cost-sys-name')!;
    name.value = 'Losas';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    click('Save');
    await flush();
    const [location, label, change] = actions.saveFile.mock.calls[0];
    expect([location, label]).toEqual(['C:/t/costos.ifcx', 'Edit Cost System']);
    expect((nodeOf(change(costs()) as IfcxFile, 'code-01.01')!.attributes![ATTR] as { name: string }).name).toBe('Losas');
  });

  it('el editor abre documentos con el modo y recuerda el abierto entre aperturas', async () => {
    const { mode, actions } = setup();
    mode.enter();
    const docButton = () => [...document.querySelectorAll<HTMLElement>('.cost-sys-row')].find((r) => r.querySelector<HTMLInputElement>('.cost-sys-code')!.value === '01.02')!.querySelector<HTMLButtonElement>('.cost-sys-doc')!;
    const pickerButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.doc-picker button')].find((b) => b.textContent === text)!;
    void mode.editSystem();
    docButton().click();
    await flush();
    pickerButton('Open File…').click();
    await flush();
    expect(actions.openQuote).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLElement>('[data-cell="B1"]')!.click();
    await flush();
    click('Cancel');
    await flush();
    void mode.editSystem();
    docButton().click();
    await flush();
    // el documento sigue abierto: no hace falta abrirlo otra vez
    expect(document.querySelector('[data-cell="B1"]')).not.toBeNull();
    expect(actions.openQuote).toHaveBeenCalledTimes(1);
    pickerButton('Cancel').click();
    await flush();
    click('Cancel');
    await flush();
  });

  it('borrar en el editor pregunta con los elementos de la rama', async () => {
    const { mode, actions } = setup({ confirm: false });
    mode.enter();
    void mode.editSystem();
    const row = [...document.querySelectorAll<HTMLElement>('.cost-sys-row')].find((r) => r.querySelector<HTMLInputElement>('.cost-sys-code')!.value === '01')!;
    row.querySelector<HTMLButtonElement>('.cost-sys-del')!.click();
    await flush();
    expect(actions.confirm).toHaveBeenCalledWith('Delete 01 and 2 codes below it? 3 elements will be left without an item.', 'Delete');
    click('Cancel');
    await flush();
    expect(actions.saveFile).not.toHaveBeenCalled();
  });

  it('moving in the tree writes the parent', () => {
    const { mode, host, actions } = setup();
    mode.enter();
    const store: Record<string, string> = {};
    const dragEvent = (type: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { types: [COST_CODE_DRAG], setData: (k: string, v: string) => (store[k] = v), getData: (k: string) => store[k] ?? '' } });
      return ev;
    };
    treeRow(host, '01.02').dispatchEvent(dragEvent('dragstart'));
    host.querySelector('.cost-tree header')!.dispatchEvent(dragEvent('drop'));
    const [, label, change] = actions.saveFile.mock.calls[0];
    expect(label).toBe('Move Cost Code');
    expect(nodeOf(change(costs()) as IfcxFile, 'code-01.02')!.attributes![ATTR]).toEqual({ code: '01.02', name: 'Posts' });
  });

  it('Assign to Selection asigna la partida elegida a lo seleccionado', async () => {
    const { mode, host, actions, selectMany, model } = setup();
    mode.enter();
    treeRow(host, '01.02').click();
    selectMany([path(model!, 'E4'), path(model!, 'E1')]);
    await mode.assignToSelection();
    const [label, change] = actions.assign.mock.calls[0];
    expect(label).toBe('Assign Cost Item');
    expect((change(emptyAssignment('x'), model!.result) as IfcxFile).data).toEqual([
      { path: 'E4', inherits: { costos: 'code-01.02' } },
      { path: 'E1', inherits: { costos: 'code-01.02' } },
    ]);
  });

  it('assigning a heading line is rejected, and without a selection it warns', async () => {
    const { mode, host, actions, toast, selectMany, model } = setup();
    mode.enter();
    treeRow(host, '01').click();
    selectMany([path(model!, 'E4')]);
    await mode.assignToSelection();
    expect(toast).toHaveBeenCalledWith('Choose an item, not a heading', 'info');
    treeRow(host, '01.01').click();
    selectMany([]);
    await mode.assignToSelection();
    expect(toast).toHaveBeenCalledWith('Select elements first', 'info');
    expect(actions.assign).not.toHaveBeenCalled();
  });

  it('if after assigning or removing the element keeps another code, it warns that another layer fixes it', async () => {
    // the test action does not change the model: E1 stays with 01.01, as if its code came from a stronger source
    const { mode, host, toast, selectMany, model, actions } = setup();
    mode.enter();
    treeRow(host, '01.02').click();
    selectMany([path(model!, 'E1'), path(model!, 'E4')]);
    await mode.assignToSelection();
    expect(toast).toHaveBeenCalledWith('2 elements keep a code set in another layer', 'info');
    toast.mockClear();
    selectMany([path(model!, 'E1')]);
    await mode.clearAssignment();
    expect(toast).toHaveBeenCalledWith('1 element keeps a code set in another layer', 'info');
    toast.mockClear();
    actions.assign.mockResolvedValueOnce(false);
    await mode.clearAssignment();
    expect(toast).not.toHaveBeenCalled();
    // un elemento que ya tiene la partida no avisa
    toast.mockClear();
    treeRow(host, '01.01').click();
    selectMany([path(model!, 'E1')]);
    await mode.assignToSelection();
    expect(toast).not.toHaveBeenCalled();
  });

  it('Clear Assignment removes the code from what is selected', async () => {
    const { mode, actions, selectMany, model } = setup();
    mode.enter();
    selectMany([path(model!, 'E1')]);
    await mode.clearAssignment();
    const [label, change] = actions.assign.mock.calls[0];
    expect(label).toBe('Clear Cost Item');
    const f = { ...emptyAssignment('x'), data: [{ path: 'E1', inherits: { costos: 'code-01.01' } }] };
    expect((change(f, model!.result) as IfcxFile).data).toEqual([]);
  });

  it('dropping a code on an element assigns it; on the empty space it does nothing', () => {
    const { mode, actions, toast, model } = setup();
    mode.enter();
    mode.dropCode('01.02', null);
    expect(actions.assign).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    mode.dropCode('01.02', path(model!, 'E4'));
    const [label, change] = actions.assign.mock.calls[0];
    expect(label).toBe('Assign Cost Item');
    expect((change(emptyAssignment('x'), model!.result) as IfcxFile).data).toEqual([{ path: 'E4', inherits: { costos: 'code-01.02' } }]);
  });

  it('en solo lectura ninguna orden escribe', async () => {
    const { mode, host, actions, selectMany, model } = setup({ editable: false });
    mode.enter();
    treeRow(host, '01.02').click();
    selectMany([path(model!, 'E1')]);
    await mode.editSystem();
    await mode.assignToSelection();
    await mode.clearAssignment();
    mode.dropCode('01.02', path(model!, 'E1'));
    expect(document.querySelector('.cost-item-dialog')).toBeNull();
    expect(actions.saveFile).not.toHaveBeenCalled();
    expect(actions.assign).not.toHaveBeenCalled();
  });

  it('un sistema en una capa (no un import) no se abre en el editor', async () => {
    const layer: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document', location: 'C:/t/m.ifcx' };
    const { mode, toast, actions } = setup({ model: build(layer) });
    mode.enter();
    await mode.editSystem();
    expect(document.querySelector('.cost-sys-dialog')).toBeNull();
    expect(toast).toHaveBeenCalledWith('Edit the costs file where it is imported', 'info');
    expect(actions.saveFile).not.toHaveBeenCalled();
  });
});
