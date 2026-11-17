import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneBatches } from '../src/render/batches';
import { Highlights } from '../src/render/highlight';

// Copia de isShown del visor: capa 0 activa y toda la cadena de ancestros visible.
function isShown(o: THREE.Object3D) {
  if (!o.layers.isEnabled(0)) return false;
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (!c.visible) return false;
  return true;
}

/** N meshes, each with its own geometry (same format and material: a single batch). */
function model(n: number) {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1 + i, 1, 1), material);
    m.position.set(i * 3, 0, 0);
    root.add(m);
    meshes.push(m);
  }
  root.updateMatrixWorld(true);
  return { root, meshes };
}

/** Reserved geometry memory and live geometries of all the batches. */
function footprint(b: SceneBatches) {
  let vertices = 0;
  let geometries = 0;
  for (const c of b.root.children) {
    const bm = c as THREE.BatchedMesh & { _maxVertexCount: number; _geometryInfo: { active: boolean }[] };
    vertices += bm._maxVertexCount;
    geometries += bm._geometryInfo.filter((g) => g.active).length;
  }
  return { batches: b.root.children.length, vertices, geometries };
}

function visibleInBatch(b: SceneBatches, m: THREE.Mesh) {
  const r = b.batchOf(m)!;
  return r.batch.getVisibleAt(r.instanceId);
}

describe('Highlights', () => {
  it('passing the highlight through N distinct geometries does not make the batches grow; when removed the instance comes back', () => {
    const { meshes } = model(40);
    const hoverMat = new THREE.MeshStandardMaterial({ color: 0x7fb3ff });
    const hl = new Highlights();
    const b = new SceneBatches();
    b.rebuild(meshes, (m) => isShown(m) && !hl.has(m));
    const before = footprint(b);
    expect(before.geometries).toBe(40);

    let prev: THREE.Mesh | null = null;
    for (const m of meshes) {
      // like the viewer hover: the previous one loses the highlight and the new one gains it
      const touched = prev ? [prev, m] : [m];
      if (prev) hl.set(prev, null);
      hl.set(m, hoverMat);
      b.sync(touched);
      hl.sync(isShown, touched);
      expect(footprint(b)).toEqual(before);
      expect(hl.size).toBe(1);
      expect(hl.root.children.length).toBe(1);
      expect(visibleInBatch(b, m)).toBe(false); // lo dibuja la copia resaltada
      if (prev) expect(visibleInBatch(b, prev)).toBe(true);
      const copy = hl.root.children[0] as THREE.Mesh;
      expect(copy.geometry).toBe(m.geometry); // it shares the geometry, it does not copy it
      expect(copy.material).toBe(hoverMat);
      expect(copy.matrix.equals(m.matrixWorld)).toBe(true);
      prev = m;
    }

    hl.set(prev!, null);
    b.sync([prev!]);
    expect(hl.size).toBe(0);
    expect(hl.root.children.length).toBe(0);
    expect(meshes.every((m) => visibleInBatch(b, m))).toBe(true);
    expect(footprint(b)).toEqual(before);
    expect(b.drawCalls).toBe(1);
  });

  it('cambiar de material de resaltado reutiliza la copia; las sombras siguen al material', () => {
    const { meshes } = model(1);
    const hl = new Highlights();
    const select = new THREE.MeshStandardMaterial();
    const ghost = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.2 });
    expect(hl.set(meshes[0], select)).toBe(true);
    const copy = hl.root.children[0] as THREE.Mesh;
    expect(copy.castShadow).toBe(true);
    expect(hl.set(meshes[0], select)).toBe(false);
    expect(hl.set(meshes[0], ghost)).toBe(true);
    expect(hl.root.children[0]).toBe(copy);
    expect(copy.castShadow).toBe(false);
    expect(hl.set(meshes[0], null)).toBe(true);
    expect(hl.set(meshes[0], null)).toBe(false);
  });

  it('las copias siguen la visibilidad y la matriz de mundo de la malla', () => {
    const { root, meshes } = model(2);
    const hl = new Highlights();
    hl.set(meshes[1], new THREE.MeshStandardMaterial());
    root.visible = false;
    meshes[1].position.set(10, 5, 0);
    root.updateMatrixWorld(true);
    hl.sync(isShown);
    const copy = hl.root.children[0] as THREE.Mesh;
    expect(copy.visible).toBe(false);
    expect(new THREE.Vector3().setFromMatrixPosition(copy.matrix).toArray()).toEqual([10, 5, 0]);
    hl.clear();
    expect(hl.size).toBe(0);
    expect(hl.root.children.length).toBe(0);
  });
});
