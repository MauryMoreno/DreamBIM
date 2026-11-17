import * as THREE from 'three';

/** Angle threshold (degrees) to consider an edge; the same the viewer used per mesh. */
const EDGE_THRESHOLD = 20;

const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Edges of a geometry, computed once and shared by every mesh that uses it. */
export function edgesOf(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let e = cache.get(g);
  if (!e) {
    e = new THREE.EdgesGeometry(g, EDGE_THRESHOLD);
    cache.set(g, e);
  }
  return e;
}

/**
 * Fuses the edges of every mesh into one segment geometry, in world coordinates (uses `matrixWorld`,
 * which the caller must keep up to date). With no meshes it returns an empty geometry.
 */
export function mergeEdges(items: Iterable<THREE.Mesh>): THREE.BufferGeometry {
  const meshes = Array.isArray(items) ? (items as THREE.Mesh[]) : [...items];
  let total = 0;
  for (const m of meshes) total += edgesOf(m.geometry).getAttribute('position').count;
  const out = new Float32Array(total * 3);
  const v = new THREE.Vector3();
  let o = 0;
  for (const m of meshes) {
    const pos = edgesOf(m.geometry).getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      out[o++] = v.x;
      out[o++] = v.y;
      out[o++] = v.z;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

export interface EdgeRules {
  /** The visual style draws edges (Wireframe, Hidden Line). */
  styleEdges: boolean;
  /** Wall or column cut in the plan: always carries its border (its fill is the background colour). */
  isCut(o: THREE.Object3D): boolean;
  /** Dimmed storey of the plan: never carries edges. */
  isUnderlay(o: THREE.Object3D): boolean;
  /** Drawn (visible with its whole chain and on layer 0). */
  isShown(o: THREE.Object3D): boolean;
}

/** Meshes that carry edges: `(style with edges || cut) && !underlay && shown`. */
export function edgeMeshes(objs: Iterable<THREE.Object3D>, r: EdgeRules): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const o of objs) {
    if (!(o instanceof THREE.Mesh)) continue;
    if ((r.styleEdges || r.isCut(o)) && !r.isUnderlay(o) && r.isShown(o)) out.push(o);
  }
  return out;
}

/** The same meshes in the same order? (if the set with edges did not change, no need to fuse again) */
export function sameMeshes(a: readonly THREE.Mesh[], b: readonly THREE.Mesh[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
