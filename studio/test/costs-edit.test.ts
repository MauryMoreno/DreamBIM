import { describe, expect, it } from 'vitest';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import { applyCodeEdit, replaceSystemCodes, type CodeEdit, type SystemEntry } from '../src/costs/edit';
import type { CostCode, CostSystem } from '../src/costs/system';

const ATTR = 'prj::costos::codigo';
const node = (c: string, attrs: Record<string, unknown>): IfcxNode => ({ path: `n-${c}`, attributes: { [ATTR]: { code: c, name: c }, ...attrs } });
const file = (data: IfcxNode[]): IfcxFile => ({ header: { id: 'f', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data });

const code = (c: string, parent: string | null): CostCode => ({
  path: `n-${c}`, code: c, name: c, parent, medicion: null, manualPrice: null, origin: null, unitPrice: 0, priceFrom: 'none', warning: null, role: 'import', location: 'x',
});
const codes = [code('O', null), code('O.1', 'O'), code('O.1.1', 'O.1'), code('P', null)];
const system: CostSystem = {
  id: 's', name: 's', attribute: ATTR, currency: 'USD', codes, warning: null, rootPath: 'root', role: 'import', location: 'x', byCode: new Map(codes.map((c) => [c.code, c])),
  children: (p) => codes.filter((c) => c.parent === p),
};
const base = (): IfcxFile => file([
  node('O', {}),
  node('O.1', { 'prj::medicion': { unit: 'm', measure: 'length', quantity: ['Depth'] }, 'prj::precio': 3, extra: 'x' }),
  node('O.1.1', {}),
  node('P', {}),
]);
const same: CodeEdit = { name: 'O.1', parent: null, medicion: { unit: 'm', measure: 'length' }, manualPrice: 3 };
const attrsOf = (f: IfcxFile | string, c: string) => (f as IfcxFile).data.find((n) => n.path === `n-${c}`)!.attributes!;

describe('applyCodeEdit', () => {
  it('escribe los campos en el nodo y no toca los otros nodos', () => {
    const f = base();
    const out = applyCodeEdit(f, system, 'n-O.1', { name: 'Nuevo', parent: 'P', medicion: { unit: 'm²', measure: 'area' }, manualPrice: 9 }) as IfcxFile;
    const a = attrsOf(out, 'O.1');
    expect(a[ATTR]).toEqual({ code: 'O.1', name: 'Nuevo', parent: 'P' });
    expect(a['prj::medicion']).toEqual({ unit: 'm²', measure: 'area', quantity: ['Depth'] });
    expect(a['prj::precio']).toBe(9);
    expect(a.extra).toBe('x');
    for (const c of ['O', 'O.1.1', 'P']) expect(out.data.find((n) => n.path === `n-${c}`)).toBe(f.data.find((n) => n.path === `n-${c}`));
    expect(f).toEqual(base());
  });

  it('a node that is not in the file gives a text', () => {
    const out = applyCodeEdit(base(), system, 'n-O.1', { ...same, medicion: null });
    expect('prj::medicion' in attrsOf(out, 'O.1')).toBe(false);
  });

  it('quitar el precio borra la clave', () => {
    const a = attrsOf(applyCodeEdit(base(), system, 'n-O.1', { ...same, manualPrice: null }), 'O.1');
    expect('prj::precio' in a).toBe(false);
  });

  it('editing a code clears the old reference to an APU', () => {
    const f = base();
    f.data[1].attributes!['prj::referencia'] = 'apu-1';
    expect('prj::referencia' in attrsOf(applyCodeEdit(f, system, 'n-O.1', same), 'O.1')).toBe(false);
  });

  it('removing the parent deletes the key and keeps the code', () => {
    const f = file([node('O.1', {})]);
    f.data[0].attributes![ATTR] = { code: 'O.1', name: 'O.1', parent: 'O' };
    expect(attrsOf(applyCodeEdit(f, system, 'n-O.1', { name: 'O.1', parent: null, medicion: null, manualPrice: null }), 'O.1')[ATTR]).toEqual({ code: 'O.1', name: 'O.1' });
  });

  it('sin cambios devuelve el mismo archivo', () => {
    const f = base();
    expect(applyCodeEdit(f, system, 'n-O.1', same)).toBe(f);
  });

  it('a node that is not in the file gives a text', () => {
    const out = applyCodeEdit(file([node('P', {})]), system, 'n-O.1', same);
    expect(typeof out).toBe('string');
  });

  it('a code cannot hang from itself or from a descendant', () => {
    expect(applyCodeEdit(base(), system, 'n-O.1', { ...same, parent: 'O.1' })).toBe('A code cannot hang from itself');
    expect(applyCodeEdit(base(), system, 'n-O', { ...same, name: 'O', parent: 'O.1.1' })).toBe('A code cannot hang from itself');
  });
});

describe('origen del precio', () => {
  it('applyCodeEdit escribe el origen, lo borra con null y no lo toca sin la clave', () => {
    const origin = { doc: 'C:/q/a.pdf', cell: 'p2!r1' };
    const withIt = applyCodeEdit(base(), system, 'n-O.1', { ...same, origin }) as IfcxFile;
    expect(attrsOf(withIt, 'O.1')['prj::origen']).toEqual({ documento: 'C:/q/a.pdf', celda: 'p2!r1' });
    expect(attrsOf(applyCodeEdit(withIt, system, 'n-O.1', { ...same, manualPrice: 4 }), 'O.1')['prj::origen']).toEqual({ documento: 'C:/q/a.pdf', celda: 'p2!r1' });
    expect('prj::origen' in attrsOf(applyCodeEdit(withIt, system, 'n-O.1', { ...same, origin: null }), 'O.1')).toBe(false);
  });

  it('declares the schema of the origin when the file did not have it (files from before origins)', () => {
    const out = applyCodeEdit(base(), system, 'n-O.1', { ...same, origin: { doc: 'a.pdf', cell: 'p1' } }) as IfcxFile;
    expect(out.schemas['prj::origen']).toBeDefined();
    expect(base().schemas['prj::origen']).toBeUndefined();
  });

  it('replaceSystemCodes declares the schema of the origin too', () => {
    const out = replaceSystemCodes(base(), system, [
      { code: 'O', name: 'O', parent: null, medicion: null, manualPrice: null },
      { code: 'O.1', name: 'O.1', parent: null, medicion: { unit: 'm', measure: 'length' }, manualPrice: 3, origin: { doc: 'a.pdf', cell: 'p1' } },
      { code: 'O.1.1', name: 'O.1.1', parent: null, medicion: null, manualPrice: null },
      { code: 'P', name: 'P', parent: null, medicion: null, manualPrice: null },
    ]) as IfcxFile;
    expect(out.schemas['prj::origen']).toBeDefined();
  });

  it('keeps a schema the file already declares', () => {
    const f = base();
    const own = { value: { dataType: 'Object' as const } };
    f.schemas['prj::origen'] = own;
    const out = applyCodeEdit(f, system, 'n-O.1', { ...same, origin: { doc: 'a.pdf', cell: 'p1' } }) as IfcxFile;
    expect(out.schemas['prj::origen']).toBe(own);
  });
});

describe('replaceSystemCodes', () => {
  /** The entries as the modal leaves them: those of the base file without changes. */
  const entries = (): SystemEntry[] => [
    { code: 'O', name: 'O', parent: null, medicion: null, manualPrice: null },
    { code: 'O.1', name: 'O.1', parent: 'O', medicion: { unit: 'm', measure: 'length' }, manualPrice: 3 },
    { code: 'O.1.1', name: 'O.1.1', parent: 'O.1', medicion: null, manualPrice: null },
    { code: 'P', name: 'P', parent: null, medicion: null, manualPrice: null },
  ];
  // the base file with the parents written, as the system would read it
  const withParents = (): IfcxFile => {
    const f = base();
    const parents: Record<string, string> = { 'O.1': 'O', 'O.1.1': 'O.1' };
    for (const n of f.data) {
      const a = n.attributes![ATTR] as { code: string };
      if (parents[a.code]) n.attributes![ATTR] = { ...a, parent: parents[a.code] };
    }
    return f;
  };

  it('sin cambios devuelve el mismo archivo', () => {
    const f = withParents();
    expect(replaceSystemCodes(f, system, entries())).toBe(f);
  });

  it('changes description, unit, price and reference of a code that already exists', () => {
    const e = entries();
    e[1] = { ...e[1], name: 'Losas', medicion: { unit: 'm²', measure: 'area' }, manualPrice: 12 };
    const a = attrsOf(replaceSystemCodes(withParents(), system, e), 'O.1');
    expect(a[ATTR]).toEqual({ code: 'O.1', name: 'Losas', parent: 'O' });
    expect(a['prj::medicion']).toEqual({ unit: 'm²', measure: 'area', quantity: ['Depth'] });
    expect('prj::referencia' in a).toBe(false);
    expect(a['prj::precio']).toBe(12);
    expect(a.extra).toBe('x');
  });

  it('without a unit the line is a heading: the measurement is removed', () => {
    const e = entries();
    e[1] = { ...e[1], medicion: null };
    expect('prj::medicion' in attrsOf(replaceSystemCodes(withParents(), system, e), 'O.1')).toBe(false);
  });

  it('adds new codes, also under another new code', () => {
    const e = [
      ...entries(),
      { code: 'Q', name: 'Nuevo', parent: null, medicion: null, manualPrice: null },
      { code: 'Q.1', name: 'Hijo', parent: 'Q', medicion: { unit: 'u', measure: 'count' as const }, manualPrice: 5 },
    ];
    const out = replaceSystemCodes(withParents(), system, e) as IfcxFile;
    expect(out.data.slice(-2)).toEqual([
      { path: 's-Q', attributes: { [ATTR]: { code: 'Q', name: 'Nuevo' } } },
      {
        path: 's-Q.1',
        attributes: { [ATTR]: { code: 'Q.1', name: 'Hijo', parent: 'Q' }, 'prj::medicion': { unit: 'u', measure: 'count' }, 'prj::precio': 5 },
      },
    ]);
  });

  it('deletes the codes that are no longer there', () => {
    const e = entries().filter((x) => x.code !== 'O.1' && x.code !== 'O.1.1');
    expect((replaceSystemCodes(withParents(), system, e) as IfcxFile).data.map((n) => n.path)).toEqual(['n-O', 'n-P']);
  });

  it('rejects an empty or repeated code and a parent that is not there', () => {
    expect(replaceSystemCodes(withParents(), system, [...entries(), { ...entries()[0], code: ' ' }])).toBe('Enter a code');
    expect(replaceSystemCodes(withParents(), system, [...entries(), { ...entries()[3] }])).toBe('This code already exists');
    expect(replaceSystemCodes(withParents(), system, [...entries(), { ...entries()[3], code: 'Z', parent: 'NO' }])).toBe('The heading does not exist');
  });

  it('writes the origin in a code that remains and in a new one', () => {
    const origin = { doc: 'C:/q/a.xlsx', cell: 'Hoja1!B3' };
    const e = entries();
    e[1] = { ...e[1], origin };
    const out = replaceSystemCodes(withParents(), system, [...e, { code: 'Q', name: 'q', parent: null, medicion: { unit: 'u', measure: 'count' }, manualPrice: 2, origin }]) as IfcxFile;
    expect(attrsOf(out, 'O.1')['prj::origen']).toEqual({ documento: 'C:/q/a.xlsx', celda: 'Hoja1!B3' });
    expect(out.data.at(-1)!.attributes!['prj::origen']).toEqual({ documento: 'C:/q/a.xlsx', celda: 'Hoja1!B3' });
  });

  it('no pisa una ruta ocupada', () => {
    const f = withParents();
    f.data.push({ path: 's-X', attributes: {} });
    const out = replaceSystemCodes(f, system, [...entries(), { code: 'X', name: 'x', parent: null, medicion: null, manualPrice: null }]) as IfcxFile;
    expect(out.data.at(-1)!.path).toBe('s-X-2');
  });

  it('no modifica el archivo de entrada', () => {
    const f = withParents();
    const copy = structuredClone(f);
    const e = entries();
    e[0] = { ...e[0], name: 'Otro' };
    replaceSystemCodes(f, system, [...e, { code: 'Q', name: 'q', parent: null, medicion: null, manualPrice: null }]);
    expect(f).toEqual(copy);
  });
});
