import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { measureGeometry, texturedGeometry } from '../src/render/geometry';

describe('measureGeometry', () => {
  it('2 x 3 x 4 box: 24 m³ and 52 m², wherever it is', () => {
    for (const offset of [[0, 0, 0], [100, -50, 7]]) {
      const g = new THREE.BoxGeometry(2, 3, 4).translate(offset[0], offset[1], offset[2]);
      const m = measureGeometry(g);
      expect(m.volume).toBeCloseTo(24, 6);
      expect(m.area).toBeCloseTo(52, 6);
    }
  });

  it('it gives the same with the UV variant (without indices)', () => {
    const g = new THREE.BoxGeometry(2, 3, 4);
    const m = measureGeometry(texturedGeometry(g));
    expect(m.volume).toBeCloseTo(24, 6);
    expect(m.area).toBeCloseTo(52, 6);
  });

  it('cilindro: se acerca a π r² h al refinar', () => {
    const m = measureGeometry(new THREE.CylinderGeometry(1, 1, 2, 256));
    expect(m.volume).toBeCloseTo(Math.PI * 2, 2);
  });
});
