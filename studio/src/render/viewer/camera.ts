import * as THREE from 'three';
import { animOffset, orthoDistance, type CameraState } from '../levels';
import { WALK_EYE, WalkMode } from '../walk';
import type { ViewerCore } from './core';

export type ViewName = 'iso' | 'top' | 'front' | 'right';

const PERSPECTIVE_FOV = 45;
const ORTHO_FOV = 2; // pseudo-orthographic: a very narrow telephoto from far away

/** Rest of the viewer the camera needs to frame, walk and animate through. */
interface CameraPeers {
  readonly bbox: THREE.Box3;
  readonly objects: Map<string, THREE.Object3D>;
  /** Selected path, reframed on orient. */
  selected(): string | null;
  /** Logical model tree, used to frame the whole model. */
  modelRoot(): THREE.Object3D;
  explodeAmount(): number;
  /** Undoes the explosion (walking over an exploded model makes no sense). */
  resetExplode(): void;
  /** Clears the hover highlight (and tells the host). */
  clearHover(): void;
  /** Meshes the walker collides with. */
  colliders(): THREE.Object3D[];
  requestRender(): void;
  onWalkChange(): void;
  onExplodeReset(): void;
}

/**
 * Orbit camera, framing, projection and first-person walk. The orthographic projection is really a
 * perspective camera with a 2 degree fov pulled back far enough that the framing does not change.
 */
