import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry, UsageRow } from '../src/materials/catalog';
import { MATERIAL_DRAG_TYPE, mountMaterialBrowser } from '../src/materials/browserpanel';
import { mountMaterialEditor } from '../src/materials/editorpanel';
import { mountUsagePanel } from '../src/materials/usagepanel';

const entry = (name: string, code: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  def: { name, code, color: '#8a8a8a', opacity: 1 }, path: `n-${code}`, site: 'library', sourceName: 'lib.ifcx', overridden: [], elements: 3, ...over,
});
const ENTRIES = [entry('Concrete C30', 'C30'), entry('Glass', 'GLASS'), entry('Brick', 'Brick', { path: null, site: null, sourceName: null })];

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});
const rows = () => [...host.querySelectorAll<HTMLElement>('.mat-row')];
const btn = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.mat-btn')].find((b) => b.textContent === label)!;

describe('Material Browser', () => {
  const cb = () => ({ onSelect: vi.fn(), onNew: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() });

  it('the search filters by name or code, case-insensitive', () => {
    const b = mountMaterialBrowser(host, cb());
    b.setEntries(ENTRIES);
    expect(rows()).toHaveLength(3);
    const search = host.querySelector<HTMLInputElement>('.mat-search')!;
    search.value = 'con';
    search.dispatchEvent(new Event('input'));
    expect(rows().map((r) => r.dataset.code)).toEqual(['C30']);
  });

  it('el clic en una fila avisa y setSelected la marca sin avisar', () => {
    const c = cb();
    const b = mountMaterialBrowser(host, c);
    b.setEntries(ENTRIES);
    rows()[0].click();
    expect(c.onSelect).toHaveBeenCalledWith('C30');
    c.onSelect.mockClear();
    b.setSelected('GLASS');
    expect(c.onSelect).not.toHaveBeenCalled();
    expect(rows().find((r) => r.dataset.code === 'GLASS')!.getAttribute('aria-selected')).toBe('true');
  });

  it('un material que el modelo trae sin nodo lleva la marca y no se puede duplicar', () => {
    const b = mountMaterialBrowser(host, cb());
    b.setEntries(ENTRIES);
    expect(rows().find((r) => r.dataset.code === 'Brick')!.textContent).toContain('from model');
    b.setSelected('Brick');
    expect(btn('Duplicate').disabled).toBe(true);
    expect(btn('Delete').disabled).toBe(false);
    b.setSelected('C30');
    expect(btn('Duplicate').disabled).toBe(false);
    expect(btn('Delete').disabled).toBe(false);
  });

  it('Delete y Duplicate avisan con el code elegido; solo lectura desactiva los tres', () => {
    const c = cb();
    const b = mountMaterialBrowser(host, c);
    b.setEntries(ENTRIES);
    b.setSelected('C30');
    btn('Delete').click();
    btn('Duplicate').click();
    expect(c.onDelete).toHaveBeenCalledWith('C30');
    expect(c.onDuplicate).toHaveBeenCalledWith('C30');
    b.setEditable(false);
    expect(['New', 'Duplicate', 'Delete'].every((l) => btn(l).disabled)).toBe(true);
  });

  it('la flecha abajo elige la fila siguiente', () => {
    const c = cb();
    const b = mountMaterialBrowser(host, c);
    b.setEntries(ENTRIES);
    b.setSelected('Brick'); // ordenada tal cual llega: Brick no es la primera
    host.querySelector('.mat-list')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(c.onSelect).toHaveBeenCalledWith('Brick'); // it is the last one: it stays
    host.querySelector('.mat-list')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(c.onSelect).toHaveBeenLastCalledWith('GLASS');
  });

  it('dragstart lleva el code en MATERIAL_DRAG_TYPE', () => {
    const b = mountMaterialBrowser(host, cb());
    b.setEntries(ENTRIES);
    const setData = vi.fn();
    const ev = new Event('dragstart', { bubbles: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { setData, effectAllowed: '' } });
    rows()[0].dispatchEvent(ev);
    expect(setData).toHaveBeenCalledWith(MATERIAL_DRAG_TYPE, 'C30');
  });
});

const EDITOR_CB = () => ({ onChange: vi.fn(), onPromote: vi.fn(), onReset: vi.fn() });

