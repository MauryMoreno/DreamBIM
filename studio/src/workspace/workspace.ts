import * as THREE from 'three';
// Revit-style workspace (sketch B): ribbon on top; left column with Properties and Project Browser;
// view tabs, 3D view with ViewCube and view bar; status bar below.
import { Viewer } from '../render/viewer';
import { mountFileMenu, NOT_EDITABLE } from '../ribbon/filemenu';
import { mountRibbon } from '../ribbon/ribbon';
import { RIBBON } from '../ribbon/definition';
import { MODES } from '../modes/definition';
import { CUT_COLORS, GRID_COLORS, HIDDEN_FACE_COLORS, getTheme, onThemeChange } from '../shell/theme';
import { mountStatusBar } from './statusbar';
import { buildLayout, el } from './layout';
import { ViewTabs } from './viewtabs';
import { createPaneLayout } from './pane-layout';
import { EMPTY_GRID_SIZE } from './constants';
import type { Workspace, WorkspaceOptions, WorkspaceViewer } from './types';
import { WorkspaceState } from './state';
import { Disposables, type WorkspaceContext } from './context';
import { mountSelection } from './selection';
import { mountViewbar } from './viewbar';
import { mountPanels } from './panels';
import { mountViews } from './views';
import { mountDrop } from './drop';
import { mountWallTool } from './tools/wall';
import { mountFloorSketch } from './tools/floor-sketch';
import { createViewActions } from './view-actions';
import { mountKeyboard } from './keyboard';
import { mountAssistantPane } from './assistant-pane';
import { mountModesHost } from './modes-host';
import { mountModelBinding } from './model-binding';

export * from './types';
export * from './constants';

