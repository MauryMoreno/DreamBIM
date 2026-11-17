import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ComposedNode } from '../ifcx/types';
import type { CameraState, LevelFocus, LevelInfo } from './levels';
import { SHADED_LIGHT, shadedSunDir, type VisualStyle } from './styles';
import type { ColorFn, ElementColor } from './coloroverride';
import { ViewerCore } from './viewer/core';
import { ViewerExplode, type ExplodeMode } from './viewer/explode';
import { ViewerGrid } from './viewer/grid';
import { ViewerLod } from './viewer/lod';
import { ViewerLoop } from './viewer/loop';
import { ViewerQuantities, type QuantityRow } from './viewer/quantities';
import { ViewerAppearance } from './viewer/appearance';
import { ViewerCamera, type ViewName } from './viewer/camera';
import { ViewerInteraction } from './viewer/interaction';
import { ViewerModel, type ModelStats } from './viewer/model';
import { ViewerSection } from './viewer/section';
import { ViewerVisibility } from './viewer/visibility';
import { ViewerSun } from './viewer/sun';
import { ViewerThumbnails } from './viewer/thumbnails';

export type { CameraState, LevelFocus, LevelInfo } from './levels';
export type { ModelStats } from './viewer/model';
export type { VisualStyle } from './styles';
export type { ViewName } from './viewer/camera';
export type { ExplodeMode } from './viewer/explode';
export type { QuantityRow } from './viewer/quantities';

/** Facade over the render subsystems; every public member keeps its name and signature. */
export class Viewer {
  private readonly core: ViewerCore;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly loopSub: ViewerLoop;
  private readonly gridSub: ViewerGrid;
  private readonly sunSub: ViewerSun;
  private readonly lodSub: ViewerLod;
  private readonly thumbSub: ViewerThumbnails;
  private readonly quantitySub: ViewerQuantities;
  private readonly explodeSub: ViewerExplode;
  private readonly sectionSub: ViewerSection;
  private readonly cameraSub: ViewerCamera;
  private readonly visibilitySub: ViewerVisibility;
  private readonly appearanceSub: ViewerAppearance;
  private readonly interactionSub: ViewerInteraction;
  private readonly modelSub: ViewerModel;

  /** What the view shows changed (hide, isolate, classes, new model). */
  onVisibilityChange: () => void = () => {};
  /** The viewer undid the explosion on its own (entering the walk). */
  onExplodeReset: () => void = () => {};
  /** Entering or leaving the walk, or its state changed (pointer captured, flying). */
  onWalkChange: () => void = () => {};
  /** `toggle`: Ctrl or Cmd held on the click (adds to or removes from the selection). */
  onPick: (path: string | null, toggle: boolean) => void = () => {};
  onHover: (path: string | null) => void = () => {};

  private bbox = new THREE.Box3();