describe('Material Editor', () => {
  const input = (label: string) =>
    [...host.querySelectorAll<HTMLLabelElement>('.mat-field')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;

  it('without a selection it shows the help text', () => {
    mountMaterialEditor(host, EDITOR_CB());
    expect(host.querySelector('.mat-empty')!.textContent).toBe('Select a material to edit it.');
    expect(host.querySelector<HTMLElement>('.mat-form')!.hidden).toBe(true);
  });

  it('cambiar la opacidad avisa con el code anterior y el material completo', () => {
    const onChange = vi.fn();
    const e = mountMaterialEditor(host, { ...EDITOR_CB(), onChange });
    e.show(ENTRIES[0]);
    const op = input('Opacity');
    expect(op.value).toBe('100');
    op.value = '50';
    op.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('C30', { ...ENTRIES[0].def, opacity: 0.5 });
  });

  it('empty optional fields do not appear in the material', () => {
    const onChange = vi.fn();
    const e = mountMaterialEditor(host, { ...EDITOR_CB(), onChange });
    e.show(ENTRIES[0]);
    const d = input('Density');
    d.value = '2400';
    d.dispatchEvent(new Event('change'));
    expect(onChange.mock.calls[0][1]).toEqual({ ...ENTRIES[0].def, density: 2400 });
  });

  it('en solo lectura los campos van desactivados', () => {
    const e = mountMaterialEditor(host, EDITOR_CB());
    e.show(ENTRIES[1]);
    expect(input('Code').disabled).toBe(false);
    e.show(ENTRIES[2]);
    expect(input('Code').disabled).toBe(false); // renombrar es un over del code
    e.setEditable(false);
    expect(host.querySelectorAll('input:not(:disabled)')).toHaveLength(0);
  });

  const source = () => host.querySelector('.mat-source')!.textContent;
  const action = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.mat-action')].find((b) => b.textContent === label);
  const OVER = ['bsi::ifc::presentation::diffuseColor'];

  it('it says in which file the material is defined', () => {
    const e = mountMaterialEditor(host, EDITOR_CB());
    e.show(ENTRIES[0]);
    expect(source()).toBe('Defined in lib.ifcx');
    e.show(entry('Mine', 'MINE', { site: 'document', sourceName: null }));
    expect(source()).toBe('Defined in this model');
    e.show(ENTRIES[2]);
    expect(source()).toBe('Not defined in any file');
  });

  it('sin sobrescrituras no hay Reset ni Change in library', () => {
    const e = mountMaterialEditor(host, EDITOR_CB());
    e.show(ENTRIES[0]);
    expect(action('Reset')).toBeUndefined();
    expect(action('Change in library')).toBeUndefined();
  });

  it('con sobrescrituras marca el campo, ofrece Reset y Change in library, y avisan con el code', () => {
    const cbs = EDITOR_CB();
    const e = mountMaterialEditor(host, cbs);
    e.show(entry('Concrete C30', 'C30', { overridden: OVER }));
    const field = (label: string) => [...host.querySelectorAll<HTMLElement>('.mat-field')].find((l) => l.textContent?.startsWith(label))!;
    expect(field('Color').classList.contains('mat-field-overridden')).toBe(true);
    expect(field('Name').classList.contains('mat-field-overridden')).toBe(false);
    action('Reset')!.click();
    action('Change in library')!.click();
    expect(cbs.onReset).toHaveBeenCalledWith('C30');
    expect(cbs.onPromote).toHaveBeenCalledWith('C30');
  });

  it('in a read-only file or one of the document it does not offer Change in library; in read-only nothing acts', () => {
    const e = mountMaterialEditor(host, EDITOR_CB());
    e.show(entry('R', 'R', { site: 'readonly', overridden: OVER }));
    expect(action('Reset')).toBeDefined();
    expect(action('Change in library')).toBeUndefined();
    e.show(entry('C', 'C', { overridden: OVER }));
    e.setEditable(false);
    expect(action('Reset')!.disabled).toBe(true);
    expect(action('Change in library')!.disabled).toBe(true);
  });
});

describe('Material Editor: vista previa', () => {
  const OVER = ['bsi::ifc::presentation::diffuseColor'];
  const fakePreview = () => {
    const p = { setShape: vi.fn(), setMaterial: vi.fn(), dispose: vi.fn() };
    const make = vi.fn(() => p);
    return { p, make };
  };
  const shapeBtn = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.mat-shape')].find((b) => b.textContent === label)!;
  const pressed = () => [...host.querySelectorAll<HTMLButtonElement>('.mat-shape')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

  beforeEach(() => localStorage.clear());

  it('ofrece Sphere, Plane y Cube; empieza en Sphere y muestra el color y la opacidad del material', () => {
    const f = fakePreview();
    const e = mountMaterialEditor(host, EDITOR_CB(), f.make);
    e.show(entry('Glass', 'GLASS', { def: { name: 'Glass', code: 'GLASS', color: '#9ec9e8', opacity: 0.4 } }));
    expect([...host.querySelectorAll('.mat-shape')].map((b) => b.textContent)).toEqual(['Sphere', 'Plane', 'Cube']);
    expect(pressed()).toEqual(['Sphere']);
    expect(f.p.setShape).toHaveBeenLastCalledWith('sphere');
    expect(f.p.setMaterial).toHaveBeenLastCalledWith({ color: '#9ec9e8', opacity: 0.4 });
  });

  it('choosing a shape passes it to the preview and marks it; the choice is remembered when reopening the editor', () => {
    const f = fakePreview();
    const e = mountMaterialEditor(host, EDITOR_CB(), f.make);
    e.show(ENTRIES[0]);
    shapeBtn('Cube').click();
    expect(f.p.setShape).toHaveBeenLastCalledWith('cube');
    expect(pressed()).toEqual(['Cube']);

    document.body.innerHTML = '<div id="h"></div>';
    host = document.getElementById('h')!;
    const g = fakePreview();
    mountMaterialEditor(host, EDITOR_CB(), g.make).show(ENTRIES[0]);
    expect(pressed()).toEqual(['Cube']);
    expect(g.p.setShape).toHaveBeenLastCalledWith('cube');
  });

  it('cambiar de material actualiza la vista previa; sin material no se crea', () => {
    const f = fakePreview();
    const e = mountMaterialEditor(host, EDITOR_CB(), f.make);
    e.show(null);
    expect(f.make).not.toHaveBeenCalled();
    e.show(ENTRIES[0]);
    e.show(entry('Brick', 'BRICK', { def: { name: 'Brick', code: 'BRICK', color: '#aa5533', opacity: 1 } }));
    expect(f.make).toHaveBeenCalledTimes(1);
    expect(f.p.setMaterial).toHaveBeenLastCalledWith({ color: '#aa5533', opacity: 1 });
  });

  it('mover el color o la opacidad la actualiza al instante, sin esperar a confirmar el cambio', () => {
    const f = fakePreview();
    const onChange = vi.fn();
    const e = mountMaterialEditor(host, { ...EDITOR_CB(), onChange }, f.make);
    e.show(ENTRIES[0]);
    const field = (label: string) => [...host.querySelectorAll<HTMLLabelElement>('.mat-field')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
    const color = field('Color');
    color.value = '#ff0000';
    color.dispatchEvent(new Event('input'));
    expect(f.p.setMaterial).toHaveBeenLastCalledWith({ color: '#ff0000', opacity: 1 });
    const op = field('Opacity');
    op.value = '25';
    op.dispatchEvent(new Event('input'));
    expect(f.p.setMaterial).toHaveBeenLastCalledWith({ color: '#ff0000', opacity: 0.25 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sin WebGL avisa y esconde la forma, y el resto del editor sigue funcionando', () => {
    const onChange = vi.fn();
    const e = mountMaterialEditor(host, { ...EDITOR_CB(), onChange }, () => null);
    e.show(ENTRIES[0]);
    expect(host.querySelector('.mat-preview-note')!.textContent).toBe('Preview not available');
    expect(host.querySelector<HTMLElement>('.mat-preview-canvas')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.mat-shapes')!.hidden).toBe(true);
    const name = [...host.querySelectorAll<HTMLLabelElement>('.mat-field')].find((l) => l.textContent?.startsWith('Name'))!.querySelector('input')!;
    name.value = 'Otro';
    name.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalled();
  });

  it('si crear la vista previa falla, lo trata como si no hubiera WebGL', () => {
    const e = mountMaterialEditor(host, EDITOR_CB(), () => { throw new Error('context lost'); });
    e.show(ENTRIES[0]);
    expect(host.querySelector('.mat-preview-note')!.textContent).toBe('Preview not available');
  });

  it('a preview that does exist does not show the notice', () => {
    const e = mountMaterialEditor(host, EDITOR_CB(), fakePreview().make);
    e.show(entry('C', 'C', { overridden: OVER }));
    expect(host.querySelector<HTMLElement>('.mat-preview-note')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.mat-shapes')!.hidden).toBe(false);
  });
});

describe('Material Editor: textura', () => {
  const IMG = 'data:image/jpeg;base64,AAAA';
  const withTex = (over: Partial<CatalogEntry> = {}) =>
    entry('Brick', 'Brick', { def: { name: 'Brick', code: 'Brick', color: '#aa5533', opacity: 1, texture: { image: IMG, width: 2, height: 0.5 } }, ...over });
  const preview = () => ({ setShape: vi.fn(), setMaterial: vi.fn(), dispose: vi.fn() });
  const mount = (over: { onChange?: ReturnType<typeof vi.fn>; readImage?: (f: File) => Promise<string> } = {}) => {
    const p = preview();
    const onChange = over.onChange ?? vi.fn();
    const readImage = over.readImage ?? vi.fn(async () => IMG);
    const e = mountMaterialEditor(host, { ...EDITOR_CB(), onChange }, () => p, readImage);
    return { e, p, onChange, readImage };
  };
  const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
  const sizeInput = (label: string) =>
    [...host.querySelectorAll<HTMLLabelElement>('.mat-texture-size label')].find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
  const pick = (file = new File(['x'], 'brick.png', { type: 'image/png' })) => {
    const input = q<HTMLInputElement>('.mat-texture-file');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => localStorage.clear());

  it('without a texture it shows "No texture", without a thumbnail, and Remove disabled', () => {
    const t = mount();
    t.e.show(ENTRIES[0]);
    expect(q('.mat-texture-note').textContent).toBe('No texture');
    expect(q<HTMLElement>('.mat-texture-thumb').hidden).toBe(true);
    expect(q<HTMLButtonElement>('.mat-texture-remove').disabled).toBe(true);
    expect(q<HTMLButtonElement>('.mat-texture-choose').textContent).toBe('Choose image…');
  });

  it('with a texture it shows the thumbnail and the size, and passes it to the preview', () => {
    const t = mount();
    t.e.show(withTex());
    expect(q<HTMLImageElement>('.mat-texture-thumb').getAttribute('src')).toBe(IMG);
    expect(q<HTMLElement>('.mat-texture-thumb').hidden).toBe(false);
    expect(sizeInput('Width').value).toBe('2');
    expect(sizeInput('Height').value).toBe('0.5');
    expect(q<HTMLButtonElement>('.mat-texture-remove').disabled).toBe(false);
    expect(t.p.setMaterial).toHaveBeenLastCalledWith({ color: '#aa5533', opacity: 1, texture: { image: IMG, width: 2, height: 0.5 } });
  });

  it('elegir una imagen la reduce, la guarda con 1 × 1 m y actualiza la vista previa', async () => {
    const t = mount();
    t.e.show(ENTRIES[0]);
    const file = new File(['x'], 'brick.png', { type: 'image/png' });
    pick(file);
    await tick();
    expect(t.readImage).toHaveBeenCalledWith(file);
    expect(t.onChange).toHaveBeenCalledWith('C30', { ...ENTRIES[0].def, texture: { image: IMG, width: 1, height: 1 } });
    expect(t.p.setMaterial).toHaveBeenLastCalledWith({ color: '#8a8a8a', opacity: 1, texture: { image: IMG, width: 1, height: 1 } });
  });

  it('si no se puede leer la imagen lo dice y no cambia nada', async () => {
    const t = mount({ readImage: async () => { throw new Error('That file is not an image'); } });
    t.e.show(ENTRIES[0]);
    pick();
    await tick();
    expect(q('.mat-texture-note').textContent).toBe('That file is not an image');
    expect(t.onChange).not.toHaveBeenCalled();
  });

  it('Remove quita la textura', () => {
    const t = mount();
    t.e.show(withTex());
    q<HTMLButtonElement>('.mat-texture-remove').click();
    expect(t.onChange).toHaveBeenCalledWith('Brick', { name: 'Brick', code: 'Brick', color: '#aa5533', opacity: 1 });
  });

  it('changing the width or the height confirms the size; when typing it is already seen in the preview', () => {
    const t = mount();
    t.e.show(withTex());
    const w = sizeInput('Width');
    w.value = '4';
    w.dispatchEvent(new Event('input'));
    expect(t.p.setMaterial).toHaveBeenLastCalledWith({ color: '#aa5533', opacity: 1, texture: { image: IMG, width: 4, height: 0.5 } });
    expect(t.onChange).not.toHaveBeenCalled();
    w.dispatchEvent(new Event('change'));
    expect(t.onChange).toHaveBeenCalledWith('Brick', expect.objectContaining({ texture: { image: IMG, width: 4, height: 0.5 } }));
  });

  it('a size that is not a positive number is neither confirmed nor seen', () => {
    const t = mount();
    t.e.show(withTex());
    const h = sizeInput('Height');
    for (const bad of ['0', '-1', '']) {
      h.value = bad;
      h.dispatchEvent(new Event('input'));
      h.dispatchEvent(new Event('change'));
    }
    expect(t.onChange).not.toHaveBeenCalled();
    expect(t.p.setMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ texture: { image: IMG, width: 2, height: 0.5 } }));
  });

  it('los otros campos conservan la textura al confirmarse', () => {
    const t = mount();
    t.e.show(withTex());
    const op = [...host.querySelectorAll<HTMLLabelElement>('.mat-field')].find((l) => l.textContent?.startsWith('Opacity'))!.querySelector('input')!;
    op.value = '50';
    op.dispatchEvent(new Event('change'));
    expect(t.onChange).toHaveBeenCalledWith('Brick', expect.objectContaining({ opacity: 0.5, texture: { image: IMG, width: 2, height: 0.5 } }));
  });

  it('it marks the texture as overridden, and in read-only nothing acts', () => {
    const t = mount();
    t.e.show(withTex({ overridden: ['gltf::material'] }));
    expect(q('.mat-texture').classList.contains('mat-field-overridden')).toBe(true);
    t.e.setEditable(false);
    expect(q<HTMLButtonElement>('.mat-texture-choose').disabled).toBe(true);
    expect(q<HTMLButtonElement>('.mat-texture-remove').disabled).toBe(true);
    expect(sizeInput('Width').disabled).toBe(true);
  });

  it('al pasar a otro material sin textura se limpia lo anterior', () => {
    const t = mount();
    t.e.show(withTex());
    t.e.show(ENTRIES[0]);
    expect(q<HTMLElement>('.mat-texture-thumb').hidden).toBe(true);
    expect(q('.mat-texture-note').textContent).toBe('No texture');
    expect(sizeInput('Width').value).toBe('');
  });
});

describe('Usage', () => {
  const USAGE: UsageRow[] = [
    { code: 'C30', name: 'Concrete C30', color: '#8a8a8a', elements: 2, area: 12.34, volume: 6, paths: ['/a', '/b'] },
    { code: 'GLASS', name: 'Glass', color: '#9ec9e8', elements: 1, area: 3, volume: 0.5, paths: ['/c'] },
    { code: '', name: 'No material', color: '#b0b0b0', elements: 4, area: 1, volume: 9.999, paths: ['/d'] },
  ];
  const names = () => [...host.querySelectorAll('.mat-usage-row')].map((r) => r.querySelector('td')!.textContent);

  it('it formats area with 1 decimal and volume with 2, and sorts by volume from largest to smallest', () => {
    const u = mountUsagePanel(host, { onRow: vi.fn() });
    u.setRows(USAGE);
    expect(names()).toEqual(['No material', 'Concrete C30', 'Glass']);
    const first = host.querySelector('.mat-usage-row')!;
    expect([...first.querySelectorAll('.mat-num')].map((c) => c.textContent)).toEqual(['4', '1.0', '10.00']);
  });

  it('las cabeceras ordenan: Material de la A a la Z y un segundo clic lo invierte', () => {
    const u = mountUsagePanel(host, { onRow: vi.fn() });
    u.setRows(USAGE);
    const sort = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.mat-sort')].find((b) => b.textContent === label)!;
    sort('Material').click();
    expect(names()).toEqual(['Concrete C30', 'Glass', 'No material']);
    sort('Material').click();
    expect(names()).toEqual(['No material', 'Glass', 'Concrete C30']);
  });

  it('a click on a row notifies with the elements of that material', () => {
    const onRow = vi.fn();
    const u = mountUsagePanel(host, { onRow });
    u.setRows(USAGE);
    [...host.querySelectorAll<HTMLElement>('.mat-usage-row')].find((r) => r.textContent?.startsWith('Concrete'))!.click();
    expect(onRow).toHaveBeenCalledWith(['/a', '/b']);
  });
});
