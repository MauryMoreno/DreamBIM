// Fake TransformControls for the tests: no WebGL or real pointer. It keeps what the gizmo
// configura y deja simular un arrastre (mouseDown → mover el objeto → objectChange → mouseUp).
import * as THREE from 'three';
import type { TransformControlsLike } from '../src/workspace/gizmo';

export class FakeTransformControls extends THREE.EventDispatcher<Record<string, { type: string }>> implements TransformControlsLike {
  object: THREE.Object3D | undefined = undefined;
  mode = 'translate';
  space = 'world';
  showX = true;
  showY = true;
  showZ = true;
  dragging = false;
  axis: string | null = null;
  readonly helper = new THREE.Object3D();

  constructor(
    readonly camera: THREE.Camera,
    readonly dom: HTMLElement,
  ) {
    super();
    // like the real gizmo: handles with the name of their axis, each one with its material
    for (const name of ['X', 'Y', 'Z', 'XY']) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.name = name;
      this.helper.add(m);
    }
    this.helper.visible = false;
  }

  attach(o: THREE.Object3D) {
    this.object = o;
    this.helper.visible = true;
    return this;
  }
  detach() {
    this.object = undefined;
    this.axis = null;
    this.helper.visible = false;
    return this;
  }
  getHelper() {
    return this.helper;
  }
  dispose() {}

  /** Pulsa sobre el eje `axis`. */
  press(axis = 'X') {
    this.axis = axis;
    this.dragging = true;
    this.dispatchEvent({ type: 'mouseDown' });
  }
  /** Drags until the object `d` is displaced from where it started (as TransformControls does with position). */
  drag(start: THREE.Vector3, d: [number, number, number]) {
    if (!this.dragging || !this.object) return;
    this.object.position.copy(start).add(new THREE.Vector3(...d));
    this.dispatchEvent({ type: 'objectChange' });
  }
  /** Releases the button: mouseUp only if an axis was still being dragged (as the real one) and then the pointerup. */
  release() {
    if (this.dragging && this.axis !== null) this.dispatchEvent({ type: 'mouseUp' });
    this.dragging = false;
    this.axis = null;
    this.dom.dispatchEvent(new Event('pointerup'));
  }
}
