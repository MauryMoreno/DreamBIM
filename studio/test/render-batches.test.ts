import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { layoutOf, SceneBatches } from '../src/render/batches';

// Copia de isShown del visor: capa 0 activa y toda la cadena de ancestros visible.
function isShown(o: THREE.Object3D) {
  if (!o.layers.isEnabled(0)) return false;
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (!c.visible) return false;
  return true;
}

function scene(n: number, geometry: THREE.BufferGeometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial()) {
  const root = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(i * 2, 0, 0);
    root.add(m);
    meshes.push(m);
  }
  root.updateMatrixWorld(true);
  return { root, meshes, geometry, material };
}

// The instance matrices live in a Float32 texture: equal except for float32 rounding.
function expectSameMatrix(a: THREE.Matrix4, b: THREE.Matrix4) {
  for (let i = 0; i < 16; i++) expect(a.elements[i]).toBeCloseTo(b.elements[i], 6);
}

function at(b: SceneBatches, m: THREE.Mesh) {
  const r = b.batchOf(m);
  if (!r) throw new Error('sin lote');
  return r;
}

describe('layoutOf', () => {
  it('sorted attribute names and whether it has an index', () => {
    const g = new THREE.BoxGeometry();
    expect(layoutOf(g)).toBe('normal,position,uv|i');
    expect(layoutOf(g.toNonIndexed())).toBe('normal,position,uv|n');
  });
});

