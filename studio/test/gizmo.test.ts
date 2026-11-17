import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AXIS_COLORS, mountGizmo, type GizmoViewer } from '../src/workspace/gizmo';
import type { Vec3 } from '../src/composer/xform';
import { FakeTransformControls } from './fake-transform';

/**
 * Minimal viewer: a scene with an object `w` translated to (1, 2, 0) with its fixed matrix (like the Viewer).
 * `commit` says whether the movement was saved (yes by default); `parent` gives another parent (rotated, scaled…).
 */
function setup(commit: (d: Vec3) => Promise<boolean> | boolean = () => Promise.resolve(true), parent = new THREE.Group()) {
  const scene = new THREE.Scene();
  scene.add(parent);
  const obj = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  obj.matrixAutoUpdate = false;
  obj.matrix.makeTranslation(1, 2, 0);
  parent.add(obj);
  scene.updateMatrixWorld(true);
  const enabled: boolean[] = [];
  /** Objects with which the gizmo told the viewer that their transformation changed. */
  const refreshed: THREE.Object3D[] = [];
  const viewer: GizmoViewer = {
    scene,
    camera: new THREE.PerspectiveCamera(),
    objectOf: (p: string) => (p === 'w' ? obj : null),
    setControlsEnabled: (on: boolean) => void enabled.push(on),
    requestRender: () => {},
    // like the Viewer: it updates the world matrices of the subtree (and its draw batches)
    refreshTransforms: (o: THREE.Object3D) => {
      o.updateMatrixWorld(true);
      refreshed.push(o);
    },
  };
  const dom = document.createElement('div');
  document.body.replaceChildren(dom);
  let tc!: FakeTransformControls;
  const cb = { preview: vi.fn(), commit: vi.fn(commit), cancel: vi.fn() };
  const gizmo = mountGizmo(viewer, dom, cb, (cam, el) => (tc = new FakeTransformControls(cam, el)));
  /** Position of the handle when starting to drag. */
  const start = () => tc.object!.position.clone();
  const translation = () => new THREE.Vector3().setFromMatrixPosition(obj.matrix).toArray();
  return { scene, obj, gizmo, tc, cb, enabled, start, translation, refreshed };
}

const XY = { x: true, y: true, z: false };
/** Deja correr las promesas pendientes (la respuesta de commit). */
const flush = () => new Promise((r) => setTimeout(r, 0));
const XYZ = { x: true, y: true, z: true };

