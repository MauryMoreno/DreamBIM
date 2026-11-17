import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWallPreview } from '../src/workspace/wallpreview';

const host = () => ({ scene: new THREE.Scene(), requestRender: vi.fn() });
const positions = (g: THREE.Line) => Array.from(g.geometry.getAttribute('position').array);
const guides = (s: THREE.Scene) => s.children.filter((c) => c.name === 'wall-guide');

describe('createWallPreview: guide line', () => {
  it('showGuide draws a dashed line from the start, at double the segment and at z + 0.02', () => {
    const h = host();
    createWallPreview(h).showGuide([0, 0], [2, 0], 1);
    const [g] = guides(h.scene) as THREE.Line[];
    expect(g.material).toBeInstanceOf(THREE.LineDashedMaterial);
    positions(g).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1.02, 4, 0, 1.02][i], 5)); // Float32
  });

  it('una segunda llamada reutiliza el mismo objeto', () => {
    const h = host();
    const p = createWallPreview(h);
    p.showGuide([0, 0], [2, 0], 0);
    p.showGuide([0, 0], [0, 3], 0);
    expect(guides(h.scene)).toHaveLength(1);
    const [g] = guides(h.scene) as THREE.Line[];
    positions(g).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 0.02, 0, 6, 0.02][i], 5));
  });

  it('clearGuide la quita y clear() deja la escena sin hijos', () => {
    const h = host();
    const p = createWallPreview(h);
    p.showGuide([0, 0], [2, 0], 0);
    p.clearGuide();
    expect(guides(h.scene)).toHaveLength(0);
    p.show([0, 0], [2, 0], 0);
    p.showGuide([0, 0], [2, 0], 0);
    p.clear();
    expect(h.scene.children).toHaveLength(0);
  });

  it('a null segment leaves no guide', () => {
    const h = host();
    const p = createWallPreview(h);
    p.showGuide([0, 0], [2, 0], 0);
    p.showGuide([1, 1], [1, 1], 0);
    expect(guides(h.scene)).toHaveLength(0);
  });
});
