// Drawing batches: group the meshes of the logical tree into THREE.BatchedMesh by material, geometry
// format and castShadow, to go from one draw call per mesh to one per batch. The source meshes are still
// the model (selection, rays, properties); the batches only copy them for drawing.
//
// Notes on BatchedMesh (three r171):
// - the first addGeometry fixes the attributes and whether there is an index: every geometry in a batch
//   must share them (hence layoutOf in the key). Non-indexed ones work (drawing by vertex range).
// - setInstanceCount / setGeometrySize do grow the batch keeping matrices, visibility and geometries.
// - deleteInstance frees the id and addInstance reuses it; the added geometry is not released.
// - the batch bounding sphere is computed once and cached: it must be invalidated when instances move.
// - dispose frees the batch's own geometry and textures, not the material (which is the source one).
// Instance matrices are the meshes' matrixWorld, so root must stay at the origin.
//
// Level of detail: setDrawGeometries gives, per mesh, the geometry drawn in its place. The source mesh
// keeps its own (rays, measurement, edges); only what the batch copies changes.

import * as THREE from 'three';
import { maxIndexCount, maxVertexCount } from './batched-mesh-internals';

/** Sorted attribute names plus '|i' (indexed) or '|n' (not indexed). */
export function layoutOf(g: THREE.BufferGeometry): string {
  return `${Object.keys(g.attributes).sort().join(',')}|${g.getIndex() ? 'i' : 'n'}`;
}

interface Batch {
  key: string;
  mesh: THREE.BatchedMesh;
  geometryIds: Map<THREE.BufferGeometry, number>;
  visibleCount: number;
}

interface Entry {
  key: string;
  instanceId: number;
  /** Visible in the batch (the last value read from isDrawn). */
  shown: boolean;
}

/** Batch key of a mesh, or null when it cannot be grouped (multi-material or no positions). */
function keyOf(m: THREE.Mesh, g: THREE.BufferGeometry): string | null {
  const mat = m.material;
  if (Array.isArray(mat) || !g.getAttribute('position')) return null;
  return `${mat.id}|${layoutOf(g)}|${m.castShadow ? 1 : 0}`;
}

function vertexCount(g: THREE.BufferGeometry) {
  return g.getAttribute('position').count;
}

function indexCount(g: THREE.BufferGeometry) {
  return g.getIndex()?.count ?? 0;
}

export class SceneBatches {
  readonly root = new THREE.Group();
  private batches = new Map<string, Batch>();
  private entries = new Map<THREE.Mesh, Entry>();
  private meshes: readonly THREE.Mesh[] = [];
  private members = new Set<THREE.Mesh>();
  private isDrawn: (m: THREE.Mesh) => boolean = () => true;
  private drawGeometries: ReadonlyMap<THREE.Mesh, THREE.BufferGeometry> = new Map();

  constructor() {
    this.root.name = 'batches';
  }

  /**
   * Geometry drawn in place of each mesh's own (its level of detail); those not in the map draw their
   * own. Applies from the next rebuild; dispose forgets them.
   */
  setDrawGeometries(map: ReadonlyMap<THREE.Mesh, THREE.BufferGeometry>): void {
    this.drawGeometries = map;
  }

  private geometryOf(m: THREE.Mesh): THREE.BufferGeometry {
    return this.drawGeometries.get(m) ?? m.geometry;
  }

  /** Builds the batches from scratch, reserving per key just what its instances and geometries need. */
  rebuild(meshes: readonly THREE.Mesh[], isDrawn: (m: THREE.Mesh) => boolean): void {
    this.clear();
    this.meshes = meshes;
    this.members = new Set(meshes);
    this.isDrawn = isDrawn;

    const groups = new Map<string, THREE.Mesh[]>();
    for (const m of meshes) {
      const key = keyOf(m, this.geometryOf(m));
      if (key === null) continue;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(m);
    }

    for (const [key, list] of groups) {
      const geoms = new Set<THREE.BufferGeometry>();
      let vertices = 0;
      let indices = 0;
      for (const m of list) {
        const g = this.geometryOf(m);
        if (geoms.has(g)) continue;
        geoms.add(g);
        vertices += vertexCount(g);
        indices += indexCount(g);
      }
      const b = this.createBatch(key, list[0], list.length, vertices, indices);
      for (const m of list) this.place(b, m);
    }
    // place already set each instance's visibility and each batch's count
    for (const b of this.batches.values()) b.mesh.visible = b.visibleCount > 0;
  }

