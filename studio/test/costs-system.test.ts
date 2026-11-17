// The cost system is read from the composed model: the root, the codes (headings and items) and the price of each
// partida, por referencia a un APU o insumo de un archivo de precios importado, o a mano.
import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { elementCode, K_COST_SYSTEM, readCostSystem } from '../src/costs/system';

const ATTR = 'prj::costos::codigo';
const file = (id: string, data: IfcxNode[]): IfcxFile => ({
  header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data,
});
const src = (name: string): ProvenanceSource => ({ role: 'import', name, uri: name, location: `C:/t/${name}` });
const docSrc: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document' };

const root = (id = 'c', currency = 'EUR'): IfcxNode => ({
  path: `root-${id}`, attributes: { [K_COST_SYSTEM]: { id, name: id.toUpperCase(), attribute: ATTR, currency } },
});
const code = (c: string, over: { name?: string; parent?: string; medicion?: unknown; ref?: string; price?: number } = {}): IfcxNode => ({
  path: `code-${c}`,
  attributes: {
    [ATTR]: { code: c, name: over.name ?? `Name ${c}`, ...(over.parent ? { parent: over.parent } : {}) },
    ...(over.medicion ? { 'prj::medicion': over.medicion } : {}),
    ...(over.ref ? { 'prj::referencia': over.ref } : {}),
    ...(over.price !== undefined ? { 'prj::precio': over.price } : {}),
  },
});
const m3 = { unit: 'm³', measure: 'volume' };

const prices = file('precios', [
  { path: 'ins-con', attributes: { 'prj::apu::insumo': { codigo: 'MAT-CON', descripcion: 'Concreto', unidad: 'm³', tipo: 'material', precio: 150 } } },
  { path: 'ins-acr', attributes: { 'prj::apu::insumo': { codigo: 'MAT-ACR', descripcion: 'Acero', unidad: 'kg', tipo: 'material', precio: 1.15 } } },
  { path: 'ins-x', attributes: { 'prj::apu::insumo': { codigo: 'X', descripcion: 'Insumo X', unidad: 'u', tipo: 'material', precio: 7 } } },
  { path: 'ins-sin', attributes: { 'prj::apu::insumo': { codigo: 'S', descripcion: 'Sin precio', unidad: 'u', tipo: 'material' } } },
  {
    path: 'apu-1',
    attributes: {
      'studio::cost::price': { code: 'APU-1', description: 'Losa', unit: 'm³', price: 1 },
      'prj::apu::detalle': { insumos: [{ ref: 'ins-con', cantidad: 1.05 }, { ref: 'ins-acr', cantidad: 63 }] },
    },
  },
  {
    path: 'apu-2',
    attributes: {
      'studio::cost::price': { code: 'APU-2', description: 'Incompleto', unit: 'u', price: 99 },
      'prj::apu::detalle': { insumos: [{ ref: 'ins-sin', cantidad: 1 }] },
    },
  },
]);

const cat = (codes: IfcxNode[], r = root()): IfcxFile => file('costos', [r, ...codes]);
const standard = (): IfcxNode[] => [
  code('01'),
  code('01.01', { parent: '01', medicion: m3, ref: 'apu-1' }),
  code('01.02', { parent: '01', medicion: { unit: 'u', measure: 'count' }, price: 12 }),
];
const cls = { 'bsi::ifc::class': { code: 'IfcSlab' } };
const model = file('m', [
  { path: 'E1', inherits: { costos: 'code-01.01' }, attributes: cls },
  { path: 'E2', attributes: { ...cls, [ATTR]: { code: '01.02' } } },
  { path: 'E3', attributes: cls },
]);

const build = (codes: IfcxNode[], extra: IfcxFile[] = [], r = root()) => {
  const layers = [prices, cat(codes, r), ...extra, model];
  const sources = [src('precios.ifcx'), src('costos.ifcx'), ...extra.map((_, i) => src(`otro${i}.ifcx`)), docSrc];
  return compose(layers, { sources });
};
const sys = (codes: IfcxNode[], extra: IfcxFile[] = [], r = root()) => readCostSystem(build(codes, extra, r))!;

