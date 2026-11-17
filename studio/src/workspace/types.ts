import type * as THREE from 'three';
import type { WorkspaceAgentApi } from '../assistant/studio/host';
import type { LayerPanelCallbacks } from '../composer/layerpanel';
import type { StackRow } from '../composer/rows';
import type { ReparentAt, StageData } from '../composer/stagepanel';
import type { Vec3 } from '../composer/xform';
import type { CostsActions } from '../costs/mode';
import type { MoveTarget } from '../document/controller';
import type { ComposedNode } from '../ifcx/types';
import type { LibraryCallbacks } from '../library/librarypanel';
import type { MaterialsActions } from '../materials/mode';
import type { LoadedModel } from '../model/load';
import type { Placement } from '../modeling/document';
import type { Vec2 } from '../modeling/footprint';
import type { ModeId } from '../modes/definition';
import type { SimpleValue } from '../properties/groups';
import type { StudioProps } from '../properties/studio';
import type { FileMenuActions } from '../ribbon/filemenu';
import type { Viewer } from '../render/viewer';
import type { ScheduleActions } from '../schedule/mode';
import type { TransformControlsLike } from './gizmo';

/** Content of the Assistant column (BuiltBot, see assistant/builtbot/column.ts). */
export interface AssistantPanel {
  root: HTMLElement;
  /** First time the column opens: loads its content. Never rejects. */
  open(): Promise<void>;
}

/** What the workspace uses from the viewer: lets it run against a fake viewer (no WebGL). */
export type WorkspaceViewer = Pick<
  Viewer,
  | 'camera'
  | 'setModel'
  | 'disposeModel'
  | 'setEmptyGrid'
  | 'levels'
  | 'select'
  | 'fit'
  | 'view'
  | 'orient'
  | 'setProjection'
  | 'getCameraState'
  | 'setCameraState'
  | 'setSectionAt'
  | 'setSectionBox'
  | 'setXray'
  | 'setShadows'
  | 'setLod'
  | 'setGrid'
  | 'setGridColors'
  | 'enterWalk'
  | 'exitWalk'
  | 'walking'
  | 'walkLocked'
  | 'walkFlying'
  | 'screenshot'
  | 'thumbnail'
  | 'onPick'
  | 'onHover'
  | 'onWalkChange'
  | 'scene'
  | 'requestRender'
  | 'setLevelFocus'
  | 'setGridZ'
  | 'setCutColor'
  | 'setEdgeColor'
  | 'setHiddenFaceColor'
  | 'setHidden'
  | 'setVisualStyle'
  | 'modelFootprint'
  | 'objectOf'
  | 'setControlsEnabled'
  | 'refreshTransforms'
  | 'setColorOverride'
  | 'setAssistantColors'
  | 'setSavedColors'
  | 'selectMany'
  | 'quantities'
  | 'pick'
>;

export interface WorkspaceOptions<V extends WorkspaceViewer> {
  /** Creates the viewer inside `host`. Defaults to the real Viewer; tests pass a fake one. */
  createViewer?: (host: HTMLElement) => V;
  /** File menu commands (set by main.ts). */
  fileMenu?: FileMenuActions;
  /** Document editing: the workspace only reports it, main.ts changes the model. */
  editor?: WallEditor;
  /** What Properties edits in the document (levels and wall constraints); only while editing is active. */
  studio?: StudioEditor;
  /** Commands of the Stage and Layer panels (the composer stack); the controller runs them. */
  composer?: ComposerActions;
  /** Point on the level plane under the pointer (injectable in tests). Defaults to the camera ray. */
  pickPoint?: (e: PointerEvent) => Vec2 | null;
  /** Projection of a point on the level plane to client coordinates (injectable in tests). */
  projectPoint?: (p: Vec2) => { x: number; y: number } | null;
  /** Projection of a world point to client coordinates (injectable in tests). */
  projectWorld?: (x: number, y: number, z: number) => { x: number; y: number } | null;
  /** Creates the TransformControls for the move arrows (injectable in tests). Defaults to the three.js one. */
  makeTransformControls?: (camera: THREE.Camera, dom: HTMLElement) => TransformControlsLike;
  /** Assistant panel: its own column at the far right, collapsed on start. Without it there is no column. */
  assistant?: AssistantPanel;
  /** Materials mode commands (set by main.ts). Without them the mode stays a placeholder. */
  materials?: MaterialsActions;
  /** Costs mode commands (set by main.ts). Without them the mode stays a placeholder. */
  costs?: CostsActions;
  /** Schedule mode commands (set by main.ts). Without them the mode stays a placeholder. */
  schedule?: ScheduleActions;
  /** Where to mount the mode tabs (title bar). Without it there are no tabs, but shortcuts still work. */
  modeHost?: HTMLElement;
  /** Opens the file of a Properties reference (Open); the path is the one of the file that defines the tab. Without it there is no Open button. */
  openReference?(path: string): void;
  /** Disk of the Library panel (below) and the folder it starts with; without it the panel is empty. */
  library?: Omit<LibraryCallbacks, 'onActivate'> & { folder?: string | null };
}

