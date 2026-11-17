import * as THREE from 'three';
import type { ComposedNode } from '../../ifcx/types';
import { collectResources, disposeResources } from '../dispose';
import { edgeMeshes, mergeEdges, sameMeshes } from '../edges';
import { geometryKind, isInvisible, transformOf, tryBuildObject } from '../geometry';
import type { LevelFocus } from '../levels';
import { perfSpan } from '../perf';
import { accelerate } from '../pickaccel';
import { StyleMaterials } from '../styles';
import { isShown } from '../visibility';
import { SceneBatches } from '../batches';
import type { ViewerAppearance } from './appearance';
import type { ViewerCore } from './core';
import type { ViewerExplode } from './explode';
import type { ViewerGrid } from './grid';
import type { ViewerLod } from './lod';
import type { ViewerSection } from './section';
import type { ViewerSun } from './sun';
import type { ViewerVisibility } from './visibility';

export interface ModelStats {
  nodes: number;
  meshes: number;
  curves: number;
  points: number;
  triangles: number;
  /** Nodes with geometry that could not be drawn. */
  failed: number;
}

/** Everything the model build, drawings and edges reach in the rest of the viewer. */
interface ModelPeers {
  readonly bbox: THREE.Box3;
  readonly grid: ViewerGrid;
  readonly sun: ViewerSun;
  readonly section: ViewerSection;
  readonly visibility: ViewerVisibility;
  readonly appearance: ViewerAppearance;
  readonly explode: ViewerExplode;
  readonly lod: ViewerLod;
  armFirstFrame(): void;
  exitWalk(): void;
  requestRender(): void;
}

/**
 * Logical model tree and its drawing machinery: batches, mirrors for extras, fused edges, level focus
 * and walking colliders. The logical tree stays out of the scene; the batches, mirrors and edge lines
 * draw it.
 */
export class ViewerModel {
  readonly root = new THREE.Group();
  readonly batches = new SceneBatches();
  readonly extrasRoot = new THREE.Group();
  readonly edgeLines: THREE.LineSegments;
  private mirrors = new Map<THREE.Object3D, THREE.Object3D>();
  private edgesDirty = true;
  private edgeSet: THREE.Mesh[] = [];
  private edgeLookup = new Set<THREE.Object3D>();
  private edgesMoved = true;
  private focus: LevelFocus | null = null;

  constructor(private core: ViewerCore, private peers: ModelPeers) {
    this.extrasRoot.name = 'extras';
    this.edgeLines = new THREE.LineSegments(new THREE.BufferGeometry(), peers.appearance.edgeMaterial);
    this.edgeLines.name = 'edges';
    this.edgeLines.raycast = () => {}; // the meshes, not the edges, are selected
  }

  get levelFocus(): LevelFocus | null {
    return this.focus;
  }

  private get isDrawn(): (o: THREE.Object3D) => boolean {
    return (o) => isShown(o) && !this.peers.appearance.hasHighlight(o);
  }

  setModel(root: ComposedNode | null): ModelStats {
    this.root.clear();
    // what the previous model drew: the apply* syncs do nothing until the rebuild below
    this.batches.dispose();
    this.clearMirrors();
    this.peers.appearance.clearHighlights();
    this.edgesDirty = true;
    this.edgesMoved = true; // new model: always fused again
    this.peers.appearance.resetStyleMaterials(); // those derived from the previous model
    this.peers.explode.reset(); // the new model is built without displacement
    this.core.objects.clear();
    this.core.nodes.clear();
    this.core.pickables = [];
    this.peers.appearance.forgetHover();

    const stats: ModelStats = { nodes: 0, meshes: 0, curves: 0, points: 0, triangles: 0, failed: 0 };
    perfSpan('viewer.build', () => {
      if (root) for (const c of root.children) this.build(c, this.root, stats);
    });

    perfSpan('viewer.bounds', () => {
      this.root.updateMatrixWorld(true);
      this.peers.bbox.setFromObject(this.root);
    });
    this.peers.grid.updateGrid();
    this.peers.sun.updateSun();
    this.peers.section.refreshBounds(); // new model: the box surrounds it again
    this.peers.appearance.pruneSelection();
    this.peers.visibility.prune();
    perfSpan('viewer.apply', () => {
      this.peers.visibility.apply();
      this.applyEdges();
      this.peers.appearance.applyMaterials();
      this.peers.section.apply();
    });
    perfSpan('viewer.batches', () => {
      this.batches.setDrawGeometries(this.peers.lod.lodGeometries()); // the chosen level of detail survives a model change
      this.batches.rebuild(this.drawnMeshes(), this.isDrawn);
      this.buildMirrors();
    });
    if (this.peers.explode.amount) perfSpan('viewer.explode', () => this.peers.explode.apply());
    this.peers.armFirstFrame();
    return stats;
  }