describe('SceneBatches', () => {
  it('instances of the same geometry and material share a batch', () => {
    const { meshes } = scene(3);
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    expect(b.drawCalls).toBe(1);
    expect(b.root.children.length).toBe(1);
    const batch = at(b, meshes[0]).batch;
    expect(batch.instanceCount).toBe(3);
    const ids = meshes.map((m) => at(b, m));
    for (const r of ids) expect(r.batch).toBe(batch);
    expect(new Set(ids.map((r) => r.instanceId)).size).toBe(3);
    // the geometry is added once
    const geoIds = new Set(ids.map((r) => batch.getGeometryIdAt(r.instanceId)));
    expect(geoIds.size).toBe(1);
    expect(batch.unusedVertexCount).toBe(0);
    expect(batch.receiveShadow).toBe(true);
    expect(batch.perObjectFrustumCulled).toBe(true);
    expect(batch.sortObjects).toBe(false);
    expect(batch.visible).toBe(true);
  });

  it('instances of the same geometry are independent', () => {
    const { meshes } = scene(3);
    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    const first = at(b, meshes[0]).batch;

    meshes[2].visible = false;
    b.sync();
    expect(first.getVisibleAt(at(b, meshes[0]).instanceId)).toBe(true);
    expect(first.getVisibleAt(at(b, meshes[1]).instanceId)).toBe(true);
    expect(first.getVisibleAt(at(b, meshes[2]).instanceId)).toBe(false);
    expect(b.drawCalls).toBe(1);

    meshes[1].material = selectMat;
    b.sync();
    const moved = at(b, meshes[1]);
    expect(moved.batch).not.toBe(first);
    expect(moved.batch.material).toBe(selectMat);
    expect(moved.batch.getVisibleAt(moved.instanceId)).toBe(true);
    expect(at(b, meshes[0]).batch).toBe(first);
    expect(at(b, meshes[2]).batch).toBe(first);
    expect(first.instanceCount).toBe(2);
    expect(first.getVisibleAt(at(b, meshes[0]).instanceId)).toBe(true);
    expect(first.getVisibleAt(at(b, meshes[2]).instanceId)).toBe(false);
    expect(b.drawCalls).toBe(2);
  });

  it('formatos distintos van a lotes distintos', () => {
    const mat = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    const indexed = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    const flat = new THREE.Mesh(new THREE.BoxGeometry().toNonIndexed(), mat);
    root.add(indexed, flat);
    root.updateMatrixWorld(true);
    const b = new SceneBatches();
    b.rebuild([indexed, flat], isShown);
    expect(b.drawCalls).toBe(2);
    expect(at(b, indexed).batch).not.toBe(at(b, flat).batch);
    expect(at(b, indexed).batch.geometry.getIndex()).not.toBeNull();
    expect(at(b, flat).batch.geometry.getIndex()).toBeNull();

    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    indexed.material = selectMat;
    flat.material = selectMat;
    expect(() => b.sync()).not.toThrow();
    expect(b.drawCalls).toBe(2);
    expect(at(b, indexed).batch.material).toBe(selectMat);
    expect(at(b, flat).batch.material).toBe(selectMat);
    expect(at(b, indexed).batch).not.toBe(at(b, flat).batch);
  });

  it('castShadow distinto separa lotes', () => {
    const { meshes } = scene(2);
    meshes[0].castShadow = true;
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    expect(b.drawCalls).toBe(2);
    expect(at(b, meshes[0]).batch.castShadow).toBe(true);
    expect(at(b, meshes[1]).batch.castShadow).toBe(false);

    meshes[1].castShadow = true;
    b.sync();
    expect(at(b, meshes[1]).batch).toBe(at(b, meshes[0]).batch);
    expect(b.drawCalls).toBe(1);
  });

  it('capa 0 desactivada no se dibuja', () => {
    const { meshes } = scene(2);
    meshes[0].layers.disable(0);
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    const r = at(b, meshes[0]);
    expect(r.batch.getVisibleAt(r.instanceId)).toBe(false);
    expect(r.batch.getVisibleAt(at(b, meshes[1]).instanceId)).toBe(true);
  });

  it('un ancestro oculto oculta la instancia', () => {
    const root = new THREE.Group();
    const parent = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial();
    const g = new THREE.BoxGeometry();
    const inside = new THREE.Mesh(g, mat);
    const outside = new THREE.Mesh(g, mat);
    parent.add(inside);
    root.add(parent, outside);
    root.updateMatrixWorld(true);
    const b = new SceneBatches();
    b.rebuild([inside, outside], isShown);
    parent.visible = false;
    b.sync();
    expect(at(b, inside).batch.getVisibleAt(at(b, inside).instanceId)).toBe(false);
    expect(at(b, outside).batch.getVisibleAt(at(b, outside).instanceId)).toBe(true);
    expect(b.drawCalls).toBe(1);

    outside.visible = false;
    b.sync();
    expect(b.drawCalls).toBe(0);
    expect(at(b, outside).batch.visible).toBe(false);
  });

  it('sync copies the world matrix; syncTransforms too', () => {
    const { root, meshes } = scene(2);
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    const out = new THREE.Matrix4();
    const r0 = at(b, meshes[0]);
    expectSameMatrix(r0.batch.getMatrixAt(r0.instanceId, out), meshes[0].matrixWorld);

    root.position.set(0, 5, 0);
    meshes[0].rotation.set(0, 0, 1);
    root.updateMatrixWorld(true);
    b.sync();
    expectSameMatrix(r0.batch.getMatrixAt(r0.instanceId, out), meshes[0].matrixWorld);

    meshes[1].position.set(7, 8, 9);
    root.updateMatrixWorld(true);
    b.syncTransforms([meshes[1]]);
    const r1 = at(b, meshes[1]);
    expectSameMatrix(r1.batch.getMatrixAt(r1.instanceId, out), meshes[1].matrixWorld);
    expect(out.elements[12]).toBeCloseTo(7);
    expect(out.elements[13]).toBeCloseTo(13);
  });

  it('it grows when a batch becomes too small', () => {
    const { meshes, material } = scene(120);
    const other = new THREE.Mesh(new THREE.TorusGeometry(1, 0.2, 8, 16), material);
    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    meshes[0].material = selectMat; // 1 malla en selectMat al construir
    const all = [...meshes, other];
    for (const m of all) m.updateMatrixWorld(true);
    const b = new SceneBatches();
    b.rebuild(all, isShown);
    expect(b.drawCalls).toBe(2);
    const sel = at(b, meshes[0]).batch;
    expect(sel.maxInstanceCount).toBe(1);

    // 50 move to selectMat (fewer than half: they are moved one by one), among them the torus of another geometry
    const moving = [...meshes.slice(1, 50), other];
    for (const m of moving) m.material = selectMat;
    expect(() => b.sync()).not.toThrow();
    expect(at(b, meshes[0]).batch).toBe(sel); // el mismo lote, crecido
    expect(sel.instanceCount).toBe(51);
    expect(sel.maxInstanceCount).toBeGreaterThanOrEqual(51);
    expect(b.drawCalls).toBe(2);
    const out = new THREE.Matrix4();
    for (const m of [meshes[0], ...moving]) {
      const r = at(b, m);
      expect(r.batch).toBe(sel);
      expect(r.batch.getVisibleAt(r.instanceId)).toBe(true);
      expectSameMatrix(r.batch.getMatrixAt(r.instanceId, out), m.matrixWorld);
    }
    const torusRange = sel.getGeometryRangeAt(sel.getGeometryIdAt(at(b, other).instanceId))!;
    expect(torusRange.vertexCount).toBe(other.geometry.getAttribute('position').count);
    // after setGeometrySize, the box added when building is still intact in the batch buffer
    const boxRange = sel.getGeometryRangeAt(sel.getGeometryIdAt(at(b, meshes[0]).instanceId))!;
    const src = meshes[0].geometry.getAttribute('position');
    const dst = sel.geometry.getAttribute('position');
    for (let i = 0; i < src.count; i++) expect(dst.getX(boxRange.vertexStart + i)).toBe(src.getX(i));
    const srcIdx = meshes[0].geometry.getIndex()!;
    for (let i = 0; i < srcIdx.count; i++) expect(sel.geometry.getIndex()!.getX(boxRange.indexStart + i)).toBe(boxRange.vertexStart + srcIdx.getX(i));
    expect(at(b, meshes[60]).batch.instanceCount).toBe(70);

    // todas ocultas en selectMat → ese lote no dibuja
    for (const m of [meshes[0], ...moving]) m.visible = false;
    b.sync();
    expect(b.drawCalls).toBe(1);
  });

  it('cambio masivo de clave reconstruye', () => {
    const { meshes } = scene(10);
    const xray = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    for (const m of meshes) m.material = xray;
    b.sync();
    expect(b.drawCalls).toBe(1);
    expect(b.root.children.length).toBe(1);
    const batch = at(b, meshes[0]).batch;
    expect(batch.material).toBe(xray);
    expect(batch.sortObjects).toBe(true);
    expect(batch.instanceCount).toBe(10);
  });

  it('sync(subset) only re-reads those meshes and only nulls the bounds of the batches that change', () => {
    const a = scene(4);
    const other = scene(2, new THREE.SphereGeometry(), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const meshes = [...a.meshes, ...other.meshes];
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    const boxes = at(b, a.meshes[0]).batch;
    const spheres = at(b, other.meshes[0]).batch;
    boxes.computeBoundingSphere();
    spheres.computeBoundingSphere();

    // selecting a.meshes[1]: it changes material, and another mesh changes too but is not passed
    a.meshes[1].material = selectMat;
    a.meshes[2].material = selectMat;
    b.sync([a.meshes[1]]);
    const sel = at(b, a.meshes[1]).batch;
    expect(sel.material).toBe(selectMat);
    expect(sel).not.toBe(boxes);
    expect(at(b, a.meshes[2]).batch).toBe(boxes); // fuera del subconjunto: no se relee
    expect(b.drawCalls).toBe(3);
    // the batch of the spheres was not touched: it keeps its bounding sphere
    expect(spheres.boundingSphere).not.toBeNull();
    expect(boxes.boundingSphere).toBeNull();

    // undo: it goes back to its batch; the selection batch is left empty and stops being drawn
    a.meshes[1].material = a.material;
    a.meshes[2].material = a.material;
    b.sync([a.meshes[1]]);
    expect(at(b, a.meshes[1]).batch).toBe(boxes);
    expect(sel.visible).toBe(false);
    expect(b.drawCalls).toBe(2);
  });

  it('sync(subconjunto) mantiene la visibilidad y el conteo de llamadas', () => {
    const { meshes } = scene(3);
    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    meshes[0].visible = false;
    meshes[0].material = selectMat;
    b.sync([meshes[0]]);
    const r = at(b, meshes[0]);
    expect(r.batch.material).toBe(selectMat);
    expect(r.batch.getVisibleAt(r.instanceId)).toBe(false);
    expect(r.batch.visible).toBe(false);
    expect(b.drawCalls).toBe(1);
    meshes[0].visible = true;
    b.sync([meshes[0]]);
    expect(r.batch.getVisibleAt(r.instanceId)).toBe(true);
    expect(b.drawCalls).toBe(2);
    // las otras dos, ocultas a la vez: el lote original deja de dibujarse
    meshes[1].visible = meshes[2].visible = false;
    b.sync([meshes[1], meshes[2]]);
    expect(at(b, meshes[1]).batch.visible).toBe(false);
    expect(b.drawCalls).toBe(1);
  });

  it('sync(subset) ignores meshes that were not in the last rebuild', () => {
    const { meshes } = scene(2);
    const stray = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    b.sync([stray]);
    expect(b.batchOf(stray)).toBeNull();
    expect(b.root.children.length).toBe(1);
    b.dispose();
    b.sync(meshes);
    expect(b.root.children.length).toBe(0);
  });

  it('sync(subset) with more than half changing key rebuilds', () => {
    const { meshes } = scene(4);
    const selectMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    for (const m of meshes.slice(0, 3)) m.material = selectMat;
    b.sync(meshes.slice(0, 3));
    expect(b.root.children.length).toBe(2); // without empty batches from before
    expect(at(b, meshes[0]).batch.instanceCount).toBe(3);
    expect(b.drawCalls).toBe(2);
  });

  it('dispose leaves the root empty and does not release the source geometries', () => {
    const { meshes, geometry, material } = scene(3);
    let geoDisposed = 0;
    let matDisposed = 0;
    geometry.addEventListener('dispose', () => geoDisposed++);
    material.addEventListener('dispose', () => matDisposed++);
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    let batchDisposed = 0;
    at(b, meshes[0]).batch.geometry.addEventListener('dispose', () => batchDisposed++);
    b.dispose();
    expect(b.root.children.length).toBe(0);
    expect(b.drawCalls).toBe(0);
    expect(b.batchOf(meshes[0])).toBeNull();
    expect(batchDisposed).toBe(1);
    expect(geoDisposed).toBe(0);
    expect(matDisposed).toBe(0);
  });
});

describe('SceneBatches: drawn geometry (LOD)', () => {
  const geoIdOf = (b: SceneBatches, m: THREE.Mesh) => {
    const r = at(b, m);
    return r.batch.getGeometryIdAt(r.instanceId);
  };

  it('it draws the substitute geometry without touching the source mesh', () => {
    const { meshes, geometry } = scene(2);
    const simple = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    const b = new SceneBatches();
    b.rebuild(meshes, isShown);
    expect(geoIdOf(b, meshes[0])).toBe(geoIdOf(b, meshes[1]));

    b.setDrawGeometries(new Map([[meshes[0], simple]]));
    b.rebuild(meshes, isShown);
    expect(geoIdOf(b, meshes[0])).not.toBe(geoIdOf(b, meshes[1]));
    expect(meshes[0].geometry).toBe(geometry);
    expect(b.drawCalls).toBe(1);
    // it reserves just enough for the two geometries
    expect(at(b, meshes[0]).batch.unusedVertexCount).toBe(0);

    b.setDrawGeometries(new Map());
    b.rebuild(meshes, isShown);
    expect(geoIdOf(b, meshes[0])).toBe(geoIdOf(b, meshes[1]));
  });

  it('una sustituta con otro formato va a otro lote', () => {
    const { meshes } = scene(2);
    const b = new SceneBatches();
    b.setDrawGeometries(new Map([[meshes[0], new THREE.BoxGeometry().toNonIndexed()]]));
    b.rebuild(meshes, isShown);
    expect(at(b, meshes[0]).batch).not.toBe(at(b, meshes[1]).batch);
  });

  it('sync conserva la sustituta al cambiar el material de la malla', () => {
    const { meshes } = scene(3);
    const simple = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
    const b = new SceneBatches();
    b.setDrawGeometries(new Map([[meshes[0], simple]]));
    b.rebuild(meshes, isShown);
    meshes[0].material = new THREE.MeshStandardMaterial();
    b.sync([meshes[0]]);
    const r = at(b, meshes[0]);
    const range = r.batch.getGeometryRangeAt(r.batch.getGeometryIdAt(r.instanceId))!;
    expect(range.vertexCount).toBe(simple.getAttribute('position').count);
  });

  it('dispose olvida las sustitutas', () => {
    const { meshes } = scene(2);
    const b = new SceneBatches();
    b.setDrawGeometries(new Map([[meshes[0], new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)]]));
    b.rebuild(meshes, isShown);
    b.dispose();
    b.rebuild(meshes, isShown);
    expect(geoIdOf(b, meshes[0])).toBe(geoIdOf(b, meshes[1]));
  });
});
