import { beforeEach, describe, expect, it } from 'vitest';
import type { ComposedNode, IfcxFile, IfcxNode, IfcxSchema, ProvenanceSource } from '../src/ifcx/types';
import { compose } from '../src/ifcx/compose';
import { buildPropertyGroups, typeHeader } from '../src/properties/groups';
import { attributeMarks, referencesGroup, sourceLabel, type RefContext } from '../src/properties/references';
import { PropertiesPanel } from '../src/properties/panel';

function node(name: string, attributes: Record<string, unknown> = {}, parent: ComposedNode | null = null, origin = `id-${name}`): ComposedNode {
  const n: ComposedNode = { path: `${parent?.path ?? ''}/${name}`, name, origin, attributes, children: [], parent };
  parent?.children.push(n);
  return n;
}

const schemas: Record<string, IfcxSchema> = {
  'bsi::ifc::prop::Height': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::GrossArea': { value: { dataType: 'Real', quantityKind: 'Area' } },
};

const titles = (n: ComposedNode, s = schemas) => buildPropertyGroups(n, s).map((g) => g.title);
const group = (n: ComposedNode, title: string, s = schemas) => buildPropertyGroups(n, s).find((g) => g.title === title)!;
const row = (n: ComposedNode, title: string, label: string, s = schemas) => group(n, title, s)?.rows.find((r) => r.label === label);

const UUID_NAME = '0a1b2c3d-0a1b-0a1b-0a1b-0a1b2c3d4e5f';

function sample() {
  const proj = node('proj', { 'bsi::ifc::class': { code: 'IfcProject' } });
  const storey = node('storey1', { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } }, proj);
  const room = node('room', { 'bsi::ifc::class': { code: 'IfcSpace' } }, storey);
  const wall = node('wall', {
    'bsi::ifc::class': { code: 'IfcWall' },
    'bsi::ifc::prop::Height': 3,
    'bsi::ifc::prop::Tag': 'M-01',
  }, room, 'abc-123');
  return { proj, storey, room, wall };
}

describe('typeHeader', () => {
  it('familia = clase IFC y tipo = nombre a mostrar', () => {
    expect(typeHeader(sample().wall)).toEqual({ family: 'IfcWall', type: 'wall' });
  });
  it('un muro sin clase da familia "Elemento"', () => {
    expect(typeHeader(node('wall')).family).toBe('Element');
  });
  it('usa el Name IFC cuando el nombre es un UUID', () => {
    const n = node(UUID_NAME, { 'bsi::ifc::prop::Name': 'Exterior Wall' });
    expect(typeHeader(n).type).toBe('Exterior Wall');
  });
});

describe('buildPropertyGroups', () => {
  it('Constraints goes first, with the Level of the nearest ancestor IfcBuildingStorey', () => {
    const { wall } = sample();
    const g = buildPropertyGroups(wall, schemas);
    expect(g[0].title).toBe('Constraints');
    expect(g[0].rows).toEqual([{ label: 'Level', value: 'storey1', key: 'ifcx::level' }]);
    expect(g[1].title).toBe('Identity Data');
  });

  it('the Level uses displayName and the nearest one wins', () => {
    const proj = node('proj');
    const outer = node('outer', { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } }, proj);
    const inner = node(UUID_NAME, {
      'bsi::ifc::class': { code: 'IfcBuildingStorey' }, 'bsi::ifc::prop::Name': 'Level 2',
    }, outer);
    const leaf = node('leaf', {}, inner);
    expect(row(leaf, 'Constraints', 'Level')!.value).toBe('Level 2');
  });

  it('sin planta antecesora el grupo Restricciones no aparece', () => {
    const lone = node('lone', { 'bsi::ifc::class': { code: 'IfcWall' } });
    expect(titles(lone)[0]).toBe('Identity Data');
    expect(titles(lone)).not.toContain('Constraints');
  });

  it('Datos de identidad: Nombre, Clase IFC e Identificador (origin)', () => {
    const { wall } = sample();
    expect(group(wall, 'Identity Data').rows.map((r) => [r.label, r.value])).toEqual([
      ['Name', 'wall'], ['IFC Class', 'IfcWall'], ['Identifier', 'abc-123'],
    ]);
  });

  it('sin clase, Clase IFC se omite', () => {
    const labels = group(node('x'), 'Identity Data').rows.map((r) => r.label);
    expect(labels).toEqual(['Name', 'Identifier']);
  });

  it('bsi::ifc::prop::* va en Propiedades IFC con etiqueta corta y unidades', () => {
    const { wall } = sample();
    const rows = group(wall, 'IFC Properties').rows;
    expect(rows).toEqual([
      { label: 'Height', value: '3 m', key: 'bsi::ifc::prop::Height' },
      { label: 'Tag', value: 'M-01', key: 'bsi::ifc::prop::Tag' },
    ]);
  });

  it('bsi::ifc::class is not duplicated in any group', () => {
    const { wall } = sample();
    const all = buildPropertyGroups(wall, schemas).flatMap((g) => g.rows);
    expect(all.some((r) => r.key === 'bsi::ifc::class')).toBe(false);
  });

  it('the other groups carry English titles and in order', () => {
    const n = node('n', {
      'something::else::foo': 'x',
      'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [1.5, 2, 3, 1]] },
      'usd::usdgeom::basiscurves': { points: [[0, 0, 0], [1, 1, 1]] },
      'bsi::ifc-mat::prop::Name': 'Concrete',
      'bsi::ifc::system::isInSystem': 'HVAC',
      'bsi::ifc::presentation::opacity': 0.5,
      'bsi::ifc::prop::Tag': 'T',
    });
    expect(titles(n)).toEqual([
      'Identity Data', 'IFC Properties', 'Presentation', 'Systems', 'Material', 'Geometry', 'Transform', 'Other',
    ]);
    expect(row(n, 'Presentation', 'opacity')!.value).toBe('0.5');
    expect(row(n, 'Transform', 'xformop')!.value).toContain('1.5');
  });

  it('un grupo desconocido va en Otros', () => {
    const n = node('n', { 'foo::bar': 'x', solo: 5 });
    const g = group(n, 'Other');
    expect(g.rows.map((r) => r.key).sort()).toEqual(['foo::bar', 'solo']);
  });

  it('usd::usdgeom::mesh is summarized as vertices and faces', () => {
    const n = node('m', {
      'usd::usdgeom::mesh': {
        points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
        faceVertexIndices: [0, 1, 2, 0, 2, 3],
        faceVertexCounts: [3, 3],
      },
    });
    expect(row(n, 'Geometry', 'mesh')!.value).toBe('4 vertices · 2 faces');
  });

  it('a mesh without faceVertexCounts assumes triangles', () => {
    const n = node('m', { 'usd::usdgeom::mesh': { points: new Array(1200).fill([0, 0, 0]), faceVertexIndices: [0, 1, 2, 0, 2, 3] } });
    expect(row(n, 'Geometry', 'mesh')!.value).toBe('1200 vertices · 2 faces');
  });

  it('a generic object is summarized in a line of at most 80 characters', () => {
    const big = { a: 'x'.repeat(200), b: [1, 2, 3], c: { d: 'y'.repeat(100) } };
    const v = row(node('n', { 'foo::bar::big': big }), 'Other', 'foo::bar::big')!.value;
    expect(v.length).toBeLessThanOrEqual(80);
    expect(v).not.toContain('\n');
    expect(v.endsWith('…')).toBe(true);
  });

  it('booleanos, nulos y referencias', () => {
    const n = node('n', {
      'bsi::ifc::prop::IsExternal': true,
      'bsi::ifc::prop::Fire': false,
      'bsi::ifc::prop::Nil': null,
      'bsi::ifc::prop::Host': { ref: 'uuid-1' },
    });
    const rows = group(n, 'IFC Properties').rows;
    expect(rows.map((r) => r.value)).toEqual(['Yes', 'No', '—', 'uuid-1']);
  });
});

