import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuantityRow } from '../src/render/viewer';
import { editPath } from '../src/composer/edits';
import { loadModel, type LoadedModel } from '../src/model/load';
import { offlineFetcher } from '../src/model/schemas';
import { MATERIAL_DRAG_TYPE } from '../src/materials/browserpanel';
import { createMaterialsMode, type MaterialsActions } from '../src/materials/mode';
import { NO_MATERIAL } from '../src/materials/catalog';
import type { CatalogNode } from '../src/materials/catalog';

const HERE = dirname(fileURLToPath(import.meta.url));
let model: LoadedModel;
let p1: string;
let p2: string;
beforeAll(async () => {
  const path = resolve(HERE, 'fixtures/hello-wall.ifcx');
  model = await loadModel('hello-wall', path, readFileSync(path, 'utf8'), offlineFetcher);
  [p1, p2] = [...model.result.byPath.keys()].filter(Boolean); // the root has an empty path
});

const C30 = { name: 'Concrete C30', code: 'C30', color: '#8a8a8a', opacity: 1 };
const node = (over: Partial<CatalogNode> = {}): CatalogNode => ({
  path: 'n-C30', def: C30, source: { role: 'import', name: 'lib', uri: '../lib.ifcx', location: 'C:/b/materiales/lib.ifcx' }, site: 'library', overridden: [], ...over,
});
const row = (element: string, over: Partial<QuantityRow> = {}): QuantityRow => ({
  element, name: element, cls: 'IfcWall', storey: 'Level 1', material: '', materialCode: null, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 1, ...over,
});

function setup(rows: QuantityRow[], nodes: CatalogNode[] = [node({ site: 'document' })], editable = true) {
  const actions = {
    nodes: vi.fn(() => nodes),
    promoteMaterial: vi.fn(async () => true),
    resetMaterial: vi.fn(async () => true),
    setMaterial: vi.fn(async () => true),
    duplicateMaterial: vi.fn(async () => 'C30-copy'),
    deleteMaterial: vi.fn(async () => true),
    assignMaterial: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
  } satisfies MaterialsActions;
  const viewer = { quantities: vi.fn(() => rows), setColorOverride: vi.fn(), selectMany: vi.fn() };
  let selected: string | null = null;
  const toast = vi.fn();
  const mode = createMaterialsMode({ actions, viewer, model: () => model, selected: () => selected, toast, editable });
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  host.append(mode.panel(0)!, mode.panel(1)!, mode.panel(2)!);
  return { mode, actions, viewer, toast, host, select: (p: string | null) => (selected = p) };
}
const lastOverride = (v: { setColorOverride: ReturnType<typeof vi.fn> }) => v.setColorOverride.mock.calls.at(-1)![0];
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe('modo Materials: colores', () => {
  it('on entering it paints each element with its material and the others with "no material"', () => {
    const t = setup([row(p1, { materialCode: 'C30' }), row(p2)]);
    t.mode.enter();
    const fn = lastOverride(t.viewer);
    expect(fn(p1)).toEqual({ color: '#8a8a8a', opacity: 1 });
    expect(fn(p2)).toEqual(NO_MATERIAL);
    expect(fn('/no-esta')).toEqual(NO_MATERIAL);
  });

  it('al salir quita el coloreado, y volver lo pone', () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.mode.leave();
    expect(lastOverride(t.viewer)).toBeNull();
    t.mode.enter();
    expect(lastOverride(t.viewer)).toBeTypeOf('function');
  });

  it('apagar Material Colors quita el coloreado sin salir del modo', () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.mode.setColors(false);
    expect(lastOverride(t.viewer)).toBeNull();
    t.mode.setColors(true);
    expect(lastOverride(t.viewer)).toBeTypeOf('function');
  });
});

describe('modo Materials: paneles', () => {
  it('Browser y Usage se llenan al entrar; el clic en una fila de Usage selecciona sus elementos', () => {
    const t = setup([row(p1, { materialCode: 'C30' }), row(p2)]);
    t.mode.enter();
    expect([...t.host.querySelectorAll('.mat-row')].map((r) => (r as HTMLElement).dataset.code)).toEqual(['C30']);
    const usageRow = [...t.host.querySelectorAll<HTMLElement>('.mat-usage-row')].find((r) => r.textContent?.startsWith('Concrete'))!;
    usageRow.click();
    expect(t.viewer.selectMany).toHaveBeenCalledWith([p1]);
  });

  it('seleccionar en el visor un elemento con material lo elige en el Browser', () => {
    const t = setup([row(p1, { materialCode: 'C30' })]);
    t.mode.enter();
    t.mode.selectionChanged(p1);
    expect(t.host.querySelector('.mat-row')!.getAttribute('aria-selected')).toBe('true');
    expect(t.host.querySelector<HTMLInputElement>('.mat-form input')!.value).toBe('Concrete C30');
  });

  it('New crea un material con un code libre y lo elige', async () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.mode.newMaterial();
    expect(t.actions.setMaterial).toHaveBeenCalledWith(null, expect.objectContaining({ name: 'New Material', code: 'MAT-2', opacity: 1 }));
  });
});

