// Orchestration of the open document: edit session, Save / Save As, unsaved changes and the composer stack
// (linked files). The work lives in the services of this folder; this class is the public facade over them. No
// direct DOM or Tauri (everything is injected) so it can be tested.
import type { ComposedNode, IfcxFile } from '../ifcx/types';
import type { ComposeResult } from '../ifcx/compose';
import type { ComposerLayer } from '../composer/stack';
import type { ReparentAt } from '../composer/stagepanel';
import type { Vec3 } from '../composer/xform';
import type { LoadedModel } from '../model/load';
import type { SimpleValue } from '../properties/groups';
import type { WallEditor } from '../workspace/workspace';
import type { Placement } from '../modeling/document';
import type { BuildCounts, BuildRequest } from '../modeling/build';
import type { PlaceRequest } from '../modeling/place';
import type { Review, ReviewOptions } from '../modeling/egress';
import type { Plan, PlanReview } from '../modeling/planreview';
import type { StairRequest } from '../modeling/stairplace';
import type { SpotResult } from '../modeling/stairspots';
import type { StairShape } from '../modeling/stairlayout';
import type { MaterialDef } from '../materials/state';
import type { MaterialNode } from '../materials/nodes';
import type { ScheduleState } from '../schedule/state';
import type { ColorsState } from '../colors/state';
import type { ElementColor } from '../render/coloroverride';
import { tableOf } from '../classification/assign';
import type { Vec2 } from '../modeling/footprint';
import type { EditSession, FloorPatch, WallPatch } from '../modeling/session';
import { createDocumentContext, type DocumentContext } from './context';
import type { MoveTarget } from './move-target';
import type { ControllerDeps, PlaceResult, StairPlaceResult } from './types';
export { allowedAxes, targetPosition, rotScaleAxes, targetRotScale } from './move-target';
export type { MoveTarget, MoveStudio } from './move-target';
export type { DocWorkspace, ControllerDeps, PlaceResult, StairPlaceResult } from './types';

export class DocumentController {
  private readonly ctx: DocumentContext;

  constructor(d: ControllerDeps) {
    this.ctx = createDocumentContext(d);
  }

  /** Editor for mountWorkspace: it exists before the session and delegates to the current one (or does nothing). */
  readonly editor: WallEditor = {
    addWall: (start: Vec2, end: Vec2, levelId: string) => this.ctx.mutations.edit('Add Wall', (s) => s.addWall(start, end, levelId) !== null),
    deleteWall: (id: string) => this.ctx.mutations.edit('Delete Wall', (s) => s.removeWall(id)),
    addFloor: (boundary: Vec2[], levelId: string) => this.ctx.mutations.addFloor(boundary, levelId),
    deleteFloor: (id: string) => this.ctx.mutations.edit('Delete Floor', (s) => s.removeFloor(id)),
    deleteStair: (id: string) => this.ctx.mutations.edit('Delete Stair', (s) => s.removeStair(id)),
  };

  /** Editable session of the open document; null without a document or in read-only. */
  get session(): EditSession | null {
    return this.ctx.state.current;
  }

  /** There is a document in the workspace (editable or not). */
  get hasDocument(): boolean {
    return this.ctx.state.open;
  }

  /** Linked layers of the open document, from weakest to strongest. */
  get composerLayers(): readonly ComposerLayer[] {
    return this.ctx.state.layers;
  }

  /** File read from a layer; null if the layer does not exist or its file was not found. */
  linkedFile(id: string): IfcxFile | null {
    const l = this.ctx.state.layers.find((x) => x.id === id);
    return l ? this.ctx.state.files.get(l.uri) ?? null : null;
  }

  get history(): { undo: string | null; redo: string | null } {
    return this.ctx.history.history;
  }

  setUserLock(on: boolean): void {
    return this.ctx.lock.setUserLock(on);
  }

  asAgent<T>(fn: () => T): T {
    return this.ctx.lock.asAgent(fn);
  }

  undo(): Promise<boolean> {
    return this.ctx.history.undo();
  }

  redo(): Promise<boolean> {
    return this.ctx.history.redo();
  }

  idle(): Promise<void> {
    return this.ctx.queue.idle();
  }