describe('PropertiesPanel', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    el = document.getElementById('p') as HTMLElement;
  });

  it('without a selection it shows "Nothing selected"', () => {
    const p = new PropertiesPanel(el);
    p.show(null, schemas);
    expect(el.textContent).toContain('Nothing selected');
    expect(el.querySelector('details')).toBeNull();
  });

  it('it draws a type selector, counter, disabled button and collapsible groups', () => {
    const { wall } = sample();
    const p = new PropertiesPanel(el);
    p.show(wall, schemas);
    expect(el.querySelector('.prop-type-family')!.textContent).toBe('IfcWall');
    expect(el.querySelector('.prop-type-name')!.textContent).toBe('wall');
    expect(el.textContent).toContain('1 element selected');
    const btn = el.querySelector<HTMLButtonElement>('button.prop-edit-type')!;
    expect(btn.textContent).toBe('Edit Type');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Coming soon');
    const heads = [...el.querySelectorAll('details > summary')].map((s) => s.textContent);
    expect(heads).toEqual(['Constraints', 'Identity Data', 'IFC Properties']);
    const first = el.querySelector('details table')!;
    expect(first.querySelectorAll('tr')).toHaveLength(1);
    expect(first.querySelector('td')!.textContent).toBe('Level');
  });

  it('setCount cambia el contador con varios elementos seleccionados', () => {
    const { wall } = sample();
    const p = new PropertiesPanel(el);
    p.show(wall, schemas);
    p.setCount(3);
    expect(el.querySelector('.prop-count')!.textContent).toBe('3 elements selected');
    p.setCount(1);
    expect(el.querySelector('.prop-count')!.textContent).toBe('1 element selected');
  });

  it('it does not interpret HTML from the model data', () => {
    const n = node('<img src=x onerror=alert(1)>', { 'foo::bar': '<b>hello</b>' });
    new PropertiesPanel(el).show(n, schemas);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>hello</b>');
  });

  it('going back to null clears the selection', () => {
    const p = new PropertiesPanel(el);
    p.show(sample().wall, schemas);
    p.show(null, schemas);
    expect(el.textContent).toContain('Nothing selected');
    expect(el.textContent).not.toContain('IfcWall');
  });
});