describe('mountGizmo', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds the helper to the scene, in translate mode and world space, with the arrow colours', () => {
    const { scene, tc } = setup();
    expect(scene.children).toContain(tc.helper);
    expect(tc.mode).toBe('translate');
    expect(tc.space).toBe('world');
    const color = (n: string) => ((tc.helper.getObjectByName(n) as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
    expect([color('X'), color('Y'), color('Z')]).toEqual([AXIS_COLORS.X, AXIS_COLORS.Y, AXIS_COLORS.Z]);
    expect(AXIS_COLORS).toEqual({ X: 0xe53935, Y: 0x43a047, Z: 0x1e88e5 });
  });

  it('attach with axes x,y hides Z', () => {
    const { gizmo, tc } = setup();
    gizmo.attach('w', XY);
    expect(tc.object).toBeDefined();
    expect(tc.helper.visible).toBe(true);
    expect([tc.showX, tc.showY, tc.showZ]).toEqual([true, true, false]);
    gizmo.attach('w', { x: false, y: false, z: true });
    expect([tc.showX, tc.showY, tc.showZ]).toEqual([false, false, true]);
  });

  it('places the handle at the centre of the element', () => {
    const { gizmo, tc } = setup();
    gizmo.attach('w', XYZ);
    expect(tc.object!.position.toArray()).toEqual([1, 2, 0]);
  });

  it('is hidden with no selection, an unknown path or no axis', () => {
    const { gizmo, tc } = setup();
    gizmo.attach('w', XY);
    gizmo.attach(null, XY);
    expect(tc.object).toBeUndefined();
    expect(tc.helper.visible).toBe(false);
    gizmo.attach('nope', XY);
    expect(tc.object).toBeUndefined();
    gizmo.attach('w', { x: false, y: false, z: false });
    expect(tc.object).toBeUndefined();
  });

  it('plan view never shows Z', () => {
    const { gizmo, tc } = setup();
    gizmo.attach('w', XYZ, 'plan');
    expect([tc.showX, tc.showY, tc.showZ]).toEqual([true, true, false]);
    // a level only moves in Z: in plan no axis is left
    gizmo.attach('w', { x: false, y: false, z: true }, 'plan');
    expect(tc.object).toBeUndefined();
    gizmo.attach('w', XYZ, 'elevation');
    expect(tc.showZ).toBe(true);
  });

  it('drag → preview with the delta, release → commit once', async () => {
    const { gizmo, tc, cb, enabled, start, translation, obj } = setup();
    gizmo.attach('w', XYZ);
    const s = start();
    tc.press('X');
    expect(gizmo.dragging).toBe(true);
    expect(enabled).toEqual([false]); // no orbit while dragging
    tc.drag(s, [0.5, 0, 0]);
    tc.drag(s, [1.5, 0, 0.25]);
    expect(cb.preview).toHaveBeenCalledTimes(2);
    expect(cb.preview.mock.calls[1][0]).toEqual([1.5, 0, 0.25]);
    // vista previa: la matriz del objeto, sin recomponer
    expect(translation()).toEqual([2.5, 2, 0.25]);
    expect(obj.matrixWorld.elements[12]).toBeCloseTo(2.5);
    tc.release();
    expect(cb.commit).toHaveBeenCalledTimes(1);
    expect(cb.commit.mock.calls[0][0]).toEqual([1.5, 0, 0.25]);
    expect(cb.cancel).not.toHaveBeenCalled();
    expect(gizmo.dragging).toBe(false);
    expect(enabled).toEqual([false, true]);
    // la vista previa se queda hasta que el modelo recompuesto sustituya al objeto
    await flush();
    expect(translation()).toEqual([2.5, 2, 0.25]);
    expect(cb.cancel).not.toHaveBeenCalled();
  });

  for (const [name, commit] of [
    ['resolves false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('session changed'))],
    ['returns false', () => false],
  ] as const) {
    it(`a commit that ${name} puts the element and the handle back and cancels`, async () => {
      const { gizmo, tc, cb, start, translation } = setup(commit);
      gizmo.attach('w', XY);
      const s = start();
      tc.press('X');
      tc.drag(s, [2, 1, 0]);
      tc.release();
      expect(cb.commit).toHaveBeenCalledTimes(1);
      await flush();
      expect(translation()).toEqual([1, 2, 0]);
      expect(tc.object!.position.toArray()).toEqual(s.toArray());
      expect(cb.cancel).toHaveBeenCalledTimes(1);
    });
  }

  it('previews a world translation of exactly the delta under a rotated and scaled parent', () => {
    const parent = new THREE.Group();
    parent.position.set(5, -3, 1);
    parent.rotation.set(0.3, -0.7, 1.1);
    parent.scale.set(2, 0.5, 3);
    const { gizmo, tc, obj, start } = setup(undefined, parent);
    const world = () => new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
    gizmo.attach('w', XYZ);
    const before = world();
    const s = start();
    tc.press('X');
    tc.drag(s, [1.5, -0.5, 2]);
    const moved = world().sub(before);
    expect(moved.x).toBeCloseTo(1.5, 9);
    expect(moved.y).toBeCloseTo(-0.5, 9);
    expect(moved.z).toBeCloseTo(2, 9);
  });

  it('la vista previa y el restaurar avisan al visor con el objeto movido', () => {
    const { gizmo, tc, obj, start, translation, refreshed } = setup();
    gizmo.attach('w', XY);
    const s = start();
    tc.press('X');
    tc.drag(s, [2, 1, 0]);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toBe(obj);
    expect(obj.matrixWorld.elements[12]).toBeCloseTo(3);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(refreshed).toHaveLength(2);
    expect(refreshed[1]).toBe(obj);
    expect(translation()).toEqual([1, 2, 0]);
    expect(obj.matrixWorld.elements[12]).toBeCloseTo(1);
    tc.release();
  });

  it('a zero delta does not commit and restores at once', () => {
    const { gizmo, tc, cb, start, translation } = setup();
    gizmo.attach('w', XY);
    const s = start();
    tc.press('X');
    tc.drag(s, [1e-9, 0, 0]);
    tc.release();
    expect(cb.commit).not.toHaveBeenCalled();
    expect(translation()).toEqual([1, 2, 0]);
    expect(tc.object!.position.toArray()).toEqual(s.toArray());
    // un clic sobre el asa, sin moverla
    tc.press('Y');
    tc.release();
    expect(cb.commit).not.toHaveBeenCalled();
  });

  it('Esc → cancel and the object returns to its matrix, without deselecting', () => {
    const { gizmo, tc, cb, enabled, start, translation } = setup();
    const later = vi.fn();
    window.addEventListener('keydown', later); // el atajo Esc del espacio de trabajo (deseleccionar)
    gizmo.attach('w', XY);
    const s = start();
    tc.press('X');
    tc.drag(s, [2, 1, 0]);
    expect(translation()).toEqual([3, 3, 0]);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cb.cancel).toHaveBeenCalledTimes(1);
    expect(translation()).toEqual([1, 2, 0]);
    expect(later).not.toHaveBeenCalled();
    expect(tc.object!.position.toArray()).toEqual(s.toArray()); // the handle comes back too
    // what is left of the drag no longer moves anything
    tc.drag(s, [4, 0, 0]);
    expect(cb.preview).toHaveBeenCalledTimes(1);
    expect(gizmo.dragging).toBe(true); // the button is still pressed: the orbit waits until it is released
    expect(enabled).toEqual([false]);
    tc.release();
    expect(cb.commit).not.toHaveBeenCalled();
    expect(enabled).toEqual([false, true]);
    expect(gizmo.dragging).toBe(false);
    window.removeEventListener('keydown', later);
    // sin arrastre, Esc sigue su camino
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cb.cancel).toHaveBeenCalledTimes(1);
  });

  it('attach during a drag cancels it first', () => {
    const { gizmo, tc, cb, enabled, start, translation } = setup();
    gizmo.attach('w', XY);
    const s = start();
    tc.press('X');
    tc.drag(s, [2, 0, 0]);
    gizmo.attach(null, XY);
    expect(translation()).toEqual([1, 2, 0]);
    expect(cb.cancel).toHaveBeenCalledTimes(1);
    // the button is still pressed: the orbit waits until it is released, as with Esc
    expect(enabled).toEqual([false]);
    expect(gizmo.dragging).toBe(true);
    tc.release();
    expect(enabled).toEqual([false, true]);
    expect(gizmo.dragging).toBe(false);
    expect(cb.commit).not.toHaveBeenCalled();
  });
});
