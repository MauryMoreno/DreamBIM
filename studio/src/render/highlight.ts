// Highlighting (hover and selection) without touching the batches: each highlighted mesh is drawn with
// a loose copy (same geometry, highlight material) and its batch instance is hidden (whoever builds the
// batches passes `isDrawn = m => isShown(m) && !highlights.has(m)`). Thus moving the mouse over the
// model does not copy geometries into highlight batches or grow them: there are only as many copies as
// highlighted meshes.
import * as THREE from 'three';

export class Highlights {
  readonly root = new THREE.Group();
  private items = new Map<THREE.Mesh, THREE.Mesh>();

  constructor() {
    this.root.name = 'highlights';
  }

  /** Highlights the mesh with `mat`, or removes its highlight (null). true if anything changed. */
  set(m: THREE.Mesh, mat: THREE.Material | null): boolean {
    const cur = this.items.get(m);
    if (!mat) {
      if (!cur) return false;
      this.root.remove(cur);
      this.items.delete(m);
      return true;
    }
    if (cur) {
      if (cur.material === mat) return false;
      cur.material = mat;
      cur.castShadow = castsShadow(mat);
      return true;
    }
    const c = new THREE.Mesh(m.geometry, mat);
    c.matrixAutoUpdate = false;
    c.raycast = () => {}; // the model mesh is selected, not the copy
    c.castShadow = castsShadow(mat);
    this.items.set(m, c);
    this.root.add(c);
    return true;
  }

  has(m: THREE.Object3D): boolean {
    return this.items.has(m as THREE.Mesh);
  }

  get size(): number {
    return this.items.size;
  }

  /** Copies visibility, received shadow and world matrix to the copies (those in `only`, when given). */
  sync(isShown: (o: THREE.Object3D) => boolean, only?: Iterable<THREE.Object3D>): void {
    if (!this.items.size) return;
    for (const o of only ?? this.items.keys()) {
      const c = this.items.get(o as THREE.Mesh);
      if (!c) continue;
      c.visible = isShown(o);
      c.receiveShadow = o.receiveShadow;
      c.matrix.copy(o.matrixWorld);
    }
  }

  clear(): void {
    this.root.clear();
    this.items.clear();
  }
}

/** Transparent things cast no shadow (as in the rest of the viewer). */
function castsShadow(mat: THREE.Material) {
  return mat.visible && !mat.transparent;
}