  constructor(private container: HTMLElement) {
    this.core = new ViewerCore(container);
    this.renderer = this.core.renderer;
    this.scene = this.core.scene;
    this.camera = this.core.camera;
    this.controls = this.core.controls;
    this.sunSub = new ViewerSun(this.core, this.bbox);
    this.appearanceSub = new ViewerAppearance(this.core, {
      nodes: this.core.nodes,
      levelFocus: () => this.modelSub.levelFocus,
      syncBatches: (changed) => this.modelSub.batches.sync(changed),
      syncMirrors: (objects) => this.modelSub.syncMirrors(objects),
      requestRender: () => this.requestRender(),
      applyClipping: () => this.sectionSub.apply(),
      refreshEdges: () => this.modelSub.applyEdges(),
      setShadedStyle: (shaded) => {
        this.sunSub.hemi.visible = this.sunSub.sun.visible = !shaded;
        this.sunSub.shadeAmbient.intensity = shaded ? SHADED_LIGHT.ambient : 0;
        this.sunSub.shadeSun.intensity = shaded ? SHADED_LIGHT.sun : 0;
      },
    });
    this.sectionSub = new ViewerSection(this.core, {
      bbox: this.bbox,
      levelFocus: () => this.modelSub.levelFocus,
      materials: () => this.appearanceSub.clippingMaterials(),
    });
    this.cameraSub = new ViewerCamera(this.core, {
      bbox: this.bbox,
      objects: this.core.objects,
      selected: () => this.appearanceSub.selectedPath,
      modelRoot: () => this.modelSub.root,
      explodeAmount: () => this.explodeSub.amount,
      resetExplode: () => this.setExplode(0),
      clearHover: () => {
        if (!this.appearanceSub.hoveredPath) return;
        this.appearanceSub.setHovered(null);
        this.onHover(null);
      },
      colliders: () => this.modelSub.colliders(),
      requestRender: () => this.requestRender(),
      onWalkChange: () => this.onWalkChange(),
      onExplodeReset: () => this.onExplodeReset(),
    });
    this.visibilitySub = new ViewerVisibility(this.core, {
      levelFocus: () => this.modelSub.levelFocus,
      syncBatches: () => this.modelSub.batches.sync(),
      syncMirrors: () => this.modelSub.syncMirrors(),
      edgesPossible: () => this.modelSub.edgesPossible(),
      markEdgesDirty: () => this.modelSub.applyEdges(),
      refreshWalk: () => this.cameraSub.refreshWalk(),
      onVisibilityChange: () => this.onVisibilityChange(),
      requestRender: () => this.requestRender(),
    });
    this.gridSub = new ViewerGrid(this.core, this.bbox);
    this.lodSub = new ViewerLod(this.core, {
      nodes: this.core.nodes,
      drawnMeshes: () => this.modelSub.drawnMeshes(),
      rebuildDraw: (geometries) => this.modelSub.rebuildDraw(geometries),
    });
    this.thumbSub = new ViewerThumbnails(this.core);
    this.quantitySub = new ViewerQuantities(this.core);
    this.explodeSub = new ViewerExplode(this.core, this.bbox, {
      exitWalk: () => this.cameraSub.exitWalk(),
      updateModelTransforms: () => this.modelSub.updateModelTransforms(),
      markEdgesMoved: () => this.modelSub.markEdgesMoved(),
    });
    this.modelSub = new ViewerModel(this.core, {
      bbox: this.bbox,
      grid: this.gridSub,
      sun: this.sunSub,
      section: this.sectionSub,
      visibility: this.visibilitySub,
      appearance: this.appearanceSub,
      explode: this.explodeSub,
      lod: this.lodSub,
      armFirstFrame: () => this.loopSub.armFirstFrame(),
      exitWalk: () => this.cameraSub.exitWalk(),
      requestRender: () => this.requestRender(),
    });
    this.scene.add(this.modelSub.batches.root, this.modelSub.extrasRoot, this.appearanceSub.highlights.root, this.modelSub.edgeLines, this.sectionSub.box.root);
    this.loopSub = new ViewerLoop(this.core, {
      advance: (dt) => this.cameraSub.advance(dt),
      prepareRender: () => this.prepareRender(),
    });
    this.interactionSub = new ViewerInteraction(this.core, {
      container: this.container,
      renderer: this.renderer,
      camera: this.camera,
      controls: this.controls,
      section: this.sectionSub,
      appearance: this.appearanceSub,
      cameras: this.cameraSub,
      onPick: (path, toggle) => this.onPick(path, toggle),
      onHover: (path) => this.onHover(path),
      fit: (path) => this.cameraSub.fit(path),
      renderNow: () => this.loopSub.renderNow(),
      requestRender: () => this.requestRender(),
    });
  }

  // Model

  setModel(root: ComposedNode | null): ModelStats { return this.modelSub.setModel(root); }
  /** Removes the model and frees its GPU resources (call before loading another one). */
  disposeModel() { this.modelSub.disposeModel(); }
  objectOf(path: string): THREE.Object3D | null { return this.modelSub.objectOf(path); }
  refreshTransforms(obj: THREE.Object3D): void { this.modelSub.refreshTransforms(obj); }
  hasGeometry(path: string) { return this.modelSub.hasGeometry(path); }

