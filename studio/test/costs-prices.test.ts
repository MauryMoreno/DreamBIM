import { describe, expect, it } from 'vitest';
import { apuPrice, pricesFromFile } from '../src/costs/prices';

describe('unit price analysis (APU)', () => {
  const head = { id: 'apu', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' };
  const file = (cementPrice: number) => ({
    header: head,
    imports: [],
    schemas: {},
    data: [
      { path: 'ins-cem', attributes: { 'prj::apu::insumo': { codigo: 'MAT-CEM', descripcion: 'Cemento', unidad: 'saco', tipo: 'material', precio: cementPrice } } },
      { path: 'ins-ofi', attributes: { 'prj::apu::insumo': { codigo: 'MO-OF', descripcion: 'Oficial', unidad: 'h', tipo: 'mano de obra', precio: 5 } } },
      {
        path: 'apu-1',
        attributes: {
          'studio::cost::price': { code: 'HA-1', description: 'Hormigón', unit: 'm³', price: 0 },
          'prj::apu::detalle': { insumos: [{ ref: 'ins-cem', cantidad: 8 }, { ref: 'ins-ofi', cantidad: 2.5 }, { descripcion: 'Agua', unidad: 'm³', cantidad: 0.2, precio: 2 }] },
        },
      },
    ],
  });

  it('el precio es la suma de cantidad × precio de sus insumos, referenciados o escritos', () => {
    const [p] = pricesFromFile(file(10));
    expect(p.price).toBe(8 * 10 + 2.5 * 5 + 0.2 * 2);
    expect(p.breakdown!.map((l) => [l.codigo, l.descripcion, l.tipo, l.cantidad, l.precio])).toEqual([
      ['MAT-CEM', 'Cemento', 'material', 8, 10],
      ['MO-OF', 'Oficial', 'mano de obra', 2.5, 5],
      ['', 'Agua', '', 0.2, 2],
    ]);
  });

  it('changing an input changes the price of the APU that uses it', () => {
    expect(pricesFromFile(file(12))[0].price).toBe(8 * 12 + 2.5 * 5 + 0.2 * 2);
  });

  it('if a line lacks the price, the written price applies', () => {
    const f = file(10);
    (f.data[2].attributes['prj::apu::detalle'] as { insumos: unknown[] }).insumos.push({ ref: 'no-existe', cantidad: 1 });
    (f.data[2].attributes['studio::cost::price'] as { price: number }).price = 99;
    expect(pricesFromFile(f)[0].price).toBe(99);
  });

  it('the piles APU that already existed still gives 207.58', () => {
    const pile = {
      header: head, imports: [], schemas: {},
      data: [{
        path: 'p', attributes: {
          'studio::cost::price': { code: 'PIL-PRE-762', description: 'Pilote', unit: 'm', price: 207.58 },
          'prj::apu::detalle': { insumos: [
            { tipo: 'material', ref: '3468fdec-1163-5d95-8eab-6826478c56f2', descripcion: 'Hormigón', unidad: 'm³', cantidad: 0.456, precio: 180 },
            { tipo: 'material', ref: null, descripcion: 'Acero', unidad: 'kg', cantidad: 40, precio: 1.6 },
            { tipo: 'equipo', ref: null, descripcion: 'Perforadora', unidad: 'h', cantidad: 0.15, precio: 350 },
            { tipo: 'mano de obra', ref: null, descripcion: 'Cuadrilla', unidad: 'h', cantidad: 0.2, precio: 45 },
          ] },
        },
      }],
    };
    expect(pricesFromFile(pile)[0].price).toBe(207.58);
  });
});

describe('apuPrice', () => {
  const insumos: Record<string, Record<string, unknown>> = { a: { precio: 10 }, b: { precio: 0.333 } };
  const find = (path: string) => insumos[path] ?? null;
  const apu = (lines: unknown[]) => ({ 'prj::apu::detalle': { insumos: lines } });

  it('it adds quantity × price, with the inputs by ref or written, and rounds to 2 decimals', () => {
    expect(apuPrice(apu([{ ref: 'a', cantidad: 2 }, { ref: 'b', cantidad: 1 }, { cantidad: 3, precio: 1 }]), find)).toBe(23.33);
  });
  it('without inputs or with a line without a price there is no APU price', () => {
    expect(apuPrice({}, find)).toBeNull();
    expect(apuPrice(apu([]), find)).toBeNull();
    expect(apuPrice(apu([{ ref: 'a', cantidad: 1 }, { ref: 'nada', cantidad: 1 }]), find)).toBeNull();
  });
});
