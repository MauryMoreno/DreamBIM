import { describe, expect, it } from 'vitest';
import {
  COLORS_KIND, EMPTY_COLORS, K_DIFFUSE, K_OPACITY, hexToRgb, rgbToHex, type ColorsState,
} from '../src/colors/state';

const header = { id: 'x', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' };

describe('colores guardados', () => {
  it('hexToRgb y rgbToHex son inversas', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(rgbToHex([1, 128 / 255, 0])).toBe('#ff8000');
  });
  it('ida y vuelta por archivo conserva color y opacidad', () => {
    const s: ColorsState = { assign: { w1: { color: '#ff0000', opacity: 0.5 } } };
    expect(COLORS_KIND.fromFile(COLORS_KIND.toFile(s, 'casa'))).toEqual(s);
  });
  it('el overlay escribe diffuseColor y opacity en la ruta', () => {
    const f = COLORS_KIND.overlay!({ assign: { w1: { color: '#0000ff', opacity: 1 } } })!;
    expect(f.data).toEqual([{ path: 'w1', attributes: { [K_DIFFUSE]: [0, 0, 1], [K_OPACITY]: 1 } }]);
  });
  it('Parent with transformation `m` and a child `c` without xformop.', () => {
    expect(COLORS_KIND.overlay!(EMPTY_COLORS)).toBeNull();
    expect(COLORS_KIND.isEmpty(EMPTY_COLORS)).toBe(true);
  });
  it('a node with edited children does not disappear when its last attribute is removed', () => {
    const f = { header, imports: [], schemas: {}, data: [{ path: 'a', attributes: { [K_DIFFUSE]: 'rojo' } }, { path: 'b' }] };
    expect(COLORS_KIND.fromFile(f as any)).toEqual(EMPTY_COLORS);
  });
});
