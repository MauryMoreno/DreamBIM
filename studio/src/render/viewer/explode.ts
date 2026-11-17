import * as THREE from 'three';
import { displayName } from '../../ifcx/names';
import { sortLevels, type LevelInfo } from '../levels';
import type { ViewerCore } from './core';
import { SPATIAL } from './quantities';

export type ExplodeMode = 'storeys' | 'elements' | 'both';

/** Model machinery the explosion moves through. */
export interface ViewerExplodeHost {
  /** Leaves the first-person walk (walking an exploded model makes no sense). */
  exitWalk(): void;
  /** Refreshes the model root world matrices and the drawn batches and mirrors. */
  updateModelTransforms(): void;
  /** Marks the fused edges dirty when there are any. */
  markEdgesMoved(): void;
}

interface ExplodePart {
  obj: THREE.Object3D;
  base: THREE.Matrix4; // original matrix (no explosion)
  center: THREE.Vector3; // world centre without explosion
  box: THREE.Box3;
}

/** Exploded view: moves the drawing matrices only; the data and the tree are untouched. */
export class ViewerExplode {
  private state: { storeys: ExplodePart[]; elements: ExplodePart[] | null; storeyGap: number } | null = null;
  private explodeAmount = 0;
  private explodeMode: ExplodeMode = 'storeys';

  constructor(private core: ViewerCore, private bbox: THREE.Box3, private host: ViewerExplodeHost) {}

  /** Current separation amount in [0, 1]. */
  get amount() { return this.explodeAmount; }

  get mode() { return this.explodeMode; }

  /** Forgets the cached parts so the next explosion is measured on the new model. */
  reset() {
    this.state = null;
  }

  /**
   * Separates the model: 'storeys' lifts each storey, 'elements' moves each element away from the
   * centre. amount in [0, 1]. It only changes drawing matrices: the data and the tree are untouched.
   */
  setExplode(amount: number, mode: ExplodeMode = this.explodeMode) {
    this.explodeAmount = amount;
    this.explodeMode = mode;
    this.applyExplode();
  }

  /** Reapplies the current explosion (used after a model change). */
  apply() {
    this.applyExplode();
  }

  /**
   * Storeys (IfcBuildingStorey with geometry) from bottom to top. The boxes are those of
   * explodeParts(), computed once per model before moving anything, so they do not depend on the
   * active explosion. Element boxes are not computed.
   */
  levels(): LevelInfo[] {
    return sortLevels(this.explodeParts().storeys.map(s => {
      const path = s.obj.userData.path as string;
      const node = this.core.nodes.get(path);
      return { path, name: node ? displayName(node) : path, minZ: s.box.min.z, maxZ: s.box.max.z };
    }));
  }

  /** XY footprint (metres) of the model box; null if the model has no geometry. */
  get modelFootprint(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const b = this.bbox;
    return b.isEmpty() ? null : { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y };
  }

  /** Are there storeys to separate? (if not, only 'elements' makes sense) */
  get storeyCount() { return this.explodeParts().storeys.length; }

  /** Storeys (with their un-exploded box) and the gap between them; elements are separate. */
  private explodeParts() {
    if (this.state) return this.state;
    const storeys: ExplodePart[] = [];
    for (const obj of this.core.objects.values()) {
      if (obj.userData.ownClass !== 'IfcBuildingStorey') continue;
      const part = partOf(obj);
      if (part) storeys.push(part);
    }
    storeys.sort((a, b) => a.box.min.z - b.box.min.z);
    const heights = storeys.map(s => s.box.max.z - s.box.min.z).filter(h => h > 0.5).sort((a, b) => a - b);
    const typical = heights.length ? heights[Math.floor(heights.length / 2)] : 3;
    this.state = { storeys, elements: null, storeyGap: typical * 1.5 };
    return this.state;
  }

  /**
   * Top-level elements: with a class, not spatial structure and not inside another element. Their
   * boxes are computed the first time they are needed, before moving anything.
   */
  private explodeElements(): ExplodePart[] {
    const state = this.explodeParts();
    if (state.elements) return state.elements;
    const elements: ExplodePart[] = [];
    for (const obj of this.core.objects.values()) {
      const cls = obj.userData.ownClass as string | undefined;
      if (!cls || SPATIAL.has(cls) || hasElementAncestor(obj)) continue;
      const part = partOf(obj);
      if (part) elements.push(part);
    }
    state.elements = elements;
    return elements;
  }

  private applyExplode() {
    this.host.exitWalk(); // walking over an exploded model makes no sense
    const { storeys, storeyGap } = this.explodeParts();
    // the elements, from the first real explosion (also by storeys: if the mode is changed later with
    // the storeys already moved, their boxes would come out displaced)
    const needElements = this.explodeAmount > 0 || this.explodeMode !== 'storeys';
    const elements = needElements ? this.explodeElements() : (this.explodeParts().elements ?? []);
    const t = this.explodeAmount;
    const center = this.bbox.getCenter(new THREE.Vector3());
    const reach = this.bbox.getSize(new THREE.Vector3()).length() * 0.6;
    const offsets = new Map<ExplodePart, THREE.Vector3>();

    if (this.explodeMode !== 'elements') {
      storeys.forEach((s, i) => offsets.set(s, new THREE.Vector3(0, 0, i * storeyGap * t)));
    }
    if (this.explodeMode !== 'storeys') {
      for (const e of elements) {
        // horizontally, proportional to the distance from the centre (outer parts move further)
        const d = e.center.clone().sub(center);
        d.z = 0;
        const len = d.length();
        if (len < 1e-6) continue;
        offsets.set(e, d.multiplyScalar((reach * t * (0.3 + len / reach)) / len));
      }
    }
    for (const part of [...storeys, ...elements]) {
      const off = offsets.get(part);
      part.obj.matrixAutoUpdate = false;
      if (!off || off.lengthSq() === 0) {
        part.obj.matrix.copy(part.base);
        continue;
      }
      // the offset is in world space: convert it to the parent's frame (rotation only)
      const parentRot = new THREE.Matrix4().extractRotation(part.obj.parent!.matrixWorld).invert();
      const local = off.clone().applyMatrix4(parentRot);
      part.obj.matrix.copy(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z).multiply(part.base));
    }
    this.host.updateModelTransforms();
    this.host.markEdgesMoved();
    this.core.requestRender();
  }
}

/** Explosion part: the base matrix and the current world box/centre; null if it has no geometry. */
function partOf(obj: THREE.Object3D): ExplodePart | null {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  return { obj, base: obj.matrix.clone(), center: box.getCenter(new THREE.Vector3()), box };
}

function hasElementAncestor(obj: THREE.Object3D): boolean {
  for (let p = obj.parent; p; p = p.parent) {
    const cls = p.userData.ownClass as string | undefined;
    if (cls && !SPATIAL.has(cls)) return true;
  }
  return false;
}
