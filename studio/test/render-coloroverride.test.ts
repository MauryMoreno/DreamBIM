import { describe, expect, it } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { ColorOverride, effectiveMaterialCode } from '../src/render/coloroverride';

const node = (attributes: Record<string, unknown>): ComposedNode => ({
  path: '/p', name: 'p', origin: 'p', attributes, children: [], parent: null,
});

describe('ColorOverride', () => {
  it('without a function it colors nothing', () => {
    const o = new ColorOverride();
    expect(o.active).toBe(false);
    expect(o.materialFor('/a')).toBeNull();
  });

  it('it gives the color of the element and null when the function does not color it', () => {
    const o = new ColorOverride();
    o.set((p) => (p === '/a' ? { color: '#ff0000', opacity: 1 } : null));
    expect(o.materialFor('/a')!.color.getHexString()).toBe('ff0000');
    expect(o.materialFor('/b')).toBeNull();
    expect(o.materialFor(null)).toBeNull();
  });

  it('opacidad menor que 1: transparente y sin depthWrite', () => {
    const o = new ColorOverride();
    o.set(() => ({ color: '#b0b0b0', opacity: 0.35 }));
    const m = o.materialFor('/a')!;
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0.35);
    expect(m.depthWrite).toBe(false);
  });

  it('el mismo color y opacidad dan el mismo objeto', () => {
    const o = new ColorOverride();
    o.set(() => ({ color: '#00ff00', opacity: 1 }));
    expect(o.materialFor('/a')).toBe(o.materialFor('/b'));
    expect(o.all()).toHaveLength(1);
  });

  it('set(null) lo apaga y clearCache libera los materiales', () => {
    const o = new ColorOverride();
    o.set(() => ({ color: '#00ff00', opacity: 1 }));
    o.materialFor('/a');
    o.set(null);
    expect(o.materialFor('/a')).toBeNull();
    o.clearCache();
    expect(o.all()).toHaveLength(0);
  });
});

describe('effectiveMaterialCode', () => {
  const M = 'bsi::ifc::material';
  it('el material del elemento manda sobre el de la malla', () => {
    expect(effectiveMaterialCode(node({ [M]: { code: 'C30' } }), node({ [M]: { code: 'X' } }))).toBe('C30');
  });
  it('sin material en el elemento, usa el de la malla', () => {
    expect(effectiveMaterialCode(node({}), node({ [M]: { code: 'X' } }))).toBe('X');
  });
  it('sin ninguno da null', () => {
    expect(effectiveMaterialCode(node({}), node({}))).toBeNull();
    expect(effectiveMaterialCode(undefined, undefined)).toBeNull();
  });
});

describe('ColorOverride: capa superior del Asistente', () => {
  it('the top layer wins over the function and with none there is no override', () => {
    const o = new ColorOverride();
    o.set(() => ({ color: '#00ff00', opacity: 1 }));
    o.setTop(new Map([['/a', { color: '#ff0000', opacity: 1 }]]));
    expect(o.active).toBe(true);
    expect(o.materialFor('/a')!.color.getHexString()).toBe('ff0000');
    expect(o.materialFor('/b')!.color.getHexString()).toBe('00ff00');
    o.set(null);
    expect(o.materialFor('/b')).toBeNull();
    expect(o.active).toBe(true);
    o.setTop(null);
    expect(o.active).toBe(false);
  });
});

describe('ColorOverride: colores guardados', () => {
  it('they stay below the modes and the Assistant, and a null from the mode falls to them', () => {
    const o = new ColorOverride();
    o.setSaved(new Map([['/a', { color: '#0000ff', opacity: 1 }], ['/b', { color: '#0000ff', opacity: 1 }]]));
    expect(o.active).toBe(true);
    expect(o.materialFor('/a')!.color.getHexString()).toBe('0000ff');
    o.set((p) => (p === '/a' ? { color: '#00ff00', opacity: 1 } : null));
    expect(o.materialFor('/a')!.color.getHexString()).toBe('00ff00'); // el modo gana
    expect(o.materialFor('/b')!.color.getHexString()).toBe('0000ff'); // el modo no lo colorea: cae al guardado
    o.setTop(new Map([['/a', { color: '#ff0000', opacity: 1 }]]));
    expect(o.materialFor('/a')!.color.getHexString()).toBe('ff0000');
    o.set(null); o.setTop(null); o.setSaved(null);
    expect(o.active).toBe(false);
    expect(o.materialFor('/b')).toBeNull();
  });
});