  // Selection and appearance

  select(path: string | null) { this.appearanceSub.select(path); }
  /** Highlights a set of elements at once (a group from the quantities panel, for instance). */
  selectMany(paths: string[] | null) { this.appearanceSub.selectMany(paths); }
  setXray(on: boolean) { this.appearanceSub.setXray(on); }
  /** Per-element colour above its own material, below x-ray, the cut and the selection. */
  setColorOverride(fn: ColorFn | null): void { this.appearanceSub.setColorOverride(fn); }
  /** Colours saved in the model by composed path (they win over the mesh colour). */
  setSavedColors(colors: ReadonlyMap<string, ElementColor> | null): void { this.appearanceSub.setSavedColors(colors); }
  /** Temporary Assistant colours by composed path, above the mode ones; null removes them. */
  setAssistantColors(colors: ReadonlyMap<string, ElementColor> | null): void { this.appearanceSub.setAssistantColors(colors); }

  // Visibility

  setHidden(paths: Set<string>) { this.visibilitySub.setHidden(paths); }
  setHiddenClasses(codes: Set<string>) { this.visibilitySub.setHiddenClasses(codes); }
  isolate(path: string | null) { this.visibilitySub.isolate(path); }

  // Camera

  /** Frames a node (or the whole model) with a short animation, from `from` if given. */
  fit(path?: string | string[] | null, animate = true, from?: THREE.Vector3) { this.cameraSub.fit(path, animate, from); }
  view(name: ViewName) { this.cameraSub.view(name); }
  /** Turns the camera to look at the target from `dir` (world, Z up) and reframes. */
  orient(dir: THREE.Vector3) { this.cameraSub.orient(dir); }
  get projection() { return this.cameraSub.projection; }
  /** 'orthographic' is a pseudo-orthographic: 2 degree fov pulled back to keep the framing. */
  setProjection(mode: 'perspective' | 'orthographic') { this.cameraSub.setProjection(mode); }
  getCameraState(): CameraState { return this.cameraSub.getCameraState(); }
  /** Places the camera as it is, without animating. */
  setCameraState(s: CameraState) { this.cameraSub.setCameraState(s); }
  /** Turns mouse orbit on or off (while dragging a gizmo, for instance). */
  setControlsEnabled(on: boolean) { this.cameraSub.setControlsEnabled(on); }

  // Section

  /** t in [0, 1]: cut height relative to the model box. */
  setSection(enabled: boolean, t = 1) { this.sectionSub.setSection(enabled, t); }
  /** Like setSection, but with the absolute z elevation (metres) of the cut. */
  setSectionAt(enabled: boolean, z: number) { this.sectionSub.setSectionAt(enabled, z); }
  /** 3D section box: six clipping planes with a draggable handle per face. */
  setSectionBox(enabled: boolean) { this.sectionSub.setSectionBox(enabled); }
  /** Storey plan: `current` normal, `underlay` storeys dimmed, the rest hidden; null shows all. */
  setLevelFocus(focus: LevelFocus | null) { this.modelSub.setLevelFocus(focus); }
  /** Elevation of the grid (that of the storey plan); null puts it back under the model. */
  setGridZ(z: number | null) { this.gridSub.setGridZ(z); }
  /** Visual style of the view (Wireframe, Hidden Line, Shaded, Consistent Colors or Textures). */
  setVisualStyle(style: VisualStyle) { this.appearanceSub.setVisualStyle(style); }
  /** Colour of the Hidden Line faces: that of the view background (as in Revit). */
  setHiddenFaceColor(hex: number) { this.appearanceSub.setHiddenFaceColor(hex); }
  /** Colour of the Wireframe and Hidden Line edges (contrast with the theme background). */
  setEdgeColor(hex: number) { this.appearanceSub.setEdgeColor(hex); }
  /** Colour of the fill of walls and columns in a storey plan. */
  setCutColor(hex: number) { this.appearanceSub.setCutColor(hex); }
  get sectionOn() { return this.sectionSub.on; }