  newDocument(): Promise<void> {
    return this.ctx.lifecycle.newDocument();
  }

  opened(model: LoadedModel, session: EditSession | null, opts: { keepView?: boolean } = {}): Promise<LoadedModel> {
    return this.ctx.lifecycle.opened(model, session, opts);
  }

  closed(): void {
    return this.ctx.lifecycle.closed();
  }

  get materialNodes(): (MaterialNode & { overridden: string[] })[] {
    return this.ctx.materials.materialNodes;
  }

  changeImportedFile(location: string, label: string, change: (file: IfcxFile) => IfcxFile | string): Promise<boolean> {
    return this.ctx.libraryFiles.changeImportedFile(location, label, change);
  }

  changeCostAssignment(label: string, change: (file: IfcxFile, result: ComposeResult) => IfcxFile | string): Promise<boolean> {
    return this.ctx.materials.changeCostAssignment(label, change);
  }

  get schedule(): ScheduleState {
    return this.ctx.libraryFiles.schedule;
  }

  changeSchedule(label: string, change: (s: ScheduleState) => ScheduleState | string): Promise<boolean> {
    return this.ctx.libraryFiles.changeSchedule(label, change);
  }

  get colors(): ColorsState {
    return this.ctx.sidecars.colors;
  }

  setColors(editPaths: string[], c: ElementColor | null, label: string): Promise<boolean> {
    return this.ctx.sidecars.setColors(editPaths, c, label);
  }

  editPaths(composedPaths: string[]): string[] | null {
    return this.ctx.elements.editPaths(composedPaths);
  }

  setMaterial(code: string | null, def: MaterialDef): Promise<boolean> {
    return this.ctx.materials.setMaterial(code, def);
  }

  resetMaterial(code: string): Promise<boolean> {
    return this.ctx.materials.resetMaterial(code);
  }

  promoteMaterial(code: string): Promise<boolean> {
    return this.ctx.materials.promoteMaterial(code);
  }

  duplicateMaterial(code: string): Promise<string | null> {
    return this.ctx.materials.duplicateMaterial(code);
  }

  deleteMaterial(code: string): Promise<boolean> {
    return this.ctx.materials.deleteMaterial(code);
  }

  assignMaterial(paths: string[], code: string | null, label: string = 'Assign Material'): Promise<boolean> {
    return this.ctx.materials.assignMaterial(paths, code, label);
  }

  classify(paths: string[], code: string | null, label: string = 'Classify Elements', title?: string, table: string = code ? tableOf(code) : '21'): Promise<boolean> {
    return this.ctx.classification.classify(paths, code, label, title, table);
  }

  linkFile(absPath: string): Promise<boolean> {
    return this.ctx.links.linkFile(absPath);
  }

  unlink(id: string): Promise<boolean> {
    return this.ctx.links.unlink(id);
  }

  setLayerEnabled(id: string, on: boolean): Promise<boolean> {
    return this.ctx.links.setLayerEnabled(id, on);
  }

  removeEdit(layerId: string, path: string): Promise<boolean> {
    return this.ctx.links.removeEdit(layerId, path);
  }

  setEditsEnabled(id: string, on: boolean): Promise<boolean> {
    return this.ctx.links.setEditsEnabled(id, on);
  }

  moveLayer(id: string, toIndex: number): Promise<boolean> {
    return this.ctx.links.moveLayer(id, toIndex);
  }

  relink(id: string, absPath: string): Promise<boolean> {
    return this.ctx.links.relink(id, absPath);
  }

  readonly placementBase = (p: Placement): Vec3 | null => this.ctx.placement.placementBase(p);

  place(layerId: string, parentOrigin: string): Promise<boolean> {
    return this.ctx.placement.place(layerId, parentOrigin);
  }

  unplace(layerId: string): Promise<boolean> {
    return this.ctx.placement.unplace(layerId);
  }

  placeFile(absPath: string, parentOrigin: string, at?: Vec2): Promise<boolean> {
    return this.ctx.placement.placeFile(absPath, parentOrigin, at);
  }

  moveBy(target: MoveTarget, delta: Vec3): Promise<boolean> {
    return this.ctx.transform.moveBy(target, delta);
  }