  /**
   * Rereads material, castShadow, visibility and matrix of every mesh in the last rebuild. With `only`,
   * it rereads only those meshes' material, castShadow and visibility (the ones that change on hover or
   * selection, for instance) and invalidates only the bounds of batches gaining or losing instances;
   * meshes that were not in the last rebuild are ignored.
   */
  sync(only?: Iterable<THREE.Mesh>): void {
    const list = only ? [...only].filter((m) => this.members.has(m)) : this.meshes;
    const changed: { mesh: THREE.Mesh; key: string | null }[] = [];
    for (const m of list) {
      const key = keyOf(m, this.geometryOf(m));
      if (key !== (this.entries.get(m)?.key ?? null)) changed.push({ mesh: m, key });
    }
    // A style change (x-ray, colour by class) moves almost everything: rebuilding is cheaper.
    if (changed.length > this.meshes.length / 2) {
      this.rebuild(this.meshes, this.isDrawn);
      return;
    }

    const touched = new Set<Batch>();
    for (const { mesh, key } of changed) {
      const old = this.entries.get(mesh);
      if (old) {
        const ob = this.batches.get(old.key)!;
        ob.mesh.deleteInstance(old.instanceId);
        if (old.shown) ob.visibleCount--;
        touched.add(ob);
        this.entries.delete(mesh);
      }
      if (key === null) continue;
      let b = this.batches.get(key);
      const g = this.geometryOf(mesh);
      if (!b) b = this.createBatch(key, mesh, 1, vertexCount(g), indexCount(g));
      this.place(b, mesh);
      touched.add(b);
    }

    if (!only) {
      for (const m of this.meshes) {
        const e = this.entries.get(m);
        if (!e) continue;
        const bm = this.batches.get(e.key)!.mesh;
        bm.setMatrixAt(e.instanceId, m.matrixWorld);
      }
      for (const b of this.batches.values()) touched.add(b);
    }
    for (const b of touched) {
      b.mesh.sortObjects = (b.mesh.material as THREE.Material).transparent;
      this.invalidateBounds(b.mesh);
    }
    if (!only) {
      this.refreshVisibility();
      return;
    }
    for (const m of list) {
      const e = this.entries.get(m);
      if (!e) continue;
      const shown = this.isDrawn(m);
      if (shown === e.shown) continue;
      const b = this.batches.get(e.key)!;
      b.mesh.setVisibleAt(e.instanceId, shown);
      b.visibleCount += shown ? 1 : -1;
      e.shown = shown;
    }
    for (const b of this.batches.values()) b.mesh.visible = b.visibleCount > 0;
  }

  /** Only copies the world matrices of the given meshes (when moving an element, for instance). */
  syncTransforms(meshes: Iterable<THREE.Mesh>): void {
    const touched = new Set<THREE.BatchedMesh>();
    for (const m of meshes) {
      const e = this.entries.get(m);
      if (!e) continue;
      const bm = this.batches.get(e.key)!.mesh;
      bm.setMatrixAt(e.instanceId, m.matrixWorld);
      touched.add(bm);
    }
    for (const bm of touched) this.invalidateBounds(bm);
  }

  /** Batches with at least one visible instance (draw calls, not counting shadows). */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.visibleCount > 0) n++;
    return n;
  }

  batchOf(m: THREE.Mesh): { batch: THREE.BatchedMesh; instanceId: number } | null {
    const e = this.entries.get(m);
    return e ? { batch: this.batches.get(e.key)!.mesh, instanceId: e.instanceId } : null;
  }

  /** Frees the batches and their geometries; the source geometries and materials are not touched. */
  dispose(): void {
    this.clear();
    this.meshes = [];
    this.members = new Set();
    this.drawGeometries = new Map();
  }

  private clear() {
    for (const b of this.batches.values()) {
      this.root.remove(b.mesh);
      b.mesh.dispose();
    }
    this.batches.clear();
    this.entries.clear();
  }

  private createBatch(key: string, sample: THREE.Mesh, instances: number, vertices: number, indices: number): Batch {
    const material = sample.material as THREE.Material;
    const mesh = new THREE.BatchedMesh(instances, vertices, indices, material);
    mesh.name = key;
    mesh.castShadow = sample.castShadow;
    mesh.receiveShadow = true;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = material.transparent;
    const b: Batch = { key, mesh, geometryIds: new Map(), visibleCount: 0 };
    this.batches.set(key, b);
    this.root.add(mesh);
    return b;
  }

  /** Adds the mesh as an instance of the batch (and its geometry if missing), growing if it does not fit. */
  private place(b: Batch, m: THREE.Mesh) {
    const bm = b.mesh;
    const g = this.geometryOf(m);
    let geometryId = b.geometryIds.get(g);
    if (geometryId === undefined) {
      const v = vertexCount(g);
      const i = indexCount(g);
      if (bm.unusedVertexCount < v || bm.unusedIndexCount < i) {
        const maxV = bm.unusedVertexCount < v ? Math.max(2 * maxVertexCount(bm), maxVertexCount(bm) + v) : maxVertexCount(bm);
        const maxI = bm.unusedIndexCount < i ? Math.max(2 * maxIndexCount(bm), maxIndexCount(bm) + i) : maxIndexCount(bm);
        bm.setGeometrySize(maxV, maxI);
      }
      geometryId = bm.addGeometry(g);
      b.geometryIds.set(g, geometryId);
    }
    if (bm.instanceCount >= bm.maxInstanceCount) bm.setInstanceCount(Math.max(2 * bm.maxInstanceCount, bm.maxInstanceCount + 1));
    const instanceId = bm.addInstance(geometryId);
    bm.setMatrixAt(instanceId, m.matrixWorld);
    const shown = this.isDrawn(m);
    bm.setVisibleAt(instanceId, shown);
    if (shown) b.visibleCount++;
    this.entries.set(m, { key: b.key, instanceId, shown });
  }

  private refreshVisibility() {
    for (const b of this.batches.values()) b.visibleCount = 0;
    for (const m of this.meshes) {
      const e = this.entries.get(m);
      if (!e) continue;
      const b = this.batches.get(e.key)!;
      const shown = this.isDrawn(m);
      b.mesh.setVisibleAt(e.instanceId, shown);
      e.shown = shown;
      if (shown) b.visibleCount++;
    }
    for (const b of this.batches.values()) b.mesh.visible = b.visibleCount > 0;
  }

  private invalidateBounds(bm: THREE.BatchedMesh) {
    bm.boundingBox = null;
    bm.boundingSphere = null;
  }
}