  /**
   * Removes the current model (like setModel(null)) and frees its geometries, materials and textures on
   * the GPU. setModel does not: call this before loading another model to avoid piling up memory.
   * The viewer highlight materials are kept; whatever stays in the geometry.ts caches is uploaded to
   * the GPU again if another model reuses it.
   */
  disposeModel() {
    this.peers.exitWalk();
    const res = collectResources(this.root, this.peers.appearance.visibleMaterials());
    this.setModel(null);
    this.peers.appearance.clearColorCache();
    disposeResources(res);
    for (const g of res.geometries) g.boundsTree = undefined; // the BVH does not survive in the geometry.ts caches
    this.batches.dispose();
    this.clearMirrors();
    this.peers.appearance.clearHighlights();
    this.edgeLines.geometry.dispose();
    this.edgeLines.geometry = new THREE.BufferGeometry();
    this.edgeLines.visible = false;
    this.edgeSet = [];
    this.edgeLookup.clear();
    this.edgesDirty = false; // it is empty already
  }

  /** Model meshes (the ones that go to the batches). */
  drawnMeshes(): THREE.Mesh[] {
    return this.core.pickables.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  }

  /** Rebuilds the batches and mirrors for the given draw geometries (level of detail). */
  rebuildDraw(geometries: Map<THREE.Mesh, THREE.BufferGeometry>) {
    this.batches.setDrawGeometries(geometries);
    this.batches.rebuild(this.drawnMeshes(), this.isDrawn);
    this.buildMirrors();
  }

  /** Drawn copies of curves and points (and of a mesh that does not fit in a batch), with their world matrix. */
  private buildMirrors() {
    this.clearMirrors();
    for (const o of this.core.pickables) {
      if (o instanceof THREE.Mesh && this.batches.batchOf(o)) continue;
      const m = mirrorOf(o);
      if (!m) continue;
      m.matrixAutoUpdate = false;
      m.raycast = () => {};
      this.mirrors.set(o, m);
      this.extrasRoot.add(m);
    }
    this.syncMirrors();
  }

  private clearMirrors() {
    this.extrasRoot.clear();
    this.mirrors.clear();
  }

  /**
   * Copies material, shadow, visibility and world matrix to the mirrors and highlight copies (only
   * those in `only`, when given).
   */
  syncMirrors(only?: Iterable<THREE.Object3D>) {
    const list = only ? [...only] : undefined;
    this.peers.appearance.highlights.sync(isShown, list);
    if (!this.mirrors.size) return;
    for (const o of list ?? this.mirrors.keys()) {
      const m = this.mirrors.get(o) as THREE.Mesh | undefined;
      if (!m) continue;
      m.material = (o as THREE.Mesh).material;
      m.castShadow = o.castShadow;
      m.receiveShadow = o.receiveShadow;
      m.visible = this.isDrawn(o);
      m.matrix.copy(o.matrixWorld);
    }
  }

  private build(node: ComposedNode, parent: THREE.Object3D, stats: ModelStats) {
    stats.nodes++;
    const a = node.attributes;
    if (isInvisible(a)) return;
    const kind = geometryKind(a);
    const built = kind ? tryBuildObject(node, kind) : null;
    const obj = built ?? new THREE.Group();
    if (kind && !built) stats.failed++;
    else if (kind === 'mesh') {
      stats.meshes++;
      accelerate(obj as THREE.Mesh); // BVH on the first ray that crosses it, not on load
      const g = (obj as THREE.Mesh).geometry;
      stats.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    } else if (kind === 'curve') stats.curves++;
    else if (kind === 'points') stats.points++;

    const m = transformOf(a);
    if (m) {
      obj.matrixAutoUpdate = false;
      obj.matrix.copy(m);
    }
    obj.userData.path = node.path;
    obj.userData.cls = ownerClass(node);
    obj.userData.ownClass = (node.attributes['bsi::ifc::class'] as any)?.code;
    if (kind && built) {
      obj.userData.baseMaterial = (obj as THREE.Mesh).material;
      obj.receiveShadow = kind === 'mesh';
      this.core.pickables.push(obj);
    }
    this.core.objects.set(node.path, obj);
    this.core.nodes.set(node.path, node);
    parent.add(obj);
    for (const c of node.children) this.build(c, obj, stats);
  }

  /** three.js object of a node (by its composed path), or null when it is not drawn. */
  objectOf(path: string): THREE.Object3D | null {
    return this.core.objects.get(path) ?? null;
  }