describe('modo Materials: asignar', () => {
  it('Assign to Selection sin material o sin elemento avisa', () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.mode.assignToSelection();
    expect(t.toast).toHaveBeenCalledWith('Select a material and an element first', 'info');
    expect(t.actions.assignMaterial).not.toHaveBeenCalled();
  });

  it('Assign to Selection uses the Browser material and the edit path of the element', () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    t.select(p1);
    t.mode.assignToSelection();
    expect(t.actions.assignMaterial).toHaveBeenCalledWith([editPath(model.result.byPath.get(p1)!, model.result)], 'C30');
  });

  it('soltar un material sobre un elemento lo asigna; sin elemento debajo no hace nada', () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.mode.dropMaterial('C30', p1);
    expect(t.actions.assignMaterial).toHaveBeenCalledTimes(1);
    t.mode.dropMaterial('C30', null);
    expect(t.actions.assignMaterial).toHaveBeenCalledTimes(1);
  });

  it('Assign by Rule asigna a lo que cumple la regla con la etiqueta de la regla', async () => {
    const t = setup([row(p1, { cls: 'IfcWall' }), row(p2, { cls: 'IfcSlab' })]);
    t.mode.enter();
    const done = t.mode.assignByRule();
    const dialog = document.querySelector('.mat-rule')!;
    const sel = (label: string) =>
      [...dialog.querySelectorAll<HTMLElement>('.mat-field')].find((f) => f.textContent?.startsWith(label))!.querySelector('select')!;
    sel('Class').value = 'IfcWall';
    sel('Class').dispatchEvent(new Event('change'));
    dialog.querySelector<HTMLButtonElement>('.modal-btn-primary')!.click();
    await done;
    expect(t.actions.assignMaterial).toHaveBeenCalledWith([editPath(model.result.byPath.get(p1)!, model.result)], 'C30', 'Assign by Rule');
    expect(t.toast).toHaveBeenCalledWith('Assigned Concrete C30 to 1 elements', 'info');
  });

  it('Assign by Rule sin coincidencias avisa y no asigna', async () => {
    const t = setup([row(p1, { cls: 'IfcWall' })]);
    t.mode.enter();
    const done = t.mode.assignByRule();
    const dialog = document.querySelector('.mat-rule')!;
    const cls = [...dialog.querySelectorAll<HTMLElement>('.mat-field')].find((f) => f.textContent?.startsWith('Class'))!.querySelector('select')!;
    cls.append(Object.assign(document.createElement('option'), { value: 'IfcDoor', textContent: 'IfcDoor' }));
    cls.value = 'IfcDoor';
    dialog.querySelector<HTMLButtonElement>('.modal-btn-primary')!.click();
    await done;
    expect(t.toast).toHaveBeenCalledWith('No elements match that rule', 'info');
    expect(t.actions.assignMaterial).not.toHaveBeenCalled();
  });

  it('en solo lectura nada asigna ni crea', () => {
    const t = setup([row(p1)], undefined, false);
    t.mode.enter();
    t.mode.dropMaterial('C30', p1);
    t.mode.newMaterial();
    expect(t.actions.assignMaterial).not.toHaveBeenCalled();
    expect(t.actions.setMaterial).not.toHaveBeenCalled();
    expect(t.host.querySelector<HTMLButtonElement>('.mat-btn')!.disabled).toBe(true);
  });
});

describe('modo Materials: borrar', () => {
  it('a material in use asks for confirmation with the number of elements', async () => {
    const t = setup([row(p1, { materialCode: 'C30' }), row(p2, { materialCode: 'C30' })]);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    [...t.host.querySelectorAll<HTMLButtonElement>('.mat-btn')].find((b) => b.textContent === 'Delete')!.click();
    await tick();
    expect(t.actions.confirm).toHaveBeenCalledWith('Delete Concrete C30? It is assigned to 2 elements.', 'Delete');
    expect(t.actions.deleteMaterial).toHaveBeenCalledWith('C30');
  });

  it('if the confirmation is cancelled it is not deleted', async () => {
    const t = setup([row(p1, { materialCode: 'C30' })]);
    t.actions.confirm.mockResolvedValue(false);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    [...t.host.querySelectorAll<HTMLButtonElement>('.mat-btn')].find((b) => b.textContent === 'Delete')!.click();
    await tick();
    expect(t.actions.deleteMaterial).not.toHaveBeenCalled();
  });

  it('un material sin uso se borra sin preguntar', async () => {
    const t = setup([row(p1)]);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    [...t.host.querySelectorAll<HTMLButtonElement>('.mat-btn')].find((b) => b.textContent === 'Delete')!.click();
    await tick();
    expect(t.actions.confirm).not.toHaveBeenCalled();
    expect(t.actions.deleteMaterial).toHaveBeenCalledWith('C30');
  });
});

describe('Materials mode: where the material comes from', () => {
  const OVER = ['bsi::ifc::presentation::diffuseColor'];
  const action = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>('.mat-action')].find((b) => b.textContent === label);

  it('the editor says the file, offers Reset and Change in library, and sends them to the controller', () => {
    const t = setup([row(p1, { materialCode: 'C30' })], [node({ overridden: OVER })]);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    expect(t.host.querySelector('.mat-source')!.textContent).toBe('Defined in lib.ifcx');
    action(t.host, 'Reset')!.click();
    action(t.host, 'Change in library')!.click();
    expect(t.actions.resetMaterial).toHaveBeenCalledWith('C30');
    expect(t.actions.promoteMaterial).toHaveBeenCalledWith('C30');
  });

  it('deleting a material from a library asks for confirmation even if it is not used and names the file', async () => {
    const t = setup([row(p1)], [node()]);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.mat-row')!.click();
    [...t.host.querySelectorAll<HTMLButtonElement>('.mat-btn')].find((b) => b.textContent === 'Delete')!.click();
    await tick();
    expect(t.actions.confirm).toHaveBeenCalledWith('Delete Concrete C30 from lib.ifcx? Other models that use this library will lose it.', 'Delete');
    expect(t.actions.deleteMaterial).toHaveBeenCalledWith('C30');
  });
});

describe('MATERIAL_DRAG_TYPE', () => {
  it('es el tipo que usa el Browser', () => {
    expect(MATERIAL_DRAG_TYPE).toBe('application/x-ifcx-material');
  });
});
