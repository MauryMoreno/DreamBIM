import * as THREE from 'three';
import type { ComposedNode } from '../../ifcx/types';
import { ColorOverride, type ColorFn, type ElementColor } from '../coloroverride';
import { pullForward } from '../edgedepth';
import { Highlights } from '../highlight';
import { focusRole, type LevelFocus } from '../levels';
import { StyleMaterials, type VisualStyle } from '../styles';
import type { ViewerCore } from './core';
import { elementOf } from './quantities';

const SELECT_COLOR = 0x2f80ff;
const HOVER_COLOR = 0x7fb3ff;
/** Classes drawn as cut (solid fill) in a storey plan. */
const CUT_CLASSES = new Set(['IfcWall', 'IfcWallStandardCase', 'IfcCurtainWall', 'IfcColumn']);

/** Rest of the viewer that selection and appearance repaint through. */
interface AppearancePeers {
  readonly nodes: Map<string, ComposedNode>;
  levelFocus(): LevelFocus | null;
  syncBatches(changed: THREE.Mesh[]): void;
  syncMirrors(objects: Iterable<THREE.Object3D>): void;
  requestRender(): void;
  applyClipping(): void;
  refreshEdges(): void;
  /** Shaded swaps the regular lights for the view-relative shaded sun. */
  setShadedStyle(shaded: boolean): void;
}

