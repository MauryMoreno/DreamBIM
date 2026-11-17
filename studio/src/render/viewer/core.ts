import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ComposedNode } from '../../ifcx/types';
import { setTextureListener } from '../geometry';

/**
 * Objects and services the viewer subsystems share: the three.js scene, camera, renderer and orbit
 * controls, the host element, the logical object index, and the render/dispose hooks.
 */
export class ViewerCore {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  /** Logical model tree: stays out of the scene, drawn through batches, mirrors and edge lines. */
  readonly objects = new Map<string, THREE.Object3D>();
  readonly nodes = new Map<string, ComposedNode>();
  /** Everything that can be picked, in build order. */
  pickables: THREE.Object3D[] = [];
  /** Set by requestRender and cleared by the loop right before a frame is drawn. */
  needsRender = true;
  private disposers: (() => void)[] = [];

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // the shadow map is always enabled; sun.castShadow turns it on or off per style
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6);
    this.camera.up.set(0, 0, 1); // IFC / USD: Z up
    this.camera.position.set(20, -20, 15);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // short inertia (0.15 made the camera lag behind the cursor and the view feel rubbery) and zoom
    // towards the cursor, not the centre: the point under the mouse stays under the mouse
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.3;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());

    setTextureListener(() => this.requestRender());
  }

  requestRender(): void {
    this.needsRender = true;
  }

  /** Drawable objects of the subtree of each root (without repeats). */
  drawablesUnder(roots: Iterable<THREE.Object3D | null | undefined>): Set<THREE.Object3D> {
    const out = new Set<THREE.Object3D>();
    for (const r of roots) r?.traverse((o) => { if (o.userData.baseMaterial) out.add(o); });
    return out;
  }

  /** Registers a cleanup to run when the viewer is disposed. */
  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers = [];
  }
}
