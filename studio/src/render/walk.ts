// First-person walk with Z up (IFC / USD).
//
// Mouse (with pointer lock) to look, WASD / arrows to walk, Shift to run.
// With gravity: follows the floor, climbs steps up to STEP m and collides with opaque things.
// V toggles flying mode (no gravity or vertical collisions; E / Q to go up / down).

import * as THREE from 'three';

const EYE = 1.6; // eye height above the floor (m)
const STEP = 0.45; // maximum step climbed while walking (m)
const RADIUS = 0.3; // minimum distance to a wall (m)
const WALK = 1.4, RUN = 4.0, FLY = 4.0; // m/s
const GRAVITY = 9.8;
const LOOK = 0.0022; // rad per mouse pixel

export interface WalkHost {
  camera: THREE.PerspectiveCamera;
  element: HTMLElement;
  /** Meshes the walker collides with and walks on. */
  colliders(): THREE.Object3D[];
  /** Virtual ground elevation when there is no floor below. */
  groundZ(): number;
  requestRender(): void;
  onChange(): void;
}

export class WalkMode {
  private pos = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private vz = 0;
  private keys = new Set<string>();
  private colliders: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();
  fly = false;

  constructor(private host: WalkHost) {}

  // --- life cycle -----------------------------------------------------------

  start(eye: THREE.Vector3, yaw: number) {
    this.pos.copy(eye);
    this.yaw = yaw;
    this.pitch = 0;
    this.vz = 0;
    this.fly = false;
    this.refresh();
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    this.host.element.addEventListener('click', this.lock);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('blur', this.clearKeys);
    this.applyCamera();
    this.lock();
  }

  stop() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.host.element.removeEventListener('click', this.lock);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('blur', this.clearKeys);
    if (document.pointerLockElement === this.host.element) document.exitPointerLock();
    this.keys.clear();
  }

  /** Recomputes the collision meshes (after hiding elements, changing layers, etc.). */
  refresh() {
    this.colliders = this.host.colliders();
  }

  get locked() { return document.pointerLockElement === this.host.element; }

  // --- input ---------------------------------------------------------------

  private lock = () => {
    if (!this.locked) this.host.element.requestPointerLock?.();
  };

  private onLockChange = () => this.host.onChange();

  private clearKeys = () => this.keys.clear();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.code;
    if (k === 'KeyV') {
      this.fly = !this.fly;
      this.vz = 0;
      this.host.onChange();
      return;
    }
    if (/^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/.test(k)) {
      this.keys.add(k);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.yaw -= e.movementX * LOOK;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK, -1.45, 1.45);
    this.applyCamera();
  };

  // --- simulation ----------------------------------------------------------

  /** Advances dt seconds. Returns true if the camera changed. */
  update(dt: number): boolean {
    dt = Math.min(dt, 0.05); // avoids jumps after a pause
    const k = this.keys;
    const fb = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const lr = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const before = this.pos.clone();

    const fwd = new THREE.Vector3(Math.cos(this.yaw), Math.sin(this.yaw), 0);
    const right = new THREE.Vector3(Math.sin(this.yaw), -Math.cos(this.yaw), 0);
    const move = fwd.multiplyScalar(fb).add(right.multiplyScalar(lr));

    if (this.fly) {
      if (this.pitch && fb) move.z = Math.tan(this.pitch) * fb; // in flight the walker moves where it looks
      const ud = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      move.z += ud;
      if (move.lengthSq()) this.pos.addScaledVector(move.normalize(), FLY * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1) * dt);
    } else {
      if (move.lengthSq()) {
        const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
        const step = move.normalize().multiplyScalar(speed * dt);
        // if the full direction collides, try sliding along the wall
        for (const d of [step, new THREE.Vector3(step.x, 0, 0), new THREE.Vector3(0, step.y, 0)]) {
          if (d.lengthSq() > 1e-12 && this.free(d)) { this.pos.add(d); break; }
        }
      }
      this.applyGravity(dt);
    }

    const changed = !before.equals(this.pos);
    if (changed) this.applyCamera();
    return changed || this.keys.size > 0;
  }

  /** Can the walker move horizontally `d` without colliding? It is checked at knee and chest heights. */
  private free(d: THREE.Vector3): boolean {
    const dir = d.clone().normalize();
    const feet = this.pos.z - EYE;
    for (const h of [STEP + 0.05, 1.0, EYE - 0.1]) {
      this.ray.set(new THREE.Vector3(this.pos.x, this.pos.y, feet + h), dir);
      this.ray.far = d.length() + RADIUS;
      if (this.ray.intersectObjects(this.colliders, false).length) return false;
    }
    return true;
  }

  private floorBelow(): number {
    // from eye height downwards: the first floor below knees + step
    this.ray.set(new THREE.Vector3(this.pos.x, this.pos.y, this.pos.z - EYE + STEP), new THREE.Vector3(0, 0, -1));
    this.ray.far = 1000;
    const hit = this.ray.intersectObjects(this.colliders, false)[0];
    return Math.max(hit ? hit.point.z : -Infinity, this.host.groundZ());
  }

  private applyGravity(dt: number) {
    const floor = this.floorBelow();
    const feet = this.pos.z - EYE;
    if (feet <= floor + 0.02) {
      // on the floor: climbs steps smoothly and cancels the fall
      this.vz = 0;
      const target = floor + EYE;
      this.pos.z += (target - this.pos.z) * Math.min(1, dt * 15);
      if (Math.abs(target - this.pos.z) < 0.002) this.pos.z = target;
    } else {
      this.vz -= GRAVITY * dt;
      this.pos.z = Math.max(this.pos.z + this.vz * dt, floor + EYE);
    }
  }

  private applyCamera() {
    const cam = this.host.camera;
    const dir = new THREE.Vector3(
      Math.cos(this.pitch) * Math.cos(this.yaw),
      Math.cos(this.pitch) * Math.sin(this.yaw),
      Math.sin(this.pitch),
    );
    cam.position.copy(this.pos);
    cam.up.set(0, 0, 1);
    cam.lookAt(this.pos.clone().add(dir));
    this.host.requestRender();
  }

  /** Current point and orientation, to return to the orbit looking at the same thing. */
  view() {
    const dir = new THREE.Vector3(Math.cos(this.yaw), Math.sin(this.yaw), Math.tan(this.pitch)).normalize();
    return { position: this.pos.clone(), target: this.pos.clone().addScaledVector(dir, 5) };
  }
}

export const WALK_EYE = EYE;