  moveTo(target: MoveTarget, pos: Vec3): Promise<boolean> {
    return this.ctx.transform.moveTo(target, pos);
  }

  rotateTo(target: MoveTarget, rot: Vec3): Promise<boolean> {
    return this.ctx.transform.rotateTo(target, rot);
  }

  scaleTo(target: MoveTarget, scale: Vec3): Promise<boolean> {
    return this.ctx.transform.scaleTo(target, scale);
  }

  reparent(layerId: string, origin: string, newParentOrigin: string, at?: ReparentAt): Promise<boolean> {
    return this.ctx.transform.reparent(layerId, origin, newParentOrigin, at);
  }

  linkedAttrEdited(layerId: string, node: ComposedNode, key: string): boolean {
    return this.ctx.linkedProps.linkedAttrEdited(layerId, node, key);
  }

  setLinkedAttr(layerId: string, node: ComposedNode, key: string, value: SimpleValue): Promise<boolean> {
    return this.ctx.linkedProps.setLinkedAttr(layerId, node, key, value);
  }

  resetLinkedAttr(layerId: string, node: ComposedNode, key: string): Promise<boolean> {
    return this.ctx.linkedProps.resetLinkedAttr(layerId, node, key);
  }

  linkedVariantEdited(layerId: string, node: ComposedNode, set: string): boolean {
    return this.ctx.linkedProps.linkedVariantEdited(layerId, node, set);
  }

  setLinkedVariant(layerId: string, node: ComposedNode, set: string, option: string): Promise<boolean> {
    return this.ctx.linkedProps.setLinkedVariant(layerId, node, set, option);
  }

  resetLinkedVariant(layerId: string, node: ComposedNode, set: string): Promise<boolean> {
    return this.ctx.linkedProps.resetLinkedVariant(layerId, node, set);
  }

  get loadedPayloads(): string[] {
    return this.ctx.payloads.loadedPayloads;
  }

  setPayloadLoaded(uri: string, on: boolean, layerId: string): Promise<boolean> {
    return this.ctx.payloads.setPayloadLoaded(uri, on, layerId);
  }

  setFloorConstraints(id: string, patch: FloorPatch): Promise<boolean> {
    return this.ctx.elements.setFloorConstraints(id, patch);
  }

  addLevel(): Promise<string | null> {
    return this.ctx.elements.addLevel();
  }

  buildModel(req: BuildRequest): Promise<BuildCounts> {
    return this.ctx.elements.buildModel(req);
  }

  placeAssets(req: PlaceRequest, dryRun: boolean): Promise<PlaceResult> {
    return this.ctx.elements.placeAssets(req, dryRun);
  }

  placeStairs(req: StairRequest, dryRun: boolean): Promise<StairPlaceResult> {
    return this.ctx.elements.placeStairs(req, dryRun);
  }

  reviewPlan(plan: Plan): Promise<PlanReview> {
    return this.ctx.review.reviewPlan(plan);
  }

  reviewModel(opts: ReviewOptions): Review {
    return this.ctx.review.reviewModel(opts);
  }

  stairSpots(q: { from: string; to: string; shape: StairShape; width: number; limit: number }): SpotResult {
    return this.ctx.review.stairSpots(q);
  }

  elementIds(composedPaths: string[]): string[] | null {
    return this.ctx.elements.elementIds(composedPaths);
  }

  removeElements(ids: string[], label: string): Promise<number> {
    return this.ctx.elements.removeElements(ids, label);
  }

  renameLevel(id: string, name: string): Promise<boolean> {
    return this.ctx.elements.renameLevel(id, name);
  }

  setLevelElevation(id: string, elevation: number): Promise<boolean> {
    return this.ctx.elements.setLevelElevation(id, elevation);
  }

  setWallConstraints(id: string, patch: WallPatch): Promise<boolean> {
    return this.ctx.elements.setWallConstraints(id, patch);
  }

  save(): Promise<boolean> {
    return this.ctx.saver.save();
  }

  saveAs(): Promise<boolean> {
    return this.ctx.saver.saveAs();
  }

  confirmDiscard(): Promise<boolean> {
    return this.ctx.saver.confirmDiscard();
  }
}
