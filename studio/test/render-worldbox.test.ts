import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyNodeVisibility } from '../src/render/visibility';
import { shownBox, worldBox } from '../src/render/worldbox';

const near = (got: number[], want: number[]) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));

describe('worldBox', () => {
  it('caja 2 x 3 x 4 trasladada a (10, 0, 0)', () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    m.position.set(10, 0, 0);
    m.updateMatrixWorld(true);
    near(worldBox(m), [9, -1.5, -2, 11, 1.5, 2]);
  });

  it('girada 90° en Z intercambia X e Y', () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    m.rotation.z = Math.PI / 2;
    m.updateMatrixWorld(true);
    near(worldBox(m), [-1.5, -1, -2, 1.5, 1, 2]);
  });

  it('it computes the box of the geometry if it was missing and does not change it', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    expect(g.boundingBox).toBeNull();
    const m = new THREE.Mesh(g);
    m.updateMatrixWorld(true);
    worldBox(m);
    expect(g.boundingBox).not.toBeNull();
    near([g.boundingBox!.max.x, g.boundingBox!.max.y, g.boundingBox!.max.z], [0.5, 0.5, 0.5]);
  });
});

describe('shownBox', () => {
  const drawable = (x: number, cls: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    m.position.set(x, 0, 0);
    m.userData = { cls, baseMaterial: m.material };
    return m;
  };

  it('leaves out what is hidden by class or by an ancestor', () => {
    const root = new THREE.Group();
    const wall = drawable(0, 'IfcWall');
    const grid = drawable(100, 'IfcGrid');
    const hiddenStorey = new THREE.Group();
    hiddenStorey.add(drawable(-100, 'IfcWall'));
    hiddenStorey.visible = false;
    root.add(wall, grid, hiddenStorey);
    applyNodeVisibility(grid, true, new Set(['IfcGrid']));
    root.updateMatrixWorld(true);
    const b = shownBox(root);
    expect(b.min.x).toBeCloseTo(-0.5);
    expect(b.max.x).toBeCloseTo(0.5);
  });

  it('is empty when nothing is shown', () => {
    expect(shownBox(new THREE.Group()).isEmpty()).toBe(true);
  });
});