/** Composer commands: the ones of the Layer panel plus moving elements (Move box). */
export type ComposerActions = LayerPanelCallbacks & {
  moveBy?(t: MoveTarget, d: Vec3): Promise<boolean>;
  moveTo?(t: MoveTarget, p: Vec3): Promise<boolean>;
  /** Transform box: absolute rotation (degrees, Euler XYZ) and absolute scale per axis. */
  rotateTo?(t: MoveTarget, r: Vec3): Promise<boolean>;
  scaleTo?(t: MoveTarget, s: Vec3): Promise<boolean>;
  /** Reparent from the Stage: changes the parent inside the `layerId` layer (`at`: the dragged instance). */
  reparent?(layerId: string, origin: string, newParentOrigin: string, at?: ReparentAt): Promise<boolean>;
  /** Properties of a linked element: overrides a simple attribute in the `layerId` edit layer. */
  setLinkedAttr?(layerId: string, node: ComposedNode, key: string, value: SimpleValue): Promise<boolean>;
  /** Reset: removes that override and restores the file value. */
  resetLinkedAttr?(layerId: string, node: ComposedNode, key: string): Promise<boolean>;
  /** Does the `layerId` edit layer already override that attribute of the node? */
  linkedAttrEdited?(layerId: string, node: ComposedNode, key: string): boolean;
  /** Properties of a linked element: picks an option of its variant set `set`. */
  setLinkedVariant?(layerId: string, node: ComposedNode, set: string, option: string): Promise<boolean>;
  resetLinkedVariant?(layerId: string, node: ComposedNode, set: string): Promise<boolean>;
  linkedVariantEdited?(layerId: string, node: ComposedNode, set: string): boolean;
  /** Loads or unloads a payload; `layerId` is the layer (or 'document') of the node that declares it. */
  setPayloadLoaded?(uri: string, on: boolean, layerId: string): Promise<boolean>;
  /** Library: links the file (if not linked) and places it under `parentOrigin`, on the plan at `at`. */
  placeAsset?(path: string, parentOrigin: string, at?: Vec2): Promise<boolean>;
  /** Library: only links the file (dropped on Layer, or in a read-only document). */
  linkAsset?(path: string): Promise<boolean>;
};

export interface StudioEditor extends StudioProps {
  /** Creates a level; resolves to its Studio id (null without an editable session). */
  addLevel(): Promise<string | null>;
  /** Placement of a linked file by the id of its container (it is selected and moved like an element). */
  placement?(id: string): Placement | undefined;
  /** Origin of the linked node that container hangs from (null if it hangs from the document). */
  placementBase?(p: Placement): Vec3 | null;
}

export interface WallEditor {
  /** `levelId`: the level of the plan where it is drawn. */
  addWall(start: Vec2, end: Vec2, levelId: string): void;
  deleteWall(id: string): void;
  /** Creates a floor with that boundary on the level; resolves to its id with the model already rebuilt (null if it was not created). */
  addFloor(boundary: Vec2[], levelId: string): Promise<string | null>;
  deleteFloor(id: string): void;
  /** Deletes the whole stair (the id may be the one of a run or a railing). */
  deleteStair?(id: string): void;
}

export type PaneId = 'left' | 'right' | 'bottom' | 'assistant';

export interface Workspace<V extends WorkspaceViewer = Viewer> {
  setModel(m: LoadedModel | null): void;
  viewer: V;
  /** Opens (or activates) the {3D} view: the «3D View» button of the quick access bar. */
  show3D(): void;
  /** Opens the first level's plan (or activates the one already open): New… shows it on start. */
  showPlan(): void;
  /** Turns editing on or off (the Wall tool); cancels the current tool. */
  /** `tools`: draw walls, floors and Studio levels (defaults to the same as `on`). */
  setEditable(on: boolean, tools?: boolean): void;
  /** Rebuilds the model after an edit without closing tabs or moving the camera. */
  updateModel(m: LoadedModel): void;
  /** Marks the document as modified (a * after the name in the title). */
  setDirty(on: boolean): void;
  /** Costs or schedule changed without the model changing: repaints the active mode without rebuilding the viewer. */
  dataChanged(): void;
  /** Layer panel stack (null without a document: hides the list and disables «+») and Stage data. */
  setComposer(rows: StackRow[] | null, stage: StageData): void;
  /** Places (or only links, in read-only mode) a library file, like double-clicking its card. */
  placeAsset(path: string): void;
  /** Changes the Library panel folder (without notifying onFolderChange). */
  setLibraryFolder(dir: string | null): Promise<void>;
  /** Switches mode (Model, Materials, Costs, Schedule); false if the current one cannot be left (sketch open). */
  setMode(id: ModeId): boolean;
  readonly mode: ModeId;
  /** Opens or collapses the Assistant column; the first time it opens it starts the agent. */
  toggleAssistant(): void;
  readonly assistantOpen: boolean;
  setPaneCollapsed(pane: PaneId, on: boolean): void;
  paneCollapsed(pane: PaneId): boolean;
  /** Collapses left, right, bottom, Assistant and ribbon; repeating it restores what was there. */
  toggleFocus(): void;
  readonly focused: boolean;
  /** What the Assistant queries and controls of the workspace (see assistant/studio). */
  readonly agent: WorkspaceAgentApi;
  /** Removes the global listeners the workspace registered. */
  dispose(): void;
}
