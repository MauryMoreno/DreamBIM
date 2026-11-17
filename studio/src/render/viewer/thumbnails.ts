import * as THREE from 'three';
import type { ViewerCore } from './core';

/** PNG thumbnails of individual elements, rendered with a separate renderer. */
export class ViewerThumbnails {
  private renderer: THREE.WebGLRenderer | null = null;

  constructor(private core: ViewerCore) {}

  /**
   * PNG data URL of one or more elements on their own, in isometric view, with their original
   * materials (no highlights). Uses a separate renderer: the main view is untouched.
   */
  thumbnail(paths: string[], width = 320, height = 220): string | null {
    const objs = paths.map(p => this.core.objects.get(p)).filter((o): o is THREE.Object3D => !!o);
    if (!objs.length) return null;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.setPixelRatio(1);
    }
    const r = this.renderer;
    r.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.environment = this.core.scene.environment;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    scene.add(sun);
    // light copy that shares geometry and materials (Object3D.clone would serialize userData,
    // which holds the material with its textures: too slow)
    const copyTree = (o: THREE.Object3D, root: boolean): THREE.Object3D => {
      const base = o.userData.baseMaterial as THREE.Material | undefined;
      let c: THREE.Object3D;
      if (o instanceof THREE.Mesh) c = new THREE.Mesh(o.geometry, base ?? o.material);
      else if (o instanceof THREE.Line) c = new THREE.Line(o.geometry, base ?? o.material);
      else if (o instanceof THREE.Points) c = new THREE.Points(o.geometry, o.material);
      else c = new THREE.Group();
      c.matrixAutoUpdate = false;
      c.matrix.copy(root ? o.matrixWorld : o.matrix);
      c.visible = root || (o.visible && !o.userData.classHidden);
      c.userData.drawn = !!base;
      for (const ch of o.children) c.add(copyTree(ch, false));
      return c;
    };
    for (const o of objs) scene.add(copyTree(o, true));
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    scene.traverseVisible(c => { if (c.userData.drawn) box.expandByObject(c, false); });
    if (box.isEmpty()) return null;

    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const cam = new THREE.PerspectiveCamera(30, width / height, radius / 100, radius * 100);
    cam.up.set(0, 0, 1);
    const dir = new THREE.Vector3(1, -1.25, 0.85).normalize();
    cam.position.copy(center).addScaledVector(dir, (radius / Math.sin(THREE.MathUtils.degToRad(15))) * 0.92);
    cam.lookAt(center);
    sun.position.copy(center).add(new THREE.Vector3(radius, -radius * 2, radius * 3));
    sun.target.position.copy(center);
    scene.add(sun.target);

    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    return r.domElement.toDataURL('image/png');
  }
}