  // Level of detail

  /** Level of detail being drawn (0 = the original mesh). */
  get lodLevel() { return this.lodSub.lodLevel; }
  /** Levels of detail the model has besides the original (keys of `studio::lod`), sorted. */
  lodLevels(): number[] { return this.lodSub.lodLevels(); }
  /** Only changes what is drawn: selection, measurement and edges use the original mesh. */
  setLod(o: { enabled: boolean; force?: number }) { this.lodSub.setLod(o); }

  // Sun, thumbnails and quantities

  get shadowsOn() { return this.sunSub.shadowsOn; }
  setShadows(on: boolean) { this.sunSub.setShadows(on); }
  thumbnail(paths: string[], width = 320, height = 220): string | null { return this.thumbSub.thumbnail(paths, width, height); }
  /** Volume and area in m³ / m², one row per drawn mesh, visible only when `onlyVisible`. */
  quantities(onlyVisible = true): QuantityRow[] { return this.quantitySub.quantities(onlyVisible); }

  // Exploded view

  /** 'storeys' lifts each storey, 'elements' moves each element away from the centre; amount in [0, 1]. */
  setExplode(amount: number, mode: ExplodeMode = this.explodeSub.mode) { this.explodeSub.setExplode(amount, mode); }
  /** Storeys (IfcBuildingStorey with geometry) from bottom to top. */
  levels(): LevelInfo[] { return this.explodeSub.levels(); }
  /** XY footprint (metres) of the model box; null if the model has no geometry. */
  get modelFootprint(): { minX: number; minY: number; maxX: number; maxY: number } | null { return this.explodeSub.modelFootprint; }
  /** Are there storeys to separate? (if not, only 'elements' makes sense) */
  get storeyCount() { return this.explodeSub.storeyCount; }

  // First-person walk

  get walking() { return this.cameraSub.walking; }
  get walkLocked() { return this.cameraSub.walkLocked; }
  get walkFlying() { return this.cameraSub.walkFlying; }
  /** Enters the walk, on foot over the floor being looked at (or the lowest one under the centre). */
  enterWalk(): boolean { return this.cameraSub.enterWalk(); }
  exitWalk() { this.cameraSub.exitWalk(); }

  // Grid and frame stats

  get showGrid() { return this.gridSub.showGrid; }
  set showGrid(on: boolean) { this.gridSub.showGrid = on; }
  setEmptyGrid(extent: number | null) { this.gridSub.setEmptyGrid(extent); }
  setGridColors(center: number, line: number) { this.gridSub.setGridColors(center, line); }
  setGrid(on: boolean) { this.gridSub.setGrid(on); }
  /** Draw calls and triangles of the last frame plus the mean render time of the last 60 frames. */
  frameStats(): { drawCalls: number; triangles: number; avgFrameMs: number } { return this.loopSub.frameStats(); }

  /** Runs just before drawing; in Shaded the sun is placed relative to the view first. */
  private prepareRender() {
    this.modelSub.prepareEdges();
    if (this.appearanceSub.style === 'shaded') {
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      shadedSunDir(fwd, up, this.sunSub.shadeSun.position);
      this.sunSub.shadeSun.target.position.set(0, 0, 0);
      this.sunSub.shadeSun.updateMatrixWorld();
      this.sunSub.shadeSun.target.updateMatrixWorld();
    }
    this.sectionSub.updateScale(this.camera, this.controls.target);
  }

  // Capture and interaction

  screenshot(): string { return this.interactionSub.screenshot(); }
  /** Returns the path of the object under the cursor. */
  pick(e: MouseEvent): string | null { return this.interactionSub.pick(e); }

  // Loop

  requestRender() { this.core.requestRender(); }
}
