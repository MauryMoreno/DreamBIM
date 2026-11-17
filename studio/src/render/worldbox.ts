// Axis-aligned box of a mesh in world coordinates. No WebGL, so it can be tested in node.
import * as THREE from 'three';

/** [minX, minY, minZ, maxX, maxY, maxZ] in metres. Uses `matrixWorld`: the caller keeps it up to date. */
export type WorldBox = [number, number, number, number, number, number];

export function worldBox(mesh: THREE.Mesh): WorldBox {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const b = new THREE.Box3().copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld);
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
}
