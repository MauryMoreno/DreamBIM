import * as THREE from 'three';
import type { ViewerCore } from './core';

/** Sun, ambient lights and the shadow-only ground under the model. */
export class ViewerSun {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1.2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.6);
  // Shaded light (like Revit): ambient plus a view-relative sun; off in the other styles
  readonly shadeAmbient = new THREE.AmbientLight(0xffffff, 0);
  readonly shadeSun = new THREE.DirectionalLight(0xffffff, 0);
  private ground: THREE.Mesh | null = null; // receives the shadows under the model
  private shadows = false;

  constructor(private core: ViewerCore, private bbox: THREE.Box3) {
    core.scene.add(this.hemi, this.shadeAmbient, this.shadeSun, this.shadeSun.target);
    this.sun.position.set(5, -8, 10);
    this.sun.shadow.mapSize.set(4096, 4096);
    core.scene.add(this.sun, this.sun.target);
  }

  get shadowsOn() { return this.shadows; }

  setShadows(on: boolean) {
    this.shadows = on;
    this.sun.castShadow = on;
    if (this.ground) this.ground.visible = on;
    this.core.requestRender();
  }

  /** Places the sun and its shadow camera so they cover the whole model. */
  updateSun() {
    if (this.ground) {
      this.core.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground = null;
    }
    if (this.bbox.isEmpty()) return;
    const center = this.bbox.getCenter(new THREE.Vector3());
    const radius = Math.max(this.bbox.getSize(new THREE.Vector3()).length() / 2, 1);
    // a high sun from the south-east (with Y = north), about 50 degrees above the horizon
    const dir = new THREE.Vector3(0.55, -0.6, 0.95).normalize();
    this.sun.position.copy(center).addScaledVector(dir, radius * 2);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -radius * 1.05;
    cam.right = cam.top = radius * 1.05;
    cam.near = radius * 0.5;
    cam.far = radius * 3.5;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = Math.max(0.01, radius * 0.0008);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 6, radius * 6),
      new THREE.ShadowMaterial({ opacity: 0.25 }));
    ground.position.set(center.x, center.y, this.bbox.min.z - 0.005);
    ground.receiveShadow = true;
    ground.visible = this.shadows;
    this.ground = ground;
    this.core.scene.add(ground);
  }
}
