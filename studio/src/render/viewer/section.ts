import * as THREE from 'three';
import type { LevelFocus } from '../levels';
import { SectionBox } from '../sectionbox';
import type { ViewerCore } from './core';

/** State the section reads from the rest of the viewer. */
interface SectionPeers {
  readonly bbox: THREE.Box3;
  /** Level plan in force (its clipping is applied per material); null when there is none. */
  levelFocus(): LevelFocus | null;
  /** Viewer materials that must follow the active clipping planes. */
  materials(): Iterable<THREE.Material>;
}

/** Horizontal section plane and 3D section box, with the clipping planes they put in force. */
export class ViewerSection {
  /** The section box (six planes with handles); exclusive with the horizontal cut. */
  readonly box: SectionBox;
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private enabled = false;
  private boxWanted = false;

  constructor(private core: ViewerCore, private peers: SectionPeers) {
    this.box = new SectionBox(() => this.apply());
  }

  /** t in [0, 1]: cut height relative to the model box. */
  setSection(enabled: boolean, t = 1) {
    this.enabled = enabled;
    this.leaveBox();
    this.plane.constant = THREE.MathUtils.lerp(this.peers.bbox.min.z, this.peers.bbox.max.z, t);
    this.apply();
  }

  /** Like setSection, but with the absolute z elevation (metres) of the cut. */
  setSectionAt(enabled: boolean, z: number) {
    this.enabled = enabled;
    this.leaveBox();
    this.plane.constant = z;
    this.apply();
  }

  /**
   * 3D section box: six planes that keep what is inside, with a handle per face to drag it. Turning it
   * on surrounds the model; it turns the horizontal cut off. With an empty model it waits for one.
   */
  setSectionBox(enabled: boolean) {
    this.boxWanted = enabled;
    if (enabled) {
      this.enabled = false;
      if (!this.box.visible) this.box.setBounds(this.peers.bbox);
    }
    this.box.setVisible(this.boxActive);
    this.apply();
  }

  /** The box clips: it is wanted and there is a model to surround. */
  private get boxActive() {
    return this.boxWanted && !this.peers.bbox.isEmpty();
  }

  /** The horizontal cut takes over from the box. */
  private leaveBox() {
    if (!this.boxWanted) return;
    this.boxWanted = false;
    this.box.setVisible(false);
  }

  /** Clipping planes in force: those of the box, the horizontal cut, or none. */
  private activePlanes(): THREE.Plane[] {
    if (this.boxActive) return this.box.planes;
    return this.enabled ? [this.plane] : [];
  }

  /** Is the point clipped by any active plane? */
  clipped(p: THREE.Vector3): boolean {
    return this.activePlanes().some(pl => pl.distanceToPoint(p) < 0);
  }

  /**
   * Without a level plan the section clips the whole scene; with one, clipping goes per material so the
   * underlay storeys (including the one above) keep showing.
   */
  apply() {
    const active = this.activePlanes();
    // per material (not global) with a level plan and with the box, whose drawing does not clip itself
    const local = active.length > 0 && (!!this.peers.levelFocus() || this.boxActive);
    this.core.renderer.localClippingEnabled = local;
    this.core.renderer.clippingPlanes = active.length > 0 && !local ? active : [];
    const planes = local ? active : [];
    const mats = new Set<THREE.Material>(this.peers.materials());
    for (const o of this.core.pickables) mats.add(o.userData.baseMaterial as THREE.Material);
    for (const m of mats) {
      if ((m.clippingPlanes?.length ?? 0) === planes.length) continue;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    this.core.requestRender();
  }

  get on() {
    return this.enabled || this.boxActive;
  }

  /** A new model: the box surrounds it again. */
  refreshBounds() {
    this.box.setBounds(this.peers.bbox);
    this.box.setVisible(this.boxActive);
  }

  /** Keeps the box handles a similar size on screen. */
  updateScale(camera: THREE.Camera, target: THREE.Vector3) {
    this.box.updateScale(camera, target);
  }
}
