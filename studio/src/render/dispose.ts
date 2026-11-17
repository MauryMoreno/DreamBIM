import * as THREE from 'three';

export interface GpuResources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
}

/**
 * Geometries, materials and textures a subtree uses (without repeats). The materials in `exclude`
 * (the viewer highlight ones, for instance, reused between models) are skipped. Both the current
 * material and `userData.baseMaterial` (the element's original) are looked at.
 */
export function collectResources(root: THREE.Object3D, exclude: Iterable<THREE.Material> = []): GpuResources {
  const skip = new Set(exclude);
  const out: GpuResources = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const addMaterial = (m: unknown) => {
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (!(mat instanceof THREE.Material) || skip.has(mat) || out.materials.has(mat)) continue;
      out.materials.add(mat);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) out.textures.add(v);
    }
  };
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g instanceof THREE.BufferGeometry) out.geometries.add(g);
    addMaterial((o as THREE.Mesh).material);
    addMaterial(o.userData.baseMaterial);
  });
  return out;
}

/** Frees the collected resources on the GPU. If they are used again, three.js uploads them anew. */
export function disposeResources(r: GpuResources): void {
  r.geometries.forEach((g) => g.dispose());
  r.materials.forEach((m) => m.dispose());
  r.textures.forEach((t) => t.dispose());
}
