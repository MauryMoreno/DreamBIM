import * as THREE from 'three';
import type { ComposedNode } from '../../ifcx/types';
import { meshGeometryOf } from '../geometry';
import { perfSpan } from '../perf';
import type { ViewerCore } from './core';

/** Batch and mirror machinery the level of detail rebuilds through. */
export interface ViewerLodHost {
  nodes: Map<string, ComposedNode>;
  drawnMeshes(): THREE.Mesh[];
  /** Rebuilds the batches and the mirrors for the given draw geometries. */
  rebuildDraw(geometries: Map<THREE.Mesh, THREE.BufferGeometry>): void;
}

/** Level of detail of the drawn meshes, independent of picking, measurement and edges. */
export class ViewerLod {
  private lod = 0;

  constructor(private core: ViewerCore, private host: ViewerLodHost) {}

  /** Level of detail being drawn (0 = the original mesh). */
  get lodLevel() { return this.lod; }

  /** Levels of detail the model has besides the original (keys of `studio::lod`), sorted. */
  lodLevels(): number[] {
    const out = new Set<number>();
    for (const node of this.host.nodes.values()) {
      const lods = node.attributes['studio::lod'];
      if (!lods || typeof lods !== 'object') continue;
      for (const k of Object.keys(lods)) if (Number.isInteger(Number(k)) && Number(k) !== 0) out.add(Number(k));
    }
    return [...out].sort((a, b) => a - b);
  }

  /**
   * Sets the level of detail of every mesh: `force` is the `studio::lod` level (0 = original, 1, 2…
   * = simplified, -1 = refined); each mesh uses the nearest one it has. It only changes what is
   * drawn: selection, measurement and edges still work on the original mesh.
   */
  setLod(o: { enabled: boolean; force?: number }) {
    const level = o.enabled ? o.force ?? 0 : 0;
    if (level === this.lod) return;
    this.lod = level;
    perfSpan('viewer.lod', () => this.host.rebuildDraw(this.lodGeometries()));
    this.core.requestRender();
  }

  /** Geometry of the current level of detail for the meshes that have it and differ from the original. */
  lodGeometries(): Map<THREE.Mesh, THREE.BufferGeometry> {
    const out = new Map<THREE.Mesh, THREE.BufferGeometry>();
    if (!this.lod) return out;
    for (const m of this.host.drawnMeshes()) {
      const node = this.host.nodes.get(m.userData.path);
      if (!node?.attributes['studio::lod']) continue;
      const g = meshGeometryOf(node, m.userData.baseMaterial, this.lod);
      if (g !== m.geometry) out.set(m, g);
    }
    return out;
  }
}