describe('PropertiesPanel: campos editables', () => {
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    el = document.getElementById('p') as HTMLElement;
  });

  /** Studio context with a free 3 m wall on Level 1 and one more level (Level 2 at 3 m). */
  function conContexto() {
    const calls: { fn: string; args: unknown[]; resolve: (ok: boolean) => void }[] = [];
    const pending = (fn: string) => (...args: unknown[]) =>
      new Promise<boolean>((resolve) => calls.push({ fn, args, resolve }));
    const studio = {
      levels: () => [
        { id: 'l1', name: 'Level 1', elevation: 0 },
        { id: 'l2', name: 'Level 2', elevation: 3 },
      ],
      wall: (id: string) =>
        id === 'w1'
          ? { id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.2, bodyId: 'b', axisId: 'a', baseLevelId: 'l1', baseOffset: 0, topLevelId: null, topOffset: 0, height: 3 }
          : undefined,
      walls: () => [],
      floor: () => undefined,
      renameLevel: pending('renameLevel'),
      setLevelElevation: pending('setLevelElevation'),
      setWallConstraints: pending('setWallConstraints'),
      setFloorConstraints: pending('setFloorConstraints'),
    } as unknown as import('../src/properties/studio').StudioProps;
    const storey = node('storey', { 'bsi::ifc::class': { code: 'IfcBuildingStorey' } }, null, 'l1');
    const wall = node('wall', { 'bsi::ifc::class': { code: 'IfcWall' } }, storey, 'w1');
    return { studio, calls, wall, storey };
  }

  const input = (label: string) => {
    const td = [...el.querySelectorAll('td.prop-name')].find((t) => t.textContent === label)!;
    return td.nextElementSibling!.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
  };
  const key = (target: Element, k: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const type = (i: HTMLInputElement, text: string) => { i.value = text; };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('Enter confirma una vez y el blur posterior no vuelve a confirmar', () => {
    const { studio, calls, wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas, studio);
    const i = input('Base Offset') as HTMLInputElement;
    expect(i.value).toBe('0.000');
    type(i, '4');
    key(i, 'Enter');
    i.dispatchEvent(new Event('blur'));
    expect(calls.map((c) => [c.fn, c.args])).toEqual([['setWallConstraints', ['w1', { baseOffset: 4 }]]]);
  });

  it('a non-numeric text confirms NaN and, when rejected, the field goes back to the previous value', async () => {
    const { studio, calls, wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas, studio);
    const i = input('Base Offset') as HTMLInputElement;
    type(i, 'abc');
    key(i, 'Enter');
    expect(Number.isNaN((calls[0].args[1] as { baseOffset: number }).baseOffset)).toBe(true);
    expect(i.disabled).toBe(true);
    calls[0].resolve(false);
    await flush();
    expect(i.value).toBe('0.000');
    expect(i.disabled).toBe(false);
  });

  it('Esc restores the value and neither it nor the next blur confirm', () => {
    const { studio, calls, wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas, studio);
    const i = input('Base Offset') as HTMLInputElement;
    type(i, '9');
    key(i, 'Escape');
    i.dispatchEvent(new Event('blur'));
    expect(i.value).toBe('0.000');
    expect(calls).toHaveLength(0);
  });

  it('Enter sin cambiar el texto no confirma', () => {
    const { studio, calls, wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas, studio);
    key(input('Base Offset'), 'Enter');
    input('Base Offset').dispatchEvent(new Event('blur'));
    expect(calls).toHaveLength(0);
  });

  it('a dropdown confirms on choosing and, if rejected, goes back to the previous option', async () => {
    const { studio, calls, wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas, studio);
    const s = input('Base Constraint') as HTMLSelectElement;
    expect(s.value).toBe('l1');
    s.value = 'l2';
    s.dispatchEvent(new Event('change'));
    expect(calls[0]).toMatchObject({ fn: 'setWallConstraints', args: ['w1', { baseLevelId: 'l2' }] });
    calls[0].resolve(false);
    await flush();
    expect(s.value).toBe('l1');
    expect(s.disabled).toBe(false);
  });

  it('el nombre de un nivel con HTML se muestra como texto', () => {
    const { studio, storey } = conContexto();
    (studio as unknown as { levels: () => object[] }).levels = () => [{ id: 'l1', name: '<b>x</b>', elevation: 0 }];
    new PropertiesPanel(el).show(storey, schemas, studio);
    expect((input('Name') as HTMLInputElement).value).toBe('<b>x</b>');
    expect(el.querySelector('b')).toBeNull();
  });

  it('sin contexto de Studio no hay campos editables', () => {
    const { wall } = conContexto();
    new PropertiesPanel(el).show(wall, schemas);
    expect(el.querySelector('input, select')).toBeNull();
  });
});

