// Material preview: the part that does not need WebGL (shapes and parameters of the material).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PREVIEW_SHAPES, previewGeometry, previewMaterialParams, previewTextureRepeat, webglAvailable } from '../src/render/materialpreview';

describe('previewGeometry', () => {
  it('each shape has its geometry', () => {
    expect(PREVIEW_SHAPES).toEqual(['sphere', 'plane', 'cube']);
    expect(previewGeometry('sphere')).toBeInstanceOf(THREE.SphereGeometry);
    expect(previewGeometry('plane')).toBeInstanceOf(THREE.PlaneGeometry);
    expect(previewGeometry('cube')).toBeInstanceOf(THREE.BoxGeometry);
  });
});

describe('previewMaterialParams', () => {
  it('el color hexadecimal es sRGB: el rojo puro conserva su canal rojo al verlo en pantalla', () => {
    const p = previewMaterialParams({ color: '#ff0000', opacity: 1 });
    expect((p.color as THREE.Color).getHexString(THREE.SRGBColorSpace)).toBe('ff0000');
  });

  it('opaco no es transparente y escribe profundidad', () => {
    const p = previewMaterialParams({ color: '#8a8a8a', opacity: 1 });
    expect(p).toMatchObject({ opacity: 1, transparent: false, depthWrite: true });
  });

  it('with opacity below 1 it is transparent and does not hide what is behind', () => {
    const p = previewMaterialParams({ color: '#9ec9e8', opacity: 0.4 });
    expect(p).toMatchObject({ opacity: 0.4, transparent: true, depthWrite: false });
  });

  it('it is matte, like the viewer material, and is seen from both faces (the plane too)', () => {
    const p = previewMaterialParams({ color: '#8a8a8a', opacity: 1 });
    expect(p).toMatchObject({ metalness: 0, side: THREE.DoubleSide });
    expect(p.roughness).toBeGreaterThan(0.5);
  });
});

describe('webglAvailable', () => {
  it('sin WebGL (el entorno de pruebas) devuelve false sin lanzar', () => {
    expect(webglAvailable()).toBe(false);
  });
});

describe('previewTextureRepeat', () => {
  it('the shape of the preview measures about 2 m: the image repeats 2 / size times', () => {
    expect(previewTextureRepeat({ image: 'x', width: 2, height: 4 })).toEqual([1, 0.5]);
    expect(previewTextureRepeat({ image: 'x', width: 0.5, height: 1 })).toEqual([4, 2]);
  });
});
