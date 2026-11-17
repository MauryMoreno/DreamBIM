import * as THREE from 'three';

const BOX_COLOR = 0xf59e0b;
const HOVER_COLOR = 0xfde68a;
/** Minimum box height on each axis (m): dragging a face does not let it pass the opposite one. */
export const MIN_BOX_SIZE = 0.05;
/** How far a face may leave the model when dragged, as a fraction of its size. */
const DRAG_REACH = 0.25;
/** Handle size on screen, as a fraction of the distance to the camera. */
const HANDLE_SCREEN = 0.025;
/** tan(22.5°): the half-fov at which the distance formula gives the handle size. */
const REFERENCE_HALF_TAN = Math.tan(Math.PI / 8);

export type FaceId = { axis: 0 | 1 | 2; sign: 1 | -1 };

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const FACES: FaceId[] = [
  { axis: 0, sign: 1 }, { axis: 0, sign: -1 },
  { axis: 1, sign: 1 }, { axis: 1, sign: -1 },
  { axis: 2, sign: 1 }, { axis: 2, sign: -1 },
];

/**
 * Parameter s of the point on the line (o + s·d) nearest to the ray (ro + t·rd): with it, dragging the
 * pointer moves a face along its axis. null if the ray is parallel to the axis (no single point).
 */
export function closestOnAxis(ro: THREE.Vector3, rd: THREE.Vector3, o: THREE.Vector3, d: THREE.Vector3): number | null {
  const w = o.clone().sub(ro);
  const a = d.dot(d), b = d.dot(rd), c = rd.dot(rd);
  const dw = d.dot(w), rw = rd.dot(w);
  const den = a * c - b * b;
  if (den < 1e-9 * a * c) return null;
  return (b * rw - c * dw) / den;
}

/**
 * Section box: six clipping planes that keep what is inside, with its drawing (edges, faint faces) and
 * a handle at the centre of each face that is dragged along its axis.
 */
export class SectionBox {
  readonly root = new THREE.Group();
  /** Clipping planes, in FACES order; their normals face inwards. They are mutated, not replaced. */
  readonly planes = FACES.map(() => new THREE.Plane());
  readonly box = new THREE.Box3();
  private limit = new THREE.Box3();
  private edges: THREE.LineSegments;
  private faces: THREE.Mesh[] = [];
  private handles: THREE.Mesh[] = [];
  private active: number | null = null;
  private hot: number | null = null;
  private drag: { face: number; s0: number; v0: number } | null = null;

