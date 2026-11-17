// X/Y/Z arrows to move by dragging in the view (three.js TransformControls). The gizmo does not
// attach to the model object (its matrix is fixed, no position): it moves a handle at the center of
// the element and copies the offset to the object matrix as a preview. On release it reports the
// total offset; the receiver saves the edit and the model is recomposed (the preview stays until
// then; if the edit is not saved, everything goes back).
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Viewer } from '../render/viewer';
import type { Vec3 } from '../composer/xform';
import type { Disposables } from './context';

/** Arrow colors (Global Constraints): X red, Y green, Z blue. */
export const AXIS_COLORS = { X: 0xe53935, Y: 0x43a047, Z: 0x1e88e5 } as const;

/** Below this (m) a drag has not moved anything. */
const MIN_DELTA = 1e-6;

export type GizmoAxes = { x: boolean; y: boolean; z: boolean };

/** What the gizmo uses from the viewer (refreshTransforms: the object moved; the viewer catches up what it draws). */
export type GizmoViewer = Pick<Viewer, 'scene' | 'camera' | 'objectOf' | 'setControlsEnabled' | 'requestRender' | 'refreshTransforms'>;

/** What the gizmo uses from TransformControls (injectable: the real one needs a canvas and a real camera). */
export interface TransformControlsLike {
  object?: THREE.Object3D;
  mode: string;
  space: string;
  showX: boolean;
  showY: boolean;
  showZ: boolean;
  dragging: boolean;
  axis: string | null;
  attach(o: THREE.Object3D): unknown;
  detach(): unknown;
  getHelper(): THREE.Object3D;
  addEventListener(type: string, fn: () => void): void;
}

/** Drag in progress: the object, where the handle started, the object's original matrix and whether it was cancelled. */
interface Drag {
  obj: THREE.Object3D;
  start: THREE.Vector3;
  base: THREE.Matrix4;
  auto: boolean;
  cancelled: boolean;
}

export interface Gizmo {
  /** Shows the arrows over the element at that path (null hides them). In plan there is never a Z. */
  attach(path: string | null, axes: GizmoAxes, view?: '3d' | 'plan' | 'elevation'): void;
  /** A drag is in progress (the button is still down, even if it was cancelled with Esc). */
  readonly dragging: boolean;
}

export interface GizmoCallbacks {
  preview(delta: Vec3): void;
  /** Saves the move; false (or a rejection) if it was not saved: then the preview is undone. */
  commit(delta: Vec3): Promise<boolean> | boolean;
  /** The drag moved nothing in the end (Esc, selection change or rejected move). */
  cancel(): void;
}

const realControls = (camera: THREE.Camera, dom: HTMLElement): TransformControlsLike =>
  new TransformControls(camera, dom) as unknown as TransformControlsLike;

