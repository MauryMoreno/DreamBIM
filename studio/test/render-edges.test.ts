import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { edgeMeshes, edgesOf, mergeEdges, sameMeshes } from '../src/render/edges';

describe('aristas', () => {
  it('edgesOf computes once per geometry', () => {
    const g = new THREE.BoxGeometry();
    expect(edgesOf(g)).toBe(edgesOf(g));
    expect(edgesOf(new THREE.BoxGeometry())).not.toBe(edgesOf(g));
  });

  it('mergeEdges suma las aristas de todas las mallas en coordenadas de mundo', () => {
    const g = new THREE.BoxGeometry(1, 1, 1); // 12 edges = 24 vertices
    const a = new THREE.Mesh(g);
    const b = new THREE.Mesh(g);
    b.position.set(10, 0, 0);
    a.updateMatrixWorld();
    b.updateMatrixWorld();
    const m = mergeEdges([a, b]);
    const pos = m.getAttribute('position');
    expect(pos.count).toBe(48);
    expect(pos.array).toBeInstanceOf(Float32Array);
    let maxX = -Infinity;
    let minX = Infinity;
    for (let i = 0; i < pos.count; i++) {
      maxX = Math.max(maxX, pos.getX(i));
      minX = Math.min(minX, pos.getX(i));
    }
    expect(maxX).toBeCloseTo(10.5);
    expect(minX).toBeCloseTo(-0.5);
  });

  it('without meshes it returns an empty geometry', () => {
    const m = mergeEdges([]);
    expect(m.getAttribute('position').count).toBe(0);
  });
});

describe('edgeMeshes', () => {
  const mesh = (name: string) => Object.assign(new THREE.Mesh(new THREE.BoxGeometry()), { name });
  const names = (ms: THREE.Mesh[]) => ms.map((m) => m.name);

  it('with the edges style: all the shown meshes that are not a dimmed level', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(mesh);
    const line = new THREE.Line(new THREE.BufferGeometry());
    const out = edgeMeshes([a, b, line, c, d], {
      styleEdges: true,
      isCut: () => false,
      isUnderlay: (o) => o === b,
      isShown: (o) => o !== c,
    });
    expect(names(out)).toEqual(['a', 'd']); // ni el atenuado, ni el oculto, ni curvas
  });

  it('without style edges: only the cut ones (walls of the plan), if shown and not dimmed', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mesh);
    const out = edgeMeshes([a, b, c], {
      styleEdges: false,
      isCut: (o) => o !== a,
      isUnderlay: () => false,
      isShown: (o) => o !== c,
    });
    expect(names(out)).toEqual(['b']);
  });
});

describe('sameMeshes', () => {
  it('mismas mallas en el mismo orden', () => {
    const [a, b] = [new THREE.Mesh(), new THREE.Mesh()];
    expect(sameMeshes([a, b], [a, b])).toBe(true);
    expect(sameMeshes([], [])).toBe(true);
    expect(sameMeshes([a, b], [b, a])).toBe(false);
    expect(sameMeshes([a], [a, b])).toBe(false);
  });
});