describe('Properties de elementos enlazados', () => {
  type Value = string | number | boolean;
  /** LinkedProps falso: `edited` por clave y registro de llamadas. */
  function linkedCtx(edited: string[] = []) {
    const calls: [string, string, Value?][] = [];
    const linked = {
      edited: (k: string) => edited.includes(k),
      set: async (k: string, v: Value) => (calls.push(['set', k, v]), true),
      reset: async (k: string) => (calls.push(['reset', k]), true),
    };
    return { linked, calls };
  }
  const attrs = {
    'bsi::ifc::class': { code: 'IfcWall' },
    'bsi::ifc::prop::Tag': 'M-01',
    'bsi::ifc::prop::Height': 3,
    'bsi::ifc::prop::IsExternal': true,
    'usd::usdgeom::visibility': 'inherited',
    'gltf::name': 'w',
    'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
    'acme::data': { a: 1 },
    'acme::ref': { ref: 'x' },
    'acme::list': [1, 2],
  };
  const rowsOf = (n: ComposedNode, linked?: ReturnType<typeof linkedCtx>['linked']) =>
    new Map(buildPropertyGroups(n, schemas, undefined, linked).flatMap((g) => g.rows).map((r) => [r.key, r]));

  it('a string, number or boolean attribute of a linked node is editable; class and usd::* are not', () => {
    const { linked } = linkedCtx();
    const rows = rowsOf(node('w', attrs), linked);
    expect(rows.get('bsi::ifc::prop::Tag')!.edit?.kind).toBe('text');
    expect(rows.get('bsi::ifc::prop::Tag')!.value).toBe('M-01');
    expect(rows.get('bsi::ifc::prop::Height')!.edit?.kind).toBe('number');
    expect(rows.get('bsi::ifc::prop::Height')!.value).toBe('3');
    expect(rows.get('bsi::ifc::prop::IsExternal')!.edit?.kind).toBe('bool');
    for (const k of ['usd::usdgeom::visibility', 'gltf::name', 'usd::xformop', 'acme::data', 'acme::ref', 'acme::list', 'ifcx::class', 'ifcx::name', 'ifcx::origin']) {
      expect(rows.get(k)?.edit, k).toBeUndefined();
    }
    // sin `linked` nada es editable
    for (const r of rowsOf(node('w', attrs)).values()) expect(r.edit).toBeUndefined();
  });

  it('the edits call set with the typed value', async () => {
    const { linked, calls } = linkedCtx();
    const rows = rowsOf(node('w', attrs), linked);
    const edit = <K extends string>(k: string, kind: K) => rows.get(k)!.edit as Extract<import('../src/properties/groups').RowEdit, { kind: K }>;
    await edit('bsi::ifc::prop::Tag', 'text').commit('M-02');
    await edit('bsi::ifc::prop::Height', 'number').commit(2.5);
    await edit('bsi::ifc::prop::IsExternal', 'bool').commit(false);
    expect(calls).toEqual([
      ['set', 'bsi::ifc::prop::Tag', 'M-02'],
      ['set', 'bsi::ifc::prop::Height', 2.5],
      ['set', 'bsi::ifc::prop::IsExternal', false],
    ]);
  });

  it('only edited rows get reset, and it calls reset', async () => {
    const { linked, calls } = linkedCtx(['bsi::ifc::prop::Tag']);
    const rows = rowsOf(node('w', attrs), linked);
    expect(rows.get('bsi::ifc::prop::Height')!.reset).toBeUndefined();
    expect(await rows.get('bsi::ifc::prop::Tag')!.reset!()).toBe(true);
    expect(calls).toEqual([['reset', 'bsi::ifc::prop::Tag']]);
  });

  describe('panel', () => {
    let el: HTMLElement;
    beforeEach(() => {
      document.body.innerHTML = '<div id="p"></div>';
      el = document.getElementById('p') as HTMLElement;
    });
    const cell = (label: string) =>
      [...el.querySelectorAll('td.prop-name')].find((t) => t.textContent === label)!.nextElementSibling as HTMLElement;
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('↺ only on edited rows', async () => {
      const { linked, calls } = linkedCtx(['bsi::ifc::prop::Tag']);
      new PropertiesPanel(el).show(node('w', attrs), schemas, undefined, linked);
      expect(el.querySelectorAll('.prop-reset')).toHaveLength(1);
      const reset = cell('Tag').querySelector<HTMLButtonElement>('.prop-reset')!;
      expect(reset.title).toBe('Reset to file value');
      expect(reset.textContent).toBe('↺');
      expect(cell('Height').querySelector('.prop-reset')).toBeNull();
      reset.click();
      await flush();
      expect(calls).toEqual([['reset', 'bsi::ifc::prop::Tag']]);
    });

    it('a boolean is a checkbox; a number that does not parse reverts without writing', async () => {
      const { linked, calls } = linkedCtx();
      new PropertiesPanel(el).show(node('w', attrs), schemas, undefined, linked);
      const box = cell('IsExternal').querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      expect(box.checked).toBe(true);
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await flush();
      const h = cell('Height').querySelector<HTMLInputElement>('input.prop-input')!;
      expect(h.value).toBe('3');
      h.value = 'abc';
      h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();
      expect(h.value).toBe('3');
      h.value = '4,5 m';
      h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flush();
      expect(calls).toEqual([['set', 'bsi::ifc::prop::IsExternal', false], ['set', 'bsi::ifc::prop::Height', 4.5]]);
    });
  });
});

describe('Properties: variantes y payloads', () => {
  const door = () => {
    const n = node('d1', { 'bsi::ifc::class': { code: 'IfcDoor' } });
    n.variantSets = { tipo: { options: ['simple', 'doble'], selected: 'doble' } };
    n.payloads = { geo: { uri: './a.ifcx', path: 'bld', loaded: false } };
    return n;
  };
  const rows = (n: ComposedNode, ...rest: Parameters<typeof buildPropertyGroups> extends [unknown, unknown, ...infer R] ? R : never) =>
    new Map(buildPropertyGroups(n, schemas, ...rest).flatMap((g) => g.rows).map((r) => [r.key, r]));

  it('the Variants group lists each set with its selection, read-only without linked', () => {
    const g = buildPropertyGroups(door(), schemas).find((x) => x.title === 'Variants')!;
    expect(g.rows).toEqual([{ label: 'tipo', value: 'doble', key: 'ifcx::variant::tipo' }]);
  });

  it('with setVariant the selection is a select that writes the option; reset only when edited', async () => {
    const calls: string[][] = [];
    const linked = {
      edited: () => false,
      set: async () => true,
      reset: async () => true,
      variantEdited: (s: string) => s === 'tipo',
      setVariant: async (s: string, o: string) => (calls.push(['set', s, o]), true),
      resetVariant: async (s: string) => (calls.push(['reset', s]), true),
    };
    const r = rows(door(), undefined, linked).get('ifcx::variant::tipo')!;
    expect(r.edit).toMatchObject({ kind: 'select', selected: 'doble', options: [{ value: 'simple', label: 'simple' }, { value: 'doble', label: 'doble' }] });
    await (r.edit as Extract<typeof r.edit, { kind: 'select' }>)!.commit('simple');
    await r.reset!();
    expect(calls).toEqual([['set', 'tipo', 'simple'], ['reset', 'tipo']]);
  });

  it('the Payloads group shows each payload; with a toggle it is a checkbox that loads by uri', async () => {
    const g = buildPropertyGroups(door(), schemas).find((x) => x.title === 'Payloads')!;
    expect(g.rows).toEqual([{ label: 'geo', value: 'Not loaded · ./a.ifcx', key: 'ifcx::payload::geo' }]);
    const calls: [string, boolean][] = [];
    const r = rows(door(), undefined, undefined, async (uri, on) => (calls.push([uri, on]), true)).get('ifcx::payload::geo')!;
    expect(r.edit).toMatchObject({ kind: 'bool', checked: false });
    await (r.edit as Extract<typeof r.edit, { kind: 'bool' }>)!.commit(true);
    expect(calls).toEqual([['./a.ifcx', true]]);
  });

  it('nodes without variants or payloads get neither group', () => {
    expect(titles(node('w'))).not.toContain('Variants');
    expect(titles(node('w'))).not.toContain('Payloads');
  });
});

