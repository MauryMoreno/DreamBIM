import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { accelerate } from '../src/render/pickaccel';

/** Rotated and displaced box, with the world matrix already computed (like the logical meshes of the viewer). */
function box(geo: THREE.BufferGeometry = new THREE.BoxGeometry(2, 1, 3)): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  m.position.set(4, -2, 1);
  m.rotation.set(0.4, 0.7, 0.2);
  m.scale.set(1, 2, 1.5);
  m.updateMatrixWorld(true);
  return m;
}

function ray(origin: THREE.Vector3, target: THREE.Vector3): THREE.Raycaster {
  return new THREE.Raycaster(origin.clone(), target.clone().sub(origin).normalize());
}

describe('accelerate', () => {
  it('it gives the same hits (point, distance, object) as the three raycast', () => {
    const ref = box();
    const acc = box();
    accelerate(acc);
    const centro = new THREE.Vector3(4, -2, 1);
    const rayos = [
      ray(new THREE.Vector3(10, -2, 1), centro),
      ray(new THREE.Vector3(4, 9, 1), centro),
      ray(new THREE.Vector3(4.3, -2.2, 12), new THREE.Vector3(4.1, -1.9, 1)),
      ray(new THREE.Vector3(-5, -5, -5), centro),
      ray(new THREE.Vector3(10, 10, 10), new THREE.Vector3(10, 10, -10)), // no corta
    ];
    let conImpacto = 0;
    for (const r of rayos) {
      const a = r.intersectObject(ref, false);
      const b = r.intersectObject(acc, false);
      expect(b.length).toBe(a.length);
      if (a.length) conImpacto++;
      a.forEach((h, i) => {
        expect(b[i].distance).toBeCloseTo(h.distance, 5);
        expect(b[i].point.distanceTo(h.point)).toBeLessThan(1e-5);
        expect(b[i].object).toBe(acc);
        expect(b[i].face!.normal.distanceTo(h.face!.normal)).toBeLessThan(1e-5);
      });
    }
    expect(conImpacto).toBe(4);
  });

  it('it respects the visible face of the material (FrontSide does not see the back faces)', () => {
    const ref = box();
    const acc = box();
    accelerate(acc);
    // Origin inside the box: there are only back faces in the direction of the ray.
    const r = ray(new THREE.Vector3(4, -2, 1), new THREE.Vector3(9, -2, 1));
    expect(r.intersectObject(acc, false).length).toBe(r.intersectObject(ref, false).length);
    expect(r.intersectObject(acc, false).length).toBe(0);
  });

  it('no construye el BVH si el rayo no toca la esfera', () => {
    const mesh = box();
    accelerate(mesh);
    const r = ray(new THREE.Vector3(100, 100, 100), new THREE.Vector3(100, 100, -100));
    expect(r.intersectObject(mesh, false)).toHaveLength(0);
    expect(mesh.geometry.boundsTree).toBeUndefined();
  });

  it('it builds it once per shared geometry', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const a = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    const b = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    b.position.set(5, 0, 0);
    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);
    accelerate(a);
    accelerate(b);
    const ra = ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    expect(ra.intersectObject(a, false).length).toBeGreaterThan(0);
    const tree = geo.boundsTree;
    expect(tree).toBeDefined();
    const rb = ray(new THREE.Vector3(5, 0, 5), new THREE.Vector3(5, 0, 0));
    const hits = rb.intersectObject(b, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.x).toBeCloseTo(5, 5);
    expect(geo.boundsTree).toBe(tree);
  });

  it('it does not add an index to a non-indexed geometry', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    expect(geo.index).toBeNull();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    accelerate(mesh);
    const r = ray(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    const hits = r.intersectObject(mesh, false);
    expect(hits.length).toBeGreaterThan(0);
    expect(geo.boundsTree).toBeDefined();
    expect(geo.index).toBeNull();
  });
});