/** Selection, hover, visual styles and per-element colours. */
export class ViewerAppearance {
  readonly highlights = new Highlights();
  private selected: string | null = null;
  private selectedSet: Set<string> | null = null;
  private hovered: string | null = null;
  private xray = false;
  private selectMat = new THREE.MeshStandardMaterial({ color: SELECT_COLOR, emissive: 0x0a2a66, roughness: 0.6, side: THREE.DoubleSide });
  private hoverMat = new THREE.MeshStandardMaterial({ color: HOVER_COLOR, roughness: 0.7, side: THREE.DoubleSide });
  private ghostMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  private selectLineMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR });
  // neighbouring storeys in a storey plan (setLevelFocus): grey, dimmed and not clipped
  private underlayMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  private underlayLineMat = new THREE.LineBasicMaterial({ color: 0x9aa4b2, transparent: true, opacity: 0.5 });
  // fill of the walls and columns of the plan's storey: flat and opaque (Studio gives it the background colour)
  private cutMat = new THREE.MeshBasicMaterial({ color: 0x2f343a, side: THREE.DoubleSide });
  // visual style (setVisualStyle): 'textures' by default, the model materials as they are
  style: VisualStyle = 'textures';
  private styleMats = new StyleMaterials();
  // per-element colour above its own material (setColorOverride)
  private colorOverride = new ColorOverride();
  private edgeMat = pullForward(new THREE.LineBasicMaterial({ color: 0x2f343a }));

  constructor(private core: ViewerCore, private peers: AppearancePeers) {}

  select(path: string | null) {
    const before = this.selectionRoots();
    this.selected = path;
    this.selectedSet = null;
    this.applyMaterials(this.core.drawablesUnder([...before, ...this.selectionRoots()]));
  }

  /** Highlights a set of elements at once (a group from the quantities panel, for instance). */
  selectMany(paths: string[] | null) {
    const before = this.selectionRoots();
    this.selected = null;
    this.selectedSet = paths && paths.length ? new Set(paths) : null;
    this.applyMaterials(this.core.drawablesUnder([...before, ...this.selectionRoots()]));
  }

  /** Roots of the selection (the element or the set). */
  private selectionRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const add = (p: string) => { const o = this.core.objects.get(p); if (o) out.push(o); };
    if (this.selected) add(this.selected);
    for (const p of this.selectedSet ?? []) add(p);
    return out;
  }

  /** Changes the element under the cursor: only the previous and the new one are repainted. */
  setHovered(path: string | null) {
    const before = this.hovered ? this.core.objects.get(this.hovered) : null;
    this.hovered = path;
    this.applyMaterials(this.core.drawablesUnder([before, path ? this.core.objects.get(path) : null]));
  }

  get hoveredPath() { return this.hovered; }

  get selectedPath() { return this.selected; }

  hasHighlight(o: THREE.Object3D) {
    return this.highlights.has(o);
  }

  /** A new model: a selection or hover that no longer exists is cleared. */
  pruneSelection() {
    if (this.selected && !this.core.objects.has(this.selected)) this.selected = null;
  }

  forgetHover() {
    this.hovered = null;
  }

  clearHighlights() {
    this.highlights.clear();
  }

  resetStyleMaterials() {
    this.styleMats.dispose();
  }

  clearColorCache() {
    this.colorOverride.clearCache();
  }

  setXray(on: boolean) {
    this.xray = on;
    this.applyMaterials();
  }

  /**
   * Drawing material of each element (highlight, x-ray, cut, style). With `scope`, only those (the ones
   * that change on hover or selection); the batches only reread the meshes that changed.
   */
  applyMaterials(scope?: Iterable<THREE.Object3D>) {
    const selRoot = this.selected ? this.core.objects.get(this.selected) : null;
    const hovRoot = this.hovered ? this.core.objects.get(this.hovered) : null;
    const inSel = new Set<THREE.Object3D>();
    const inHov = new Set<THREE.Object3D>();
    selRoot?.traverse(o => inSel.add(o));
    for (const p of this.selectedSet ?? []) this.core.objects.get(p)?.traverse(o => inSel.add(o));
    hovRoot?.traverse(o => inHov.add(o));

    const changed: THREE.Mesh[] = [];
    const changedOther: THREE.Object3D[] = [];
    for (const o of scope ?? this.core.pickables) {
      const base = o.userData.baseMaterial as THREE.Material;
      let mat: THREE.Material = base;
      let hl: THREE.Material | null = null; // drawn by a separate copy (Highlights)
      if (this.isUnderlay(o)) mat = o instanceof THREE.Mesh ? this.underlayMat : o instanceof THREE.Line ? this.underlayLineMat : base;
      else if (o instanceof THREE.Mesh) {
        if (inSel.has(o)) hl = this.selectMat;
        else if (inHov.has(o)) hl = this.hoverMat;
        if (this.xray) mat = this.ghostMat;
        else if (this.style !== 'wireframe' && this.isCut(o)) mat = this.cutMat;
        else mat = this.styleMats.get(this.colorOverride.materialFor(this.elementPathOf(o)) ?? base, this.style);
      } else if (o instanceof THREE.Line) {
        if (inSel.has(o)) mat = this.selectLineMat;
      }
      // transparent things (glass, spaces, x-ray) cast no shadow
      const cast = o instanceof THREE.Mesh && mat.visible && !mat.transparent;
      const hlChanged = o instanceof THREE.Mesh && this.highlights.set(o, hl);
      if (!hlChanged && (o as THREE.Mesh).material === mat && o.castShadow === cast) continue;
      (o as THREE.Mesh).material = mat;
      o.castShadow = cast;
      (o instanceof THREE.Mesh ? changed : changedOther).push(o);
    }
    this.peers.syncBatches(changed);
    this.peers.syncMirrors([...changed, ...changedOther]);
    this.peers.requestRender();
  }

  /**
   * Paints each element with the colour `fn` gives (by composed path), above its material and below
   * x-ray, the cut and the selection; `fn` null or one of its nulls = the element's own material.
   */
  setColorOverride(fn: ColorFn | null): void {
    this.colorOverride.set(fn);
    this.applyMaterials();
    this.peers.applyClipping(); // the materials created above are clipped too
  }

  /**
   * Colours saved in the model by composed path. They are painted per element and not with the mesh
   * colour: in Revit the colour lives in the `Body` and would cover the one saved on the element.
   */
  setSavedColors(colors: ReadonlyMap<string, ElementColor> | null): void {
    this.colorOverride.setSaved(colors);
    this.applyMaterials();
    this.peers.applyClipping(); // the materials created above are clipped too
  }

  /**
   * Temporary Assistant colours by composed path, above the mode ones; null removes them. They do not
   * touch the model: they disappear when it changes.
   */
  setAssistantColors(colors: ReadonlyMap<string, ElementColor> | null): void {
    this.colorOverride.setTop(colors);
    this.applyMaterials();
    this.peers.applyClipping(); // the materials created above are clipped too
  }

  /** Path of the element a mesh belongs to (stored on the mesh after the first time). */
  private elementPathOf(o: THREE.Object3D): string | null {
    if (!('elementPath' in o.userData)) o.userData.elementPath = elementOf(o)?.userData.path ?? null;
    return o.userData.elementPath as string | null;
  }

  /** Visual style of the view (Wireframe, Hidden Line, Shaded, Consistent Colors or Textures). */
  setVisualStyle(style: VisualStyle) {
    if (style === this.style) return;
    this.style = style;
    this.peers.setShadedStyle(style === 'shaded');
    this.peers.refreshEdges();
    this.applyMaterials();
    this.peers.applyClipping();
  }

  /** Colour of the Hidden Line faces: that of the view background (as in Revit). */
  setHiddenFaceColor(hex: number) {
    this.styleMats.setHiddenColor(hex);
    this.peers.requestRender();
  }

  /** Colour of the Wireframe and Hidden Line edges (contrast with the theme background). */
  setEdgeColor(hex: number) {
    this.edgeMat.color.setHex(hex);
    this.peers.requestRender();
  }

  /** Colour of the fill of walls and columns in a storey plan (contrast with the theme background). */
  setCutColor(hex: number) {
    this.cutMat.color.setHex(hex);
    this.peers.requestRender();
  }

  /** Wall or column of the plan's storey: painted as cut (its class is on it or on an ancestor). */
  isCut(o: THREE.Object3D): boolean {
    const focus = this.peers.levelFocus();
    if (!focus) return false;
    const path = o.userData.path as string;
    if (focusRole(path, focus) !== 'current') return false;
    for (let n = this.peers.nodes.get(path); n; n = n.parent ?? undefined) {
      const code = (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;
      if (code) return CUT_CLASSES.has(code);
    }
    return false;
  }

  isUnderlay(o: THREE.Object3D): boolean {
    const focus = this.peers.levelFocus();
    return !!focus && focusRole(o.userData.path as string, focus) === 'underlay';
  }

  /** Viewer materials that must follow the active clipping planes. */
  clippingMaterials(): THREE.Material[] {
    return [this.selectMat, this.hoverMat, this.ghostMat, this.selectLineMat, this.cutMat, this.edgeMat, ...this.styleMats.all(), ...this.colorOverride.all()];
  }

  /** Viewer materials excluded when disposing the model (they are reused between models). */
  visibleMaterials(): THREE.Material[] {
    return [this.selectMat, this.hoverMat, this.ghostMat, this.selectLineMat, this.underlayMat, this.underlayLineMat, this.cutMat, this.edgeMat];
  }

  /** Colour of the edges of Wireframe and Hidden Line (and of the cut elements of the plan). */
  get edgeMaterial() { return this.edgeMat; }
}
