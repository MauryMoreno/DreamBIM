import { describe, expect, it } from 'vitest';
import { checkDef, defChanges, OVERRIDABLE_KEYS } from '../src/materials/overs';
import { defToAttrs, K_GLTF, K_OPACITY } from '../src/materials/nodes';
import type { MaterialDef } from '../src/materials/state';

const IMG = 'data:image/jpeg;base64,AAAA';
const plain: MaterialDef = { name: 'Brick', code: 'Brick', color: '#aa5533', opacity: 1 };
const tex = (over: Partial<NonNullable<MaterialDef['texture']>> = {}) => ({ image: IMG, width: 1, height: 1, ...over });

describe('defChanges con textura', () => {
  it('gltf::material is one of the keys the model can override', () => {
    expect(OVERRIDABLE_KEYS).toContain(K_GLTF);
  });

  it('ponerle una textura escribe el gltf completo', () => {
    const next = { ...plain, texture: tex() };
    expect(defChanges(plain, next)).toEqual({ [K_GLTF]: defToAttrs(next)[K_GLTF] });
  });

  it('quitarla borra gltf::material (null)', () => {
    expect(defChanges({ ...plain, texture: tex() }, plain)).toEqual({ [K_GLTF]: null });
  });

  it('changing the size or the image rewrites the gltf', () => {
    const from = { ...plain, texture: tex() };
    expect(defChanges(from, { ...from, texture: tex({ width: 2 }) })).toEqual({ [K_GLTF]: defToAttrs({ ...from, texture: tex({ width: 2 }) })[K_GLTF] });
    expect(Object.keys(defChanges(from, { ...from, texture: tex({ image: 'data:image/jpeg;base64,BBBB' }) }))).toEqual([K_GLTF]);
  });

  it('with a texture, changing the opacity also rewrites the gltf (it carries the alpha)', () => {
    const from = { ...plain, texture: tex() };
    const to = { ...from, opacity: 0.5 };
    expect(defChanges(from, to)).toEqual({ [K_OPACITY]: 0.5, [K_GLTF]: defToAttrs(to)[K_GLTF] });
  });

  it('sin textura, cambiar la opacidad no toca gltf::material', () => {
    expect(defChanges(plain, { ...plain, opacity: 0.5 })).toEqual({ [K_OPACITY]: 0.5 });
  });

  it('if the texture did not change, the gltf (which may bring more things Studio does not edit) is not touched', () => {
    const from = { ...plain, texture: tex() };
    expect(defChanges(from, { ...from, color: '#000000' })).not.toHaveProperty(K_GLTF);
  });
});

describe('checkDef con textura', () => {
  it('it rejects a size that is not a positive number', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(checkDef({ ...plain, texture: tex({ width: bad }) })).toBe('The texture size must be a positive number of meters');
      expect(checkDef({ ...plain, texture: tex({ height: bad }) })).toBe('The texture size must be a positive number of meters');
    }
    expect(checkDef({ ...plain, texture: tex({ width: 0.3, height: 12 }) })).toBeNull();
  });
});