export function mountGizmo(
  viewer: GizmoViewer,
  dom: HTMLElement,
  cb: GizmoCallbacks,
  make: (camera: THREE.Camera, dom: HTMLElement) => TransformControlsLike = realControls,
  dispose?: Disposables,
): Gizmo {
  const tc = make(viewer.camera, dom);
  tc.mode = 'translate';
  tc.space = 'world';
  const helper = tc.getHelper();
  // per-axis colors on the handle materials (before drawing them for the first time)
  helper.traverse((o) => {
    const color = AXIS_COLORS[o.name as keyof typeof AXIS_COLORS];
    const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (color !== undefined && mat?.color) mat.color.setHex(color);
  });
  viewer.scene.add(helper);
  // the handle TransformControls drags: it lives in the scene, at the center of the element
  const handle = new THREE.Object3D();
  viewer.scene.add(handle);

  /** Element under the arrows. */
  let target: THREE.Object3D | null = null;
  let drag: Drag | null = null;

  const deltaOf = (d: Drag): Vec3 => {
    const v = handle.position.clone().sub(d.start);
    return [v.x, v.y, v.z];
  };

  /** Preview: the object's local matrix offset by `delta` in the world (without recomposing the model). */
  function show(d: Drag, delta: Vec3): void {
    const o = d.obj;
    const local = new THREE.Vector3(...delta);
    // the offset is in world space: it is converted to the parent's system (without its translation)
    if (o.parent) local.applyMatrix3(new THREE.Matrix3().setFromMatrix4(o.parent.matrixWorld).invert());
    o.matrixAutoUpdate = false;
    o.matrix.copy(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z).multiply(d.base));
    viewer.refreshTransforms(o);
  }

  /** Leaves the object and the handle as they were before the drag. */
  function restore(d: Drag): void {
    // the handle only if it is still over that object (the selection may have changed meanwhile)
    if (target === d.obj) {
      handle.position.copy(d.start);
      handle.updateMatrixWorld();
    }
    d.obj.matrix.copy(d.base);
    d.obj.matrixAutoUpdate = d.auto;
    viewer.refreshTransforms(d.obj);
  }

  /** Esc or a selection change mid-drag: everything goes back and nothing is saved. */
  function cancelDrag(): void {
    if (!drag || drag.cancelled) return;
    drag.cancelled = true;
    // TransformControls stops moving the handle until the next click
    tc.dragging = false;
    tc.axis = null;
    restore(drag);
    cb.cancel();
  }

  /** End of the drag (button released): the orbit comes back. */
  function endDrag(): void {
    drag = null;
    viewer.setControlsEnabled(true);
  }

  tc.addEventListener('change', () => viewer.requestRender());
  tc.addEventListener('mouseDown', () => {
    if (!target) return;
    viewer.setControlsEnabled(false);
    drag = { obj: target, start: handle.position.clone(), base: target.matrix.clone(), auto: target.matrixAutoUpdate, cancelled: false };
  });
  tc.addEventListener('objectChange', () => {
    if (!drag || drag.cancelled) return;
    const delta = deltaOf(drag);
    show(drag, delta);
    cb.preview(delta);
  });
  tc.addEventListener('mouseUp', () => {
    const d = drag;
    if (!d) return;
    endDrag();
    if (d.cancelled) return;
    const delta = deltaOf(d);
    if (Math.hypot(...delta) <= MIN_DELTA) return restore(d);
    // the preview stays until the recomposed model replaces the object; if it is not saved, it goes back
    const undo = () => {
      restore(d);
      cb.cancel();
    };
    let r: Promise<boolean> | boolean;
    try {
      r = cb.commit(delta);
    } catch {
      return undo();
    }
    void Promise.resolve(r).then((ok) => {
      if (!ok) undo();
    }, undo);
  });
  // after Esc, TransformControls no longer reports mouseUp: the drag ends when the button is released
  const release = () => {
    if (!drag) return;
    cancelDrag();
    endDrag();
  };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);
  // Esc during the drag: cancels it and does not reach the workspace shortcut (deselect)
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    cancelDrag();
  };
  window.addEventListener('keydown', onEscape, true);
  dispose?.add(() => window.removeEventListener('keydown', onEscape, true));

  function attach(path: string | null, axes: GizmoAxes, view?: '3d' | 'plan' | 'elevation'): void {
    // mid-drag: it is cancelled; the orbit comes back when the button is released (as with Esc)
    cancelDrag();
    const show = { x: axes.x, y: axes.y, z: axes.z && view !== 'plan' };
    target = path ? viewer.objectOf(path) : null;
    if (!target || !(show.x || show.y || show.z)) {
      target = null;
      tc.detach();
      viewer.requestRender();
      return;
    }
    target.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) handle.position.setFromMatrixPosition(target.matrixWorld);
    else box.getCenter(handle.position);
    handle.updateMatrixWorld();
    tc.showX = show.x;
    tc.showY = show.y;
    tc.showZ = show.z;
    tc.attach(handle);
    viewer.requestRender();
  }

  return {
    attach,
    get dragging() {
      return drag !== null;
    },
  };
}