  /** Reports that the matrix of `obj` changed (e.g. the gizmo preview): updates what is drawn. */
  refreshTransforms(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    const moved = this.core.drawablesUnder([obj]);
    const meshes: THREE.Mesh[] = [];
    for (const o of moved) if (o instanceof THREE.Mesh) meshes.push(o);
    this.batches.syncTransforms(meshes);
    this.syncMirrors(moved);
    // only when something with edges moved (moving does not change which meshes carry them)
    if (meshes.some((m) => this.edgeLookup.has(m))) this.edgesDirty = this.edgesMoved = true;
    this.peers.requestRender();
  }

  hasGeometry(path: string) {
    const o = this.core.objects.get(path);
    let found = false;
    o?.traverse(c => { if (c.userData.baseMaterial) found = true; });
    return found;
  }

  /**
   * Storey plan: what hangs from `current` shows normally (and the section clips it), the `underlay`
   * storeys show dimmed in grey, unclipped and unselectable, and the rest is hidden. null shows the
   * whole model again.
   */
  setLevelFocus(focus: LevelFocus | null) {
    this.focus = focus;
    this.peers.visibility.apply();
    this.applyEdges();
    this.peers.appearance.applyMaterials();
    this.peers.section.apply();
  }

  /**
   * Edges of the elements in Wireframe and Hidden Line (and of the cut ones in the plan): render()
   * rebuilds a single fused LineSegments with those of the meshes that carry them (edgeMeshes). The
   * dimmed storeys carry none.
   */
  applyEdges() {
    this.edgesDirty = true;
    this.peers.requestRender();
  }

  /** Runs before drawing: rebuilds the fused edges when they are dirty. */
  prepareEdges() {
    if (!this.edgesDirty) return;
    this.edgesDirty = false;
    perfSpan('viewer.edges', () => this.rebuildEdges());
  }

  /** Rebuilds edgeLines with the edges of the meshes that carry them, in world coordinates. */
  private rebuildEdges() {
    const meshes = edgeMeshes(this.core.pickables, {
      styleEdges: StyleMaterials.showsEdges(this.peers.appearance.style),
      isCut: (o) => this.peers.appearance.isCut(o),
      isUnderlay: (o) => this.peers.appearance.isUnderlay(o),
      isShown,
    });
    // same set and nobody moved: the fused geometry is still valid
    if (!this.edgesMoved && sameMeshes(meshes, this.edgeSet)) return;
    const old = this.edgeLines.geometry;
    this.edgeLines.geometry = meshes.length ? mergeEdges(meshes) : new THREE.BufferGeometry();
    old.dispose();
    this.edgeLines.visible = meshes.length > 0;
    this.edgeSet = meshes;
    this.edgeLookup = new Set(meshes);
    this.edgesMoved = false;
  }

  /**
   * Can there be edges? With a style that draws them, with a storey plan (cut walls) or if some are
   * still drawn (to remove them). If not, hiding or isolating does not have to look at the edges.
   */
  edgesPossible(): boolean {
    return StyleMaterials.showsEdges(this.peers.appearance.style) || !!this.focus || this.edgeSet.length > 0;
  }

  /** Marks the fused edges dirty when there are any. */
  markEdgesMoved() {
    if (this.edgeSet.length) this.edgesDirty = this.edgesMoved = true;
  }

  /** Refreshes the model root world matrices and the drawn batches and mirrors (explosion). */
  updateModelTransforms() {
    this.root.updateMatrixWorld(true);
    this.batches.syncTransforms(this.drawnMeshes());
    this.syncMirrors();
  }

  /** Visible opaque meshes, except spaces, doors and openings (the walker passes through them). */
  colliders(): THREE.Object3D[] {
    return this.core.pickables.filter(o => o instanceof THREE.Mesh && isShown(o)
      && !(o.userData.baseMaterial as THREE.Material).transparent
      && !WALK_THROUGH.has(o.userData.cls));
  }
}

/** Drawable copy (same geometry and material) of a curve, point cloud or mesh. */
function mirrorOf(o: THREE.Object3D): THREE.Object3D | null {
  const g = (o as THREE.Mesh).geometry;
  const m = (o as THREE.Mesh).material;
  if (o instanceof THREE.LineSegments) return new THREE.LineSegments(g, m);
  if (o instanceof THREE.LineLoop) return new THREE.LineLoop(g, m);
  if (o instanceof THREE.Line) return new THREE.Line(g, m);
  if (o instanceof THREE.Points) return new THREE.Points(g, m);
  if (o instanceof THREE.Mesh) return new THREE.Mesh(g, m);
  return null;
}

const WALK_THROUGH = new Set(['IfcSpace', 'IfcDoor', 'IfcOpeningElement', 'IfcVirtualElement']);

/** IFC class of the element a node belongs to (that of the nearest classified ancestor). */
function ownerClass(node: ComposedNode): string | undefined {
  for (let n: ComposedNode | null = node; n; n = n.parent) {
    const code = (n.attributes['bsi::ifc::class'] as any)?.code;
    if (code) return code;
  }
  return undefined;
}