describe('readCostSystem', () => {
  it('it reads the root, the currency and the codes with their hierarchy', () => {
    const s = sys(standard());
    expect(s.id).toBe('c');
    expect(s.currency).toBe('EUR');
    expect(s.attribute).toBe(ATTR);
    expect(s.codes).toHaveLength(3);
    expect(s.children(null).map((c) => c.code)).toEqual(['01']);
    expect(s.children('01').map((c) => c.code)).toEqual(['01.01', '01.02']);
    expect(s.byCode.get('01')!.medicion).toBeNull();
    expect(s.byCode.get('01.01')!.medicion).toEqual({ unit: 'm³', measure: 'volume' });
    expect(s.byCode.get('01.01')!.path).toBe('code-01.01');
    expect(s.byCode.get('01.01')!.location).toBe('C:/t/costos.ifcx');
    expect(s.warning).toBeNull();
  });

  it('vale el precio escrito', () => {
    const c = sys(standard()).byCode.get('01.02')!;
    expect(c.unitPrice).toBe(12);
    expect(c.priceFrom).toBe('manual');
    expect(c.manualPrice).toBe(12);
    expect(c.warning).toBeNull();
  });

  it('una referencia antigua a un APU ya no da el precio: vale el escrito', () => {
    const c = sys([code('A', { medicion: m3, ref: 'apu-1', price: 5 })]).byCode.get('A')!;
    expect(c.unitPrice).toBe(5);
    expect(c.priceFrom).toBe('manual');
    expect(c.warning).toBeNull();
    const d = sys([code('B', { medicion: m3, ref: 'apu-1' })]).byCode.get('B')!;
    expect(d.unitPrice).toBe(0);
    expect(d.warning).toBe('No price');
  });

  it('una partida sin precio vale 0 y avisa', () => {
    const c = sys([code('A', { medicion: m3 })]).byCode.get('A')!;
    expect(c.unitPrice).toBe(0);
    expect(c.priceFrom).toBe('none');
    expect(c.warning).toBe('No price');
  });

  it('a heading line has neither price nor warning', () => {
    const c = sys([code('A', { price: 4 })]).byCode.get('A')!;
    expect(c.medicion).toBeNull();
    expect(c.warning).toBeNull();
  });

  it('a currency that is not in the list falls back to USD', () => {
    expect(sys(standard(), [], root('c', 'XXX')).currency).toBe('USD');
  });

  it('a measure that is not measured in the model leaves the line as a heading', () => {
    const c = sys([code('A', { medicion: { unit: 'u', measure: 'manual' } })]).byCode.get('A')!;
    expect(c.medicion).toBeNull();
  });

  it('with two systems it uses the first and warns; it does not mix their codes', () => {
    const second = file('otro', [root('c2'), code('ZZ', { medicion: m3 })]);
    const s = sys(standard(), [second]);
    expect(s.id).toBe('c');
    expect(s.warning).toContain('c2');
    expect(s.byCode.has('ZZ')).toBe(false);
    expect(s.codes).toHaveLength(3);
  });

  it('a parent that does not exist or forms a cycle leaves the code as a root', () => {
    const s = sys([code('A', { parent: 'NO' }), code('B', { parent: 'C' }), code('C', { parent: 'B' }), code('D', { parent: 'D' })]);
    const reach = (c: string | null): number => s.children(c).reduce((n, k) => n + 1 + reach(k.code), 0);
    expect(reach(null)).toBe(4);
    expect(s.children(null).map((c) => c.code)).toContain('A');
  });

  it('a broken parent higher up in the chain does not hang the calculation, with the child listed earlier', () => {
    const s = sys([code('A', { parent: 'B' }), code('B', { parent: 'Z' })]);
    const reach = (c: string | null): number => s.children(c).reduce((n, k) => n + 1 + reach(k.code), 0);
    expect(reach(null)).toBe(2);
    expect(s.children(null).map((c) => c.code)).toEqual(['B']);
    expect(s.children('B').map((c) => c.code)).toEqual(['A']);
  });

  it('an element is not a code even if it carries the attribute', () => {
    expect(sys(standard()).codes.map((c) => c.code)).not.toContain('E2');
    expect(sys(standard()).byCode.size).toBe(3);
  });

  it('if the system file has no path (unsaved document) the location is null', () => {
    const r = compose([prices, cat(standard()), model], { sources: [src('precios.ifcx'), { role: 'layer', name: 'costos sin guardar', uri: null, layerId: 'x' }, docSrc] });
    const s = readCostSystem(r)!;
    expect(s.codes).toHaveLength(3);
    expect(s.byCode.get('01.01')!.location).toBeNull();
  });

  it('only an import can be written: a code of a layer, even if it has a path, has no location', () => {
    const asLayer = { role: 'layer', name: 'doc', uri: null, layerId: 'document', location: 'C:/t/doc.ifcx' } as ProvenanceSource;
    const r = compose([prices, cat(standard()), model], { sources: [src('precios.ifcx'), asLayer, docSrc] });
    const c = readCostSystem(r)!.byCode.get('01.01')!;
    expect(c.role).toBe('layer');
    expect(c.location).toBeNull();
    expect(sys(standard()).byCode.get('01.01')!.role).toBe('import');
  });

  it('the system knows the path of its root and whether its file can be written', () => {
    const s = sys(standard());
    expect(s.rootPath).toBe('root-c');
    expect(s.role).toBe('import');
    expect(s.location).toBe('C:/t/costos.ifcx');
    const asLayer = { role: 'layer', name: 'doc', uri: null, layerId: 'document', location: 'C:/t/doc.ifcx' } as ProvenanceSource;
    const r = compose([prices, cat(standard()), model], { sources: [src('precios.ifcx'), asLayer, docSrc] });
    expect(readCostSystem(r)!.location).toBeNull();
  });

  it('it reads which document the manual price came from', () => {
    const withOrigin: IfcxNode = {
      path: 'code-A',
      attributes: {
        [ATTR]: { code: 'A', name: 'A' }, 'prj::medicion': m3, 'prj::precio': 5,
        'prj::origen': { documento: 'C:/q/a.pdf', celda: 'p2!r1' },
      },
    };
    const s = sys([withOrigin, code('B', { medicion: m3, price: 1 })]);
    expect(s.byCode.get('A')!.origin).toEqual({ doc: 'C:/q/a.pdf', cell: 'p2!r1' });
    expect(s.byCode.get('B')!.origin).toBeNull();
  });

  it('sin sistema devuelve null', () => {
    expect(readCostSystem(compose([model], { sources: [docSrc] }))).toBeNull();
  });
});

describe('elementCode', () => {
  const r = build(standard());
  const s = readCostSystem(r)!;
  const of = (origin: string) => elementCode(r.byOrigin.get(origin)![0], s);

  it('the one that inherits the code node has it', () => {
    expect(of('E1')).toBe('01.01');
  });
  it('the written value counts as a code', () => {
    expect(of('E2')).toBe('01.02');
  });
  it('with nothing there is no code', () => {
    expect(of('E3')).toBeNull();
  });
});
