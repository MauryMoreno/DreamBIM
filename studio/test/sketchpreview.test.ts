import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSketchPreview } from '../src/workspace/sketchpreview';
import type { SketchLine } from '../src/modeling/sketch';

const host = () => ({ scene: new THREE.Scene(), requestRender: vi.fn() });
const line = (id: string, a: [number, number], b: [number, number]): SketchLine => ({ id, a, b, source: 'line' });
const named = (s: THREE.Scene, name: string) => s.children.find((c) => c.name === name) as THREE.LineSegments | undefined;
const color = (o: THREE.LineSegments) => (o.material as THREE.LineBasicMaterial).color.getHex();
const positions = (o: THREE.LineSegments) => Array.from(o.geometry.getAttribute('position').array);

const MAGENTA = 0xd600d6;
const HOT = 0x1a73e8;

afterEach(() => vi.restoreAllMocks());

describe('createSketchPreview', () => {
  it('setLines draws the lines in magenta, at z + 0.02 and on top of everything', () => {
    const h = host();
    createSketchPreview(h).setLines([line('a', [0, 0], [4, 0]), line('b', [4, 0], [4, 3])], 1);
    const o = named(h.scene, 'sketch-lines')!;
    expect(color(o)).toBe(MAGENTA);
    positions(o).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1.02, 4, 0, 1.02, 4, 0, 1.02, 4, 3, 1.02][i], 5));
    const m = o.material as THREE.LineBasicMaterial;
    expect(m.depthTest).toBe(false);
    expect(o.renderOrder).toBeGreaterThan(10); // over the wall preview
  });

  it('the selected line and the loose ones come out in another color', () => {
    const h = host();
    createSketchPreview(h).setLines(
      [line('a', [0, 0], [4, 0]), line('b', [4, 0], [4, 3]), line('c', [0, 3], [1, 3])],
      0,
      { selected: 'a', open: ['c'] },
    );
    expect(positions(named(h.scene, 'sketch-lines')!)).toHaveLength(6); // solo b
    const hot = named(h.scene, 'sketch-hot')!;
    expect(color(hot)).toBe(HOT);
    expect(positions(hot)).toHaveLength(12); // a y c
  });

  it('setRubber draws the rubber band and with an empty list removes it', () => {
    const h = host();
    const p = createSketchPreview(h);
    p.setRubber([[[0, 0], [2, 0]], [[2, 0], [2, 1]]], 0);
    expect(positions(named(h.scene, 'sketch-rubber')!)).toHaveLength(12);
    p.setRubber([], 0);
    expect(named(h.scene, 'sketch-rubber')).toBeUndefined();
  });

  it('setLines with an empty list leaves the scene clean', () => {
    const h = host();
    const p = createSketchPreview(h);
    p.setLines([line('a', [0, 0], [4, 0])], 0);
    p.setLines([], 0);
    expect(h.scene.children).toHaveLength(0);
  });

  it('clear leaves the scene as it was and releases geometries and materials', () => {
    const h = host();
    const geo = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const mat = vi.spyOn(THREE.LineBasicMaterial.prototype, 'dispose');
    const p = createSketchPreview(h);
    p.setLines([line('a', [0, 0], [4, 0]), line('b', [4, 0], [4, 3])], 0, { selected: 'a' });
    p.setRubber([[[0, 0], [1, 1]]], 0);
    p.clear();
    expect(h.scene.children).toHaveLength(0);
    expect(geo).toHaveBeenCalledTimes(3);
    expect(mat).toHaveBeenCalledTimes(3);
  });

  it('cada cambio pide un render', () => {
    const h = host();
    const p = createSketchPreview(h);
    p.setLines([line('a', [0, 0], [4, 0])], 0);
    p.setRubber([[[0, 0], [1, 1]]], 0);
    p.clear();
    expect(h.requestRender).toHaveBeenCalledTimes(3);
  });

  it('actualizar reutiliza el objeto en vez de crear otro', () => {
    const h = host();
    const p = createSketchPreview(h);
    p.setLines([line('a', [0, 0], [4, 0])], 0);
    p.setLines([line('a', [0, 0], [5, 0])], 0);
    expect(h.scene.children.filter((c) => c.name === 'sketch-lines')).toHaveLength(1);
  });
});