export function mountWorkspace<V extends WorkspaceViewer = Viewer>(
  host: HTMLElement,
  opts: WorkspaceOptions<V> = {},
): Workspace<V> {
  const dispose = new Disposables();
  let referencesShown: () => void = () => {};
  // --- Layout ----------------------------------------------------------------------
  const layout = buildLayout(host, { assistant: opts.assistant, onReferencesShown: () => referencesShown() });
  const { ribbonHost, view, canvasHost, assistantPane, statusEl } = layout;

  const viewer = (opts.createViewer ?? ((h: HTMLElement) => new Viewer(h) as unknown as V))(canvasHost);
  viewer.setEmptyGrid(EMPTY_GRID_SIZE);
  // the viewer grid follows the interface theme
  const paintGrid = (theme = getTheme()) => {
    viewer.setGridColors(GRID_COLORS[theme].center, GRID_COLORS[theme].line);
    viewer.setCutColor(HIDDEN_FACE_COLORS[theme]); // walls cut in plan: opaque, the background color (Revit)
    viewer.setEdgeColor(CUT_COLORS[theme]); // edges and borders of cut walls, contrasting with the background
    viewer.setHiddenFaceColor(HIDDEN_FACE_COLORS[theme]); // Hidden Line faces, the background color
  };
  paintGrid();
  dispose.add(onThemeChange((_pref, theme) => paintGrid(theme)));
  const status = mountStatusBar(statusEl);

  // --- State ------------------------------------------------------------------
  const state = new WorkspaceState();
  const tabs = new ViewTabs();

  // --- Ribbon and File menu ------------------------------------------------------
  const ribbon = mountRibbon(ribbonHost, (a, pressed, value) => viewActions.action(a, pressed, value), MODES.flatMap((m) => m.ribbon));
  ribbon.showTabs(RIBBON.map((t) => t.id), 'arquitectura'); // starts on Model
  ribbon.setPressed('matColors', true); // material coloring starts on
  const fileBtn = el('button', undefined, 'File');
  fileBtn.type = 'button';
  ribbonHost.querySelector('.ribbon-tabbar')?.prepend(fileBtn);
  mountFileMenu(fileBtn, opts.fileMenu ?? {
    onOpen() {}, onSave() {}, onSaveAs() {}, onClose() {}, onExit() {}, recents: () => [], onOpenRecent() {},
  });
  ribbon.setPressed('grid', state.toggles.grid);
  ribbon.setMenuValue('levels', state.levelsStyle);
  ribbon.setMenuValue('lod', '0');
  ribbon.setEnabled('wall', false, NOT_EDITABLE);
  ribbon.setEnabled('floor', false, NOT_EDITABLE);
  ribbon.setEnabled('level', false, NOT_EDITABLE);

  // --- Collapsible panes, persistence and focus mode ---------------------------------
  const panes = createPaneLayout(layout, ribbon);
  const { setPaneCollapsed, paneCollapsed, toggleFocus, layoutChanged } = panes;
  const ctx: WorkspaceContext<V> = { layout, state, viewer, opts, status, ribbon, dispose };
  ctx.dispose.add(() => ribbon.dispose());

  // --- View control bar ------------------------------------------------------------
  const viewbarControls = mountViewbar(ctx, { tabs, planCut: (v) => views.planCut(v) });
  const { setToggle, showStyleIcon } = viewbarControls;

  // --- Panels ---------------------------------------------------------------------
  const panels = mountPanels(ctx, {
    select: (path, from, toggle) => selection.select(path, from, toggle),
    openView: (v) => views.openView(v),
  });
  referencesShown = () => panels.referencesShown();

  // --- Library: cards dropped on the Stage, the view or Layer -----------------------------
  const drop = mountDrop(ctx, {
    tabs,
    currentMode: () => modes.switcher.current,
    elementPath: (path) => selection.elementPath(path),
    idOfPath: (path) => selection.idOfPath(path),
    drawing: () => wall.drawing(),
    stageData: () => panels.stageData,
    editsOff: () => panels.editsOff,
    dropCode: (code, path) => modes.costs?.dropCode(code, path),
    dropMaterial: (code, path) => modes.materials?.dropMaterial(code, path),
  });
  const { showMove, refreshGizmo } = drop;

  /** World point → client coordinates (null if it cannot be projected or is behind the camera). */
  const projectWorld = (x: number, y: number, z: number): { x: number; y: number } | null => {
    if (opts.projectWorld) return opts.projectWorld(x, y, z);
    const r = canvasHost.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    viewer.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(viewer.camera);
    if (!Number.isFinite(v.x) || v.z > 1) return null;
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };

  const selection = mountSelection(ctx, {
    showProperties: (node) => panels.showProperties(node),
    showMove: (node) => showMove(node),
    refreshLevelViews: () => views.refreshLevelViews(),
    reveal: (path) => panels.reveal(path),
    markSelected: (paths) => panels.markSelected(paths),
    selectReference: (node) => panels.selectReference(node),
    selectionChanged: (path) => {
      modes.materials?.selectionChanged(path);
      modes.costs?.selectionChanged(path);
      modes.schedule?.selectionChanged(path);
    },
    drawing: () => wall.drawing(),
    gizmoDragging: () => drop.gizmoDragging,
    levelMarks: () => views.levelMarks(),
    projectWorld,
  });
  const { pathOfId } = selection;

  viewer.onWalkChange = () => {
    ribbon.setPressed('walk', viewer.walking);
    refreshGizmo(); // no arrows while walking
    if (!viewer.walking) status.setMessage(null);
    else if (viewer.walkLocked) {
      status.setMessage(
        `Walk: WASD to move · Shift to run · V to ${viewer.walkFlying ? 'walk' : 'fly'} · Esc to release the mouse`,
      );
    } else status.setMessage('Walk: click the view to look around with the mouse · P or Esc to exit');
  };

  // --- Views ------------------------------------------------------------------------
  const views = mountViews(ctx, {
    tabs, select: (path, from) => selection.select(path, from), showStyleIcon: (style) => showStyleIcon(style),
    refreshGizmo: () => refreshGizmo(), floorActive: () => floor.active(), stopFloor: () => floor.stop(),
    wallActive: () => wall.active(), wallRestart: () => wall.restart(), wallStop: () => wall.stop(),
    pathOfId: (id) => pathOfId(id),
  });
  const { openPlan, renderTabs, show3D } = views;

  // --- Wall tool ------------------------------------------------------------------------
  const wall = mountWallTool(ctx, {
    host,
    tabs,
    openPlan: () => views.openPlan(),
    floorActive: () => floor.active(),
    floorStart: () => floor.startPoint(),
    floorChainStart: () => floor.chainStartPoint(),
    stopFloor: () => floor.stop(),
    sketchClick: (p) => floor.sketchClick(p),
    sketchMove: (p, z) => floor.sketchMove(p, z),
    refreshSketch: () => floor.refresh(),
    floorDeleteSelected: () => floor.deleteSelected(),
    select: (path, from) => selection.select(path, from),
    idOfPath: (path) => selection.idOfPath(path),
    ifcClass: (node) => selection.ifcClass(node),
    refreshGizmo: () => refreshGizmo(),
  });

  // --- Floor sketch ---------------------------------------------------------------------
  const floor = mountFloorSketch(ctx, {
    tabs,
    wall,
    openPlan: () => views.openPlan(),
    refreshGizmo: () => refreshGizmo(),
    select: (path, from) => selection.select(path, from),
    idOfPath: (path) => selection.idOfPath(path),
    pathOfId: (id) => selection.pathOfId(id),
  });

  // --- View actions (the same calls as the web viewer's buildToolbar) -------------------
  const viewActions = createViewActions(ctx, {
    views,
    wall,
    floor,
    setToggle,
    modes: () => modes,
  });

  // --- Assistant ----------------------------------------------------------------------
  const assistant = mountAssistantPane(ctx, { layoutChanged });
  mountKeyboard(ctx, {
    host, toggleAssistant: assistant.toggleAssistant, toggleFocus,
    toggleWalk: viewActions.toggleWalk, setToggle, floor, wall, selection,
  });

  // --- Modes ---------------------------------------------------------------------------
  const modes = mountModesHost(ctx, {
    host,
    wall,
    floor,
    setModeHidden: (paths) => panels.setModeHidden(paths),
    syncCostsRibbon: viewActions.syncCostsRibbon,
    scheduleFuture: viewActions.scheduleFuture,
  });

  const binding = mountModelBinding(ctx, {
    tabs,
    panels,
    views,
    selection,
    drop,
    wall,
    modes,
    syncCostsRibbon: viewActions.syncCostsRibbon,
    setToggle,
  });

  renderTabs();
  view.classList.add('no-view');
  return {
    agent: binding.agent,
    setModel: binding.setModel, viewer, show3D, showPlan: openPlan,
    setEditable: binding.setEditable, updateModel: binding.updateModel, setDirty: binding.setDirty,
    dataChanged: binding.dataChanged, setComposer: binding.setComposer,
    placeAsset: (path) => drop.placeAsset(path),
    setLibraryFolder: (dir) => drop.setLibraryFolder(dir),
    setMode: (id) => modes.switcher.set(id),
    get mode() { return modes.switcher.current; },
    toggleAssistant: assistant.toggleAssistant,
    get assistantOpen() { return assistantPane ? !assistantPane.collapsed : false; },
    setPaneCollapsed,
    paneCollapsed,
    toggleFocus,
    get focused() { return panes.focused; },
    dispose: () => dispose.run(),
  };
}