describe('References', () => {
  const file = (data: IfcxNode[], id: string): IfcxFile => ({
    header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
    imports: [], schemas: {}, data,
  });
  const L = (name: string, location?: string): ProvenanceSource =>
    ({ role: 'layer', name, uri: null, ...(location && { location }) });
  const mat = file([{ path: 'mat', attributes: { 'bsi::ifc::prop::Name': 'Concrete', grade: 'C28' } }], 'mat');
  const ficha = file([{ path: 'ficha', inherits: { material: 'mat' }, attributes: { 'bsi::ifc::prop::Name': 'Pile 762', 'bsi::ifc::class': { code: 'IfcPile' } } }], 'ficha');
  const model = file([
    { path: 'pile', inherits: { ficha: 'ficha' }, attributes: { Depth: 12 } },
    { path: 'beam', attributes: { Depth: 1 } },
  ], 'model');
  const SM = L('mat', 'C:/p/lib/mat.ifcx');
  const SF = L('ficha', 'C:/p/lib/ficha.ifcx');
  const SD = L('model', 'C:/p/model.ifcx');
  type Result = ReturnType<typeof compose>;
  const build = (files: IfcxFile[], sources: ProvenanceSource[]) => compose(files, { sources });
  const base = () => build([mat, ficha, model], [SM, SF, SD]);
  const at = (r: Result, name: string) => r.root.children.find((c) => c.name === name)!;
  const ctxOf = (r: Result, extra: Partial<RefContext> = {}): RefContext =>
    ({ provenance: r.provenance, docPath: 'C:/p/model.ifcx', ...extra });
  const allRows = (n: ComposedNode, refs: RefContext) =>
    new Map(buildPropertyGroups(n, schemas, undefined, undefined, undefined, refs).flatMap((g) => g.rows).map((r) => [r.key, r]));

  it('References goes right after Identity Data', () => {
    const r = base();
    const t = buildPropertyGroups(at(r, 'pile'), schemas, undefined, undefined, undefined, ctxOf(r)).map((g) => g.title);
    expect(t[t.indexOf('Identity Data') + 1]).toBe('References');
  });

  it('one row per inheritance, and below it those of the target indented', () => {
    const r = base();
    const g = referencesGroup(at(r, 'pile'), ctxOf(r))!;
    expect(g.title).toBe('References');
    expect(g.rows).toMatchObject([
      { label: 'ficha', value: 'Pile 762 · lib/ficha.ifcx', indent: 0, key: 'ifcx::ref::ficha', title: 'C:/p/lib/ficha.ifcx' },
      { label: 'material', value: 'Concrete · lib/mat.ifcx', indent: 1, key: 'ifcx::ref::ficha/material' },
    ]);
  });

  it('sin herencias y un solo archivo no hay References, y la salida es la de siempre', () => {
    const r = base();
    const beam = at(r, 'beam');
    expect(referencesGroup(beam, ctxOf(r))).toBeNull();
    expect(buildPropertyGroups(beam, schemas, undefined, undefined, undefined, ctxOf(r))).toEqual(buildPropertyGroups(beam, schemas));
  });

  it('marcas: heredados con su cadena; locales sin marca', () => {
    const r = base();
    const rows = allRows(at(r, 'pile'), ctxOf(r));
    expect(rows.get('ifcx::class')!.mark).toEqual({ kind: 'inherited', text: 'ficha', title: 'lib/ficha.ifcx' });
    expect(rows.get('grade')!.mark).toEqual({ kind: 'inherited', text: 'ficha › material', title: 'lib/mat.ifcx' });
    expect(rows.get('Depth')!.mark).toBeUndefined();
  });

  it('un local que tapa a un heredado lleva la marca overrides', () => {
    const m = file([{ path: 'pile', inherits: { ficha: 'ficha' }, attributes: { 'bsi::ifc::class': { code: 'IfcSlab' } } }], 'model');
    const r = build([mat, ficha, m], [SM, SF, SD]);
    const mark = allRows(at(r, 'pile'), ctxOf(r)).get('ifcx::class')!.mark!;
    expect(mark).toEqual({ kind: 'overrides', text: 'overrides ficha', title: 'lib/ficha.ifcx' });
  });

  it('un local que tapa a otro local dice la fuente tapada', () => {
    const lib = file([{ path: 'g', attributes: { color: 'red' } }], 'lib');
    const m = file([
      { path: 'pile', children: { Body: 'g' } },
      { path: 'pile/Body', attributes: { color: 'blue' } },
    ], 'model');
    const r = build([lib, m], [SF, SD]);
    const body = at(r, 'pile').children.find((c) => c.name === 'Body')!;
    expect(attributeMarks(body, ctxOf(r)).get('color')).toEqual({ kind: 'overrides', text: 'overrides lib/ficha.ifcx', title: 'lib/ficha.ifcx' });
  });

  it('Defined in aparece si varios archivos escriben el nodo', () => {
    const over = file([{ path: 'pile', attributes: { Depth: 13 } }], 'over');
    const SO = L('over', 'C:/p/over.ifcx');
    const r = build([mat, ficha, model, over], [SM, SF, SD, SO]);
    const rows = referencesGroup(at(r, 'pile'), ctxOf(r))!.rows;
    expect(rows.find((x) => x.key === 'ifcx::defined-in')).toMatchObject({ label: 'Defined in', value: 'model.ifcx, over.ifcx' });
    const beam = file([{ path: 'beam', attributes: { Depth: 2 } }], 'over');
    const r2 = build([mat, ficha, model, beam], [SM, SF, SD, SO]);
    expect(referencesGroup(at(r2, 'beam'), ctxOf(r2))!.rows.map((x) => x.key)).toEqual(['ifcx::defined-in']);
  });

  it('Copy path and Open actions with the location of the file', () => {
    const r = base();
    const opened: string[] = [];
    const copied: string[] = [];
    const ctx = ctxOf(r, { open: (p) => opened.push(p), copy: (t) => copied.push(t) });
    const row0 = referencesGroup(at(r, 'pile'), ctx)!.rows[0];
    expect(row0.actions!.map((a) => a.label)).toEqual(['Copy path', 'Open']);
    row0.actions![1].run();
    row0.actions![0].run();
    expect(opened).toEqual(['C:/p/lib/ficha.ifcx']);
    expect(copied).toEqual(['C:/p/lib/ficha.ifcx']);
    expect(referencesGroup(at(r, 'pile'), ctxOf(r))!.rows[0].actions).toBeUndefined();
  });

  it('a target that does not resolve comes out as not found, without actions or children', () => {
    const r = build([mat, model], [SM, SD]);
    const ctx = ctxOf(r, { open: () => {}, copy: () => {} });
    const rows = referencesGroup(at(r, 'pile'), ctx)!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'ficha', missing: true, indent: 0, value: 'ficha · not found' });
    expect(rows[0].actions).toBeUndefined();
  });

  it('un ciclo a <-> b termina', () => {
    const f = file([
      { path: 'x', inherits: { a: 'a' } },
      { path: 'a', inherits: { b: 'b' }, attributes: { k: 1 } },
      { path: 'b', inherits: { a: 'a' }, attributes: { j: 1 } },
    ], 'f');
    const r = build([f], [L('f', 'C:/p/f.ifcx')]);
    const rows = referencesGroup(at(r, 'x'), ctxOf(r))!.rows;
    expect(rows.map((x) => [x.label, x.indent])).toEqual([['a', 0], ['b', 1]]);
  });

  it('labels: without docPath the absolute path; without a location the name; a url as it is', () => {
    expect(sourceLabel(SF, null)).toBe('C:/p/lib/ficha.ifcx');
    expect(sourceLabel(SF, 'C:/p/model.ifcx')).toBe('lib/ficha.ifcx');
    expect(sourceLabel(L('x', 'C:/q/x.ifcx'), 'C:/p/model.ifcx')).toBe('../q/x.ifcx');
    expect(sourceLabel(L('Edits'), 'C:/p/model.ifcx')).toBe('Edits');
    expect(sourceLabel(L('web', 'https://x/lib.ifcx'), 'C:/p/model.ifcx')).toBe('https://x/lib.ifcx');

    const ctx = (r: Result) => ctxOf(r, { open: () => {}, copy: () => {} });
    const r1 = build([mat, ficha, model], [SM, L('ficha'), SD]);
    const row1 = referencesGroup(at(r1, 'pile'), ctx(r1))!.rows[0];
    expect(row1).toMatchObject({ value: 'Pile 762 · ficha', title: 'ficha' });
    expect(row1.actions).toBeUndefined();

    const r2 = build([mat, ficha, model], [SM, L('web', 'https://x/lib.ifcx'), SD]);
    const row2 = referencesGroup(at(r2, 'pile'), ctx(r2))!.rows[0];
    expect(row2.value).toBe('Pile 762 · https://x/lib.ifcx');
    expect(row2.actions!.map((a) => a.label)).toEqual(['Copy path']);

    const r3 = build([mat, ficha, model], [SM, SF, SD]);
    const row3 = referencesGroup(at(r3, 'pile'), { ...ctx(r3), docPath: null })!.rows[0];
    expect(row3.value).toBe('Pile 762 · C:/p/lib/ficha.ifcx');
  });

  it('fuentes por defecto (sin location) no rompen nada', () => {
    const r = compose([mat, ficha, model]);
    const rows = referencesGroup(at(r, 'pile'), { provenance: r.provenance, docPath: null, open: () => {}, copy: () => {} })!.rows;
    expect(rows[0]).toMatchObject({ value: 'Pile 762 · ficha' });
    expect(rows[0].actions).toBeUndefined();
  });

  it('el nombre del destino: Name, si no bsi::ifc::material.code, si no la ruta', () => {
    const f = file([
      { path: 'x', inherits: { m1: 'm1', m2: 'm2', m3: 'm3', m4: 'm4' } },
      { path: 'm1', attributes: { 'bsi::ifc::material': { code: 'Hormigón armado 28 MPa', uri: '' } } },
      { path: 'm2', attributes: { 'bsi::ifc::prop::Name': 'Named', 'bsi::ifc::material': { code: 'Code', uri: '' } } },
      { path: 'm3', attributes: { 'bsi::ifc::material': { code: '', uri: '' } } },
      { path: 'm4', attributes: { 'bsi::ifc::material': { code: 7 } } },
    ], 'f');
    const r = build([f], [L('f', 'C:/p/f.ifcx')]);
    expect(referencesGroup(at(r, 'x'), ctxOf(r))!.rows.map((x) => x.value)).toEqual([
      'Hormigón armado 28 MPa · f.ifcx', 'Named · f.ifcx', 'm3 · f.ifcx', 'm4 · f.ifcx',
    ]);
  });

  describe('overlays de sidecars', () => {
    const OV: ProvenanceSource = { role: 'layer', name: 'studio-classification', uri: null, layerId: 'overlay:studio-classification' };
    const cls = (path: string) => file([{ path, attributes: { 'studio::classification': 'x' } }], 'studio-classification');

    it('un elemento sin herencias con overlay no gana References', () => {
      const r = build([mat, ficha, model, cls('beam')], [SM, SF, SD, OV]);
      const beam = at(r, 'beam');
      expect(referencesGroup(beam, ctxOf(r))).toBeNull();
      const sinRefs = buildPropertyGroups(beam, schemas);
      expect(buildPropertyGroups(beam, schemas, undefined, undefined, undefined, ctxOf(r))).toEqual(sinRefs);
    });

    it('dos archivos reales (y una capa de ediciones) siguen dando Defined in', () => {
      const over = file([{ path: 'beam', attributes: { Depth: 2 } }], 'over');
      const ED: ProvenanceSource = { role: 'layer', name: 'model (edits)', uri: null, layerId: 'L1:edits' };
      const r = build([mat, ficha, model, over], [SM, SF, SD, ED]);
      expect(referencesGroup(at(r, 'beam'), ctxOf(r))!.rows).toMatchObject([
        { key: 'ifcx::defined-in', value: 'model.ifcx, model (edits)' },
      ]);
    });

    it('with inheritances and overlay: References yes, Defined in does not list the overlay', () => {
      const r = build([mat, ficha, model, cls('pile')], [SM, SF, SD, OV]);
      const rows = referencesGroup(at(r, 'pile'), ctxOf(r))!.rows;
      expect(rows.map((x) => x.label)).toEqual(['ficha', 'material']);
      const over = file([{ path: 'pile', attributes: { Depth: 13 } }], 'over');
      const r2 = build([mat, ficha, model, over, cls('pile')], [SM, SF, SD, L('over', 'C:/p/over.ifcx'), OV]);
      const def = referencesGroup(at(r2, 'pile'), ctxOf(r2))!.rows.find((x) => x.key === 'ifcx::defined-in')!;
      expect(def.value).toBe('model.ifcx, over.ifcx');
    });
  });

  it('a card without a Name that inherits a material is named by its path; the material, by its code', () => {
    const f = file([
      { path: 'x', inherits: { ficha: 'fi' } },
      { path: 'fi', inherits: { material: 'm' } },
      { path: 'm', attributes: { 'bsi::ifc::material': { code: 'Hormigón', uri: '' } } },
    ], 'f');
    const r = build([f], [L('f', 'C:/p/f.ifcx')]);
    expect(referencesGroup(at(r, 'x'), ctxOf(r))!.rows.map((x) => x.value)).toEqual(['fi · f.ifcx', 'Hormigón · f.ifcx']);
  });

  it('Open is hidden if the location is the document itself; Copy path stays', () => {
    const f = file([
      { path: 'x', inherits: { t: 't' } },
      { path: 't', attributes: { 'bsi::ifc::prop::Name': 'T' } },
    ], 'f');
    const r = build([f], [L('f', 'C:/p/model.ifcx')]);
    const ctx = ctxOf(r, { docPath: 'c:\\p\\model.ifcx', open: () => {}, copy: () => {} });
    expect(referencesGroup(at(r, 'x'), ctx)!.rows[0].actions!.map((a) => a.label)).toEqual(['Copy path']);
  });

  it('a node with variants: References yes, marks no', () => {
    const r = base();
    const pile = { ...at(r, 'pile'), variantSets: { t: { options: ['a'], selected: 'a' } } };
    expect(attributeMarks(pile, ctxOf(r)).size).toBe(0);
    expect(referencesGroup(pile, ctxOf(r))!.rows[0].label).toBe('ficha');
  });
});

