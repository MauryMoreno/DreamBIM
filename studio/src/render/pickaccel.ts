import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, type MeshBVHOptions } from 'three-mesh-bvh';

const sphere = new THREE.Sphere();

/**
 * Speeds up a mesh raycast with a BVH built on demand: only when a ray crosses its world bounding
 * sphere, and once per geometry (meshes sharing it reuse the same `boundsTree`). It is `indirect`:
 * the tree sorts its own index buffer and does not touch the geometry index, so a non-indexed
 * geometry stays without one (its `layoutOf` does not change). Hits (point, distance, object, face)
 * are those of the three raycast.
 */
export function accelerate(mesh: THREE.Mesh): void {
  mesh.raycast = function (this: THREE.Mesh, raycaster, intersects) {
    const geo = this.geometry;
    if (geo.boundingSphere === null) geo.computeBoundingSphere();
    sphere.copy(geo.boundingSphere!).applyMatrix4(this.matrixWorld);
    if (!raycaster.ray.intersectsSphere(sphere)) return;
    if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo, { indirect: true } as MeshBVHOptions);
    acceleratedRaycast.call(this, raycaster, intersects);
  };
}