export class ViewerCamera {
  private walk: WalkMode | null = null;
  private orbitState: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
  private proj: 'perspective' | 'orthographic' = 'perspective';
  private anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; start: number } | null = null;
  private raycaster = new THREE.Raycaster();

  constructor(private core: ViewerCore, private peers: CameraPeers) {}

  /** Frames a node (or the whole model) with a short animation, from `from` if given (else from where it looks). */
  fit(path?: string | string[] | null, animate = true, from?: THREE.Vector3) {
    const box = new THREE.Box3();
    if (path) {
      for (const p of Array.isArray(path) ? path : [path]) {
        const o = this.peers.objects.get(p);
        if (o) box.expandByObject(o);
      }
    } else {
      this.peers.modelRoot().traverseVisible(o => { if (o.userData.baseMaterial) box.expandByObject(o, false); });
      if (box.isEmpty()) box.copy(this.peers.bbox);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    const dir = (from?.clone() ?? this.core.camera.position.clone().sub(this.core.controls.target)).normalize();
    if (dir.lengthSq() === 0) dir.set(1, -1, 0.8).normalize();
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.core.camera.fov / 2)) * 1.05;
    this.moveCamera(center.clone().add(dir.multiplyScalar(dist)), center, animate);
  }

  view(name: ViewName) {
    const dirs: Record<ViewName, THREE.Vector3> = {
      iso: new THREE.Vector3(1, -1, 0.8),
      top: new THREE.Vector3(0, -0.0001, 1),
      front: new THREE.Vector3(0, -1, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    this.orient(dirs[name]);
  }

  /**
   * Turns the camera until it looks at the target from `dir` (world, Z up) and reframes. A purely
   * vertical direction gives OrbitControls no azimuth: it tilts a little towards the current azimuth
   * rounded to 90 degrees, so the plan keeps one side of the model at the bottom, as in Revit.
   */
  orient(dir: THREE.Vector3) {
    const d = dir.clone().normalize();
    if (Math.hypot(d.x, d.y) < 1e-6) {
      const off = this.core.camera.position.clone().sub(this.core.controls.target);
      const az = Math.round(Math.atan2(off.y, off.x) / (Math.PI / 2)) * (Math.PI / 2);
      d.set(Math.cos(az) * 1e-4, Math.sin(az) * 1e-4, Math.sign(d.z)).normalize();
    }
    this.fit(this.peers.selected(), true, d);
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    const r = pos.distanceTo(target);
    this.core.camera.near = Math.max(r / 1e4, 1e-3);
    this.core.camera.far = Math.max(r * 100, this.peers.bbox.getSize(new THREE.Vector3()).length() * 10);
    this.core.camera.updateProjectionMatrix();
    if (!animate) {
      this.core.camera.position.copy(pos);
      this.core.controls.target.copy(target);
      this.core.controls.update();
      return;
    }
    this.anim = { from: this.core.camera.position.clone(), to: pos, tFrom: this.core.controls.target.clone(), tTo: target, start: performance.now() };
    this.peers.requestRender();
  }

  get projection() { return this.proj; }

  /**
   * 'orthographic' is pseudo-orthographic: fov of 2 degrees and the camera pulled away from the target
   * just enough that the framing does not change. It is still a PerspectiveCamera, so fit, pick, orbit
   * and walk work the same. 'perspective' goes back to 45 degrees and the equivalent distance.
   */
  setProjection(mode: 'perspective' | 'orthographic') {
    if (mode === this.proj) return;
    if (this.walk) this.exitWalk(); // walking is always perspective
    this.finishAnim();
    const fov = mode === 'orthographic' ? ORTHO_FOV : PERSPECTIVE_FOV;
    const target = this.core.controls.target.clone();
    const offset = this.core.camera.position.clone().sub(target);
    const dist = offset.length() || 1;
    offset.multiplyScalar(orthoDistance(dist, this.core.camera.fov, fov) / dist);
    this.proj = mode;
    this.core.camera.fov = fov;
    this.moveCamera(target.clone().add(offset), target, false); // also adjusts near/far
    this.peers.requestRender();
  }

  /** Position, target, fov and projection of the orbit view (during the walk, those of the walker). */
  getCameraState(): CameraState {
    // while an animation runs, its destination counts
    const { position, target } = this.walk ? this.walk.view()
      : this.anim ? { position: this.anim.to, target: this.anim.tTo }
      : { position: this.core.camera.position, target: this.core.controls.target };
    return {
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      fov: this.walk ? (this.orbitState?.fov ?? PERSPECTIVE_FOV) : this.core.camera.fov,
      projection: this.proj,
    };
  }

  /** Places the camera as it is, without animating. */
  setCameraState(s: CameraState) {
    if (this.walk) this.exitWalk();
    this.anim = null;
    this.proj = s.projection;
    this.core.camera.fov = s.fov > 0 && s.fov < 180 ? s.fov : (s.projection === 'orthographic' ? ORTHO_FOV : PERSPECTIVE_FOV);
    this.moveCamera(new THREE.Vector3(...s.position), new THREE.Vector3(...s.target), false);
    this.core.controls.update();
    this.peers.requestRender();
  }

  /** Turns mouse orbit on or off (while dragging a gizmo, for instance). No effect while walking. */
  setControlsEnabled(on: boolean) {
    if (!this.walk) this.core.controls.enabled = on;
  }

  /** Takes a running camera animation to its end (to measure distances on the destination). */
  private finishAnim() {
    if (!this.anim) return;
    this.core.camera.position.copy(this.anim.to);
    this.core.controls.target.copy(this.anim.tTo);
    this.anim = null;
  }

  get walking() { return this.walk !== null; }
  get walkLocked() { return this.walk?.locked ?? false; }
  get walkFlying() { return this.walk?.fly ?? false; }

  /** Enters the walk, on foot over the floor being looked at (or the lowest one under the centre). */
  enterWalk(): boolean {
    if (this.walk || this.peers.bbox.isEmpty()) return false;
    if (this.proj === 'orthographic') this.setProjection('perspective'); // walking is always perspective
    if (this.peers.explodeAmount()) this.peers.resetExplode(); // walk over the assembled model
    this.peers.onExplodeReset();
    this.peers.clearHover();
    this.orbitState = { position: this.core.camera.position.clone(), target: this.core.controls.target.clone(), fov: this.core.camera.fov };
    this.core.controls.enabled = false;
    this.anim = null;

    const walk = new WalkMode({
      camera: this.core.camera,
      element: this.core.renderer.domElement,
      colliders: () => this.peers.colliders(),
      groundZ: () => this.peers.bbox.min.z,
      requestRender: () => this.peers.requestRender(),
      onChange: () => this.peers.onWalkChange(),
    });
    this.walk = walk;
    const colliders = this.peers.colliders();
    const floor = this.floorUnderView(colliders) ?? this.lowestFloor(colliders, this.core.controls.target);
    const dir = this.core.controls.target.clone().sub(this.core.camera.position);
    this.core.camera.fov = 70;
    this.core.camera.near = 0.05;
    this.core.camera.updateProjectionMatrix();
    walk.start(new THREE.Vector3(floor.x, floor.y, floor.z + WALK_EYE), Math.atan2(dir.y, dir.x));
    this.peers.onWalkChange();
    return true;
  }

  exitWalk() {
    if (!this.walk) return;
    const view = this.walk.view();
    this.walk.stop();
    this.walk = null;
    this.core.controls.enabled = true;
    this.core.camera.fov = this.orbitState?.fov ?? PERSPECTIVE_FOV;
    this.core.camera.updateProjectionMatrix();
    // the orbit stays where the walker was, looking at the same thing
    this.core.camera.position.copy(view.position);
    this.core.controls.target.copy(view.target);
    this.core.camera.up.set(0, 0, 1);
    this.core.controls.update();
    this.peers.onWalkChange();
    this.peers.requestRender();
  }

  /** Recomputes the walk colliders (after hiding elements, changing classes, etc.). */
  refreshWalk() {
    this.walk?.refresh();
  }

  /** Advances walking, camera animation and orbit damping; true when the view moved. */
  advance(dt: number): boolean {
    let moved = false;
    if (this.walk) {
      if (this.walk.update(dt)) moved = true;
    } else if (this.anim) {
      const t = Math.min((performance.now() - this.anim.start) / 450, 1);
      const k = 1 - Math.pow(1 - t, 3);
      this.core.controls.target.lerpVectors(this.anim.tFrom, this.anim.tTo, k);
      this.core.camera.position.copy(this.core.controls.target).add(animOffset(this.anim, k));
      if (t >= 1) this.anim = null;
      moved = true;
    }
    if (!this.walk && this.core.controls.update()) moved = true;
    return moved;
  }

  /** Floor (almost horizontal face) at the centre of the screen, if one is being looked at. */
  private floorUnderView(colliders: THREE.Object3D[]): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.core.camera);
    const hit = this.raycaster.intersectObjects(colliders, false)[0];
    return hit && Math.abs(upward(hit)) > 0.7 ? hit.point : null;
  }

  /** The lowest floor under a point (ground floor), or the model base if there is none. */
  private lowestFloor(colliders: THREE.Object3D[], at: THREE.Vector3): THREE.Vector3 {
    this.raycaster.set(new THREE.Vector3(at.x, at.y, this.peers.bbox.max.z + 1), new THREE.Vector3(0, 0, -1));
    const floors = this.raycaster.intersectObjects(colliders, false).filter(h => upward(h) > 0.7);
    const z = floors.length ? floors[floors.length - 1].point.z : this.peers.bbox.min.z;
    return new THREE.Vector3(at.x, at.y, z);
  }
}

/** Z component of the hit face normal, in world coordinates. */
function upward(hit: THREE.Intersection): number {
  if (!hit.face) return 0;
  return hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize().z;
}