describe('PropertiesPanel references', () => {
  const file = (data: IfcxNode[], id: string): IfcxFile => ({
    header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
    imports: [], schemas: {}, data,
  });
  const L = (name: string, location: string): ProvenanceSource => ({ role: 'layer', name, uri: null, location });
  const mat = file([{ path: 'mat', attributes: { 'bsi::ifc::prop::Name': 'Concrete', grade: 'C28' } }], 'mat');
  const ficha = file([{ path: 'ficha', inherits: { material: 'mat' }, attributes: { 'bsi::ifc::prop::Name': 'Pile 762', 'bsi::ifc::class': { code: 'IfcPile' } } }], 'ficha');
  const model = file([
    { path: 'pile', inherits: { ficha: 'ficha' }, attributes: { Depth: 12 } },
    { path: 'beam', attributes: { Depth: 1 } },
  ], 'model');
  const SM = L('mat', 'C:/p/lib/mat.ifcx');
  const SF = L('ficha', 'C:/p/lib/ficha.ifcx');
  const SD = L('model', 'C:/p/model.ifcx');
  const at = (r: ReturnType<typeof compose>, name: string) => r.root.children.find((c) => c.name === name)!;
  let el: HTMLElement;
  let panel: PropertiesPanel;
  beforeEach(() => {
    document.body.innerHTML = '<div id="p"></div>';
    el = document.getElementById('p') as HTMLElement;
    panel = new PropertiesPanel(el);
  });
  const rowOf = (label: string) => [...el.querySelectorAll('tr')].find((tr) => tr.querySelector('.prop-name')?.firstChild?.textContent?.replace(/^↳ /, '') === label)!;

  function setup(extra: Partial<RefContext> = {}) {
    const r = compose([mat, ficha, model], { sources: [SM, SF, SD] });
    const opened: string[] = [];
    const copied: string[] = [];
    const refs: RefContext = { provenance: r.provenance, docPath: 'C:/p/model.ifcx', open: (p) => opened.push(p), copy: (t) => copied.push(t), ...extra };
    return { r, refs, opened, copied };
  }

  it('it paints the References group, the indentation and the provenance mark', () => {
    const { r, refs } = setup();
    panel.show(at(r, 'pile'), schemas, undefined, undefined, undefined, refs);
    const titles = [...el.querySelectorAll('summary')].map((s) => s.textContent);
    expect(titles).toContain('References');
    expect(rowOf('material').classList.contains('prop-indent')).toBe(true);
    expect(rowOf('material').querySelector('.prop-name')!.textContent).toMatch(/^↳ material/);
    expect(rowOf('ficha').classList.contains('prop-indent')).toBe(false);
    const mark = rowOf('IFC Class').querySelector('.prop-mark')!;
    expect(mark.textContent).toBe('ficha');
    expect(mark.getAttribute('title')).toBe('lib/ficha.ifcx');
    expect(mark.classList.contains('prop-mark-overrides')).toBe(false);
    expect(rowOf('ficha').querySelector('td.prop-value')!.getAttribute('title')).toBe('C:/p/lib/ficha.ifcx');
  });

  it('Open y Copy path llaman a open y copy con la ruta del archivo', () => {
    const { r, refs, opened, copied } = setup();
    panel.show(at(r, 'pile'), schemas, undefined, undefined, undefined, refs);
    const row = rowOf('ficha');
    row.querySelector<HTMLButtonElement>('[aria-label="Open"]')!.click();
    expect(opened).toEqual(['C:/p/lib/ficha.ifcx']);
    expect(copied).toEqual([]);
    row.querySelector<HTMLButtonElement>('[aria-label="Copy path"]')!.click();
    expect(copied).toEqual(['C:/p/lib/ficha.ifcx']);
    expect(row.querySelector('button')!.getAttribute('type')).toBe('button');
  });

  it('the actions are siblings of the text (not inside the one that is clipped); without actions, the usual DOM', () => {
    const { r, refs } = setup();
    panel.show(at(r, 'pile'), schemas, undefined, undefined, undefined, refs);
    const wrap = rowOf('ficha').querySelector('td.prop-value > .prop-ref-value')!;
    const text = wrap.querySelector('.prop-ref-text')!;
    expect(text.textContent).toBe('Pile 762 · lib/ficha.ifcx');
    const buttons = [...wrap.querySelectorAll('button.prop-action')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Copy path', 'Open']);
    for (const b of buttons) {
      expect(b.parentElement).toBe(wrap);
      expect(text.contains(b)).toBe(false);
    }
    // sin open ni copy no hay acciones y la celda es la de siempre
    const plain = setup({ open: undefined, copy: undefined });
    panel.show(at(plain.r, 'pile'), schemas, undefined, undefined, undefined, plain.refs);
    expect(rowOf('ficha').querySelector('.prop-ref-value')).toBeNull();
    expect(rowOf('ficha').querySelector('td.prop-value')!.textContent).toBe('Pile 762 · lib/ficha.ifcx');
  });

  it('a target that does not resolve carries prop-missing and no button', () => {
    const r = compose([mat, model], { sources: [SM, SD] });
    const refs: RefContext = { provenance: r.provenance, docPath: 'C:/p/model.ifcx', open: () => {}, copy: () => {} };
    panel.show(at(r, 'pile'), schemas, undefined, undefined, undefined, refs);
    const row = rowOf('ficha');
    expect(row.classList.contains('prop-missing')).toBe(true);
    expect(row.querySelector('.prop-action')).toBeNull();
  });

  it('una marca overrides lleva prop-mark-overrides', () => {
    const m = file([{ path: 'pile', inherits: { ficha: 'ficha' }, attributes: { 'bsi::ifc::class': { code: 'IfcSlab' } } }], 'model');
    const r = compose([mat, ficha, m], { sources: [SM, SF, SD] });
    const refs: RefContext = { provenance: r.provenance, docPath: 'C:/p/model.ifcx' };
    panel.show(at(r, 'pile'), schemas, undefined, undefined, undefined, refs);
    const mark = rowOf('IFC Class').querySelector('.prop-mark')!;
    expect(mark.classList.contains('prop-mark-overrides')).toBe(true);
    expect(mark.textContent).toBe('overrides ficha');
  });

  it('sin References ni marcas el panel queda igual que sin refs', () => {
    const { r, refs } = setup();
    panel.show(at(r, 'beam'), schemas);
    const sin = el.innerHTML;
    panel.show(at(r, 'beam'), schemas, undefined, undefined, undefined, refs);
    expect(el.innerHTML).toBe(sin);
  });
});