  constructor(private onChange: () => void) {
    this.root.visible = false;
    this.root.name = 'section-box';
    const noRay = () => {};
    this.edges = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: BOX_COLOR, depthTest: false, transparent: true }),
    );
    this.edges.renderOrder = 998;
    this.edges.raycast = noRay;
    this.edges.frustumCulled = false;
    this.root.add(this.edges);

    FACES.forEach((f, i) => {
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: BOX_COLOR, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }),
      );
      face.renderOrder = 997;
      face.raycast = noRay;
      face.frustumCulled = false;
      face.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), AXES[f.axis]);
      this.faces.push(face);

      const handle = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.2, 16), // eje Y: la punta mira hacia fuera de la caja
        new THREE.MeshBasicMaterial({ color: BOX_COLOR, depthTest: false, transparent: true }),
      );
      handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), AXES[f.axis].clone().multiplyScalar(f.sign));
      handle.renderOrder = 999;
      handle.userData.face = i;
      handle.frustumCulled = false;
      this.handles.push(handle);
      this.root.add(face, handle);
    });
    this.layout();
  }

  get visible() { return this.root.visible; }

  setVisible(on: boolean) {
    this.root.visible = on;
    if (!on) this.endDrag();
  }

  /** Surrounds `b` again (with a minimum margin, so nothing is cut on open). */
  setBounds(b: THREE.Box3) {
    if (b.isEmpty()) return;
    const pad = Math.max(b.getSize(new THREE.Vector3()).length() * 0.01, 0.01);
    this.box.copy(b).expandByScalar(pad);
    const reach = this.box.getSize(new THREE.Vector3()).multiplyScalar(DRAG_REACH);
    this.limit.copy(this.box).expandByVector(reach);
    this.layout();
  }

  /** Position of face `i` on its axis. */
  private value(i: number): number {
    const f = FACES[i];
    return f.sign > 0 ? this.box.max.getComponent(f.axis) : this.box.min.getComponent(f.axis);
  }

  /** Moves face `i` to `v`: within the allowed reach and without passing the opposite face. */
  setFace(i: number, v: number) {
    const { axis, sign } = FACES[i];
    const lo = this.limit.min.getComponent(axis), hi = this.limit.max.getComponent(axis);
    if (sign > 0) this.box.max.setComponent(axis, THREE.MathUtils.clamp(v, this.box.min.getComponent(axis) + MIN_BOX_SIZE, hi));
    else this.box.min.setComponent(axis, THREE.MathUtils.clamp(v, lo, this.box.max.getComponent(axis) - MIN_BOX_SIZE));
    this.layout();
    this.onChange();
  }

  /** Places planes, edges, faces and handles according to `box`. */
  private layout() {
    const { min, max } = this.box;
    FACES.forEach((f, i) => {
      // what is inside stays: normal towards the centre
      this.planes[i].normal.copy(AXES[f.axis]).multiplyScalar(-f.sign);
      this.planes[i].constant = f.sign > 0 ? max.getComponent(f.axis) : -min.getComponent(f.axis);
    });
    const c = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    FACES.forEach((f, i) => {
      const p = c.clone();
      p.setComponent(f.axis, this.value(i));
      this.faces[i].position.copy(p);
      this.faces[i].scale.copy(faceScale(f.axis, size));
      const h = this.handles[i];
      h.position.copy(p);
      h.userData.base = p.clone();
    });
    const corners = [
      [min.x, min.y, min.z], [max.x, min.y, min.z], [max.x, max.y, min.z], [min.x, max.y, min.z],
      [min.x, min.y, max.z], [max.x, min.y, max.z], [max.x, max.y, max.z], [min.x, max.y, max.z],
    ];
    const pairs = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
    const pos = new Float32Array(pairs.length * 3);
    pairs.forEach((k, n) => pos.set(corners[k], n * 3));
    this.edges.geometry.dispose();
    this.edges.geometry = new THREE.BufferGeometry();
    this.edges.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  }

  /** Keeps the handles a similar size on screen, whatever the distance or projection. */
  updateScale(camera: THREE.Camera, target: THREE.Vector3) {
    if (!this.root.visible) return;
    let s: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = camera as THREE.OrthographicCamera;
      s = ((o.top - o.bottom) / o.zoom) * HANDLE_SCREEN;
    } else {
      const p = camera as THREE.PerspectiveCamera;
      s = camera.position.distanceTo(target) * HANDLE_SCREEN * Math.tan(THREE.MathUtils.degToRad(p.fov / 2)) / REFERENCE_HALF_TAN;
    }
    for (const h of this.handles) h.scale.setScalar(s);
  }

  /** Face whose handle crosses the ray; null if none. */
  hitHandle(raycaster: THREE.Raycaster): number | null {
    if (!this.root.visible) return null;
    const hit = raycaster.intersectObjects(this.handles, false)[0];
    return hit ? (hit.object.userData.face as number) : null;
  }

  /** Highlights the handle of face `i` (null removes the highlight). */
  setHot(i: number | null): boolean {
    if (i === this.hot) return false;
    this.hot = i;
    this.handles.forEach((h, n) => (h.material as THREE.MeshBasicMaterial).color.setHex(n === i || n === this.active ? HOVER_COLOR : BOX_COLOR));
    return true;
  }

  /** Starts dragging face `i` with the pointer ray. */
  beginDrag(i: number, raycaster: THREE.Raycaster): boolean {
    const f = FACES[i];
    const s0 = closestOnAxis(raycaster.ray.origin, raycaster.ray.direction, this.axisOrigin(i), AXES[f.axis]);
    if (s0 === null) return false;
    this.drag = { face: i, s0, v0: this.value(i) };
    this.active = i;
    this.setHot(i);
    return true;
  }

  /** Point of the drag line of face `i` with coordinate 0 on its axis: thus `s` is the face position. */
  private axisOrigin(i: number): THREE.Vector3 {
    return (this.handles[i].userData.base as THREE.Vector3).clone().setComponent(FACES[i].axis, 0);
  }

  get dragging() { return this.drag !== null; }

  moveDrag(raycaster: THREE.Raycaster) {
    if (!this.drag) return;
    const f = FACES[this.drag.face];
    const s = closestOnAxis(raycaster.ray.origin, raycaster.ray.direction, this.axisOrigin(this.drag.face), AXES[f.axis]);
    if (s === null) return;
    this.setFace(this.drag.face, s - this.drag.s0 + this.drag.v0);
  }

  endDrag() {
    this.drag = null;
    this.active = null;
    this.setHot(null);
  }

  /** Is the point inside the box (so selection ignores what is clipped)? */
  contains(p: THREE.Vector3): boolean {
    return this.planes.every(pl => pl.distanceToPoint(p) >= 0);
  }

  dispose() {
    this.edges.geometry.dispose();
    (this.edges.material as THREE.Material).dispose();
    for (const m of [...this.faces, ...this.handles]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

/** Scale of a face plane ⟂ to axis `axis` (after taking its Z to that axis, X and Y fall on the other two). */
function faceScale(axis: 0 | 1 | 2, size: THREE.Vector3): THREE.Vector3 {
  // setFromUnitVectors(Z -> X) = 90° turn about Y: local X -> -Z, local Y -> Y
  if (axis === 0) return new THREE.Vector3(size.z, size.y, 1);
  // Z -> Y = -90° turn about X: local X -> X, local Y -> Z
  if (axis === 1) return new THREE.Vector3(size.x, size.z, 1);
  return new THREE.Vector3(size.x, size.y, 1);
}
