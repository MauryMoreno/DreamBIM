import { viewLabel, type ViewRef } from '../browser/views';
import type { CameraState, LevelInfo } from '../render/levels';
import type { VisualStyle } from '../render/styles';
import { setDocumentTitle } from '../shell/screens';
import { svgIcon } from '../shell/icons';
import { toggleRadioMenu } from '../shell/radiomenu';
import {
  PLAN_TOP_CLEARANCE, PROJECTIONS, UNTITLED, VIEW_ICON,
} from './constants';
import type { WorkspaceContext } from './context';
import { el } from './layout';
import { createLevelMarks } from './levelmarks';
import { levelMarks } from './levelmarks-geom';
import { mountLevelList } from './levellist';
import type { SelectionFrom } from './selection';
import { levelText } from './statusbar';
import { mountViewCube } from './viewcube';
import { viewId, type ViewTabs } from './viewtabs';

export interface ViewsDeps {
  tabs: ViewTabs;
  select(path: string | null, from?: SelectionFrom): void;
  showStyleIcon(style: VisualStyle): void;
  refreshGizmo(): void;
  /** The floor sketch is active. */
  floorActive(): boolean;
  stopFloor(): void;
  /** The Wall tool is active. */
  wallActive(): boolean;
  /** Restarts the Wall tool's chain on the active plan. */
  wallRestart(): void;
  /** Stops the Wall tool. */
  wallStop(): void;
  pathOfId(id: string): string | null;
}

export interface ViewsController {
  openView(v: ViewRef): void;
  activateView(id: string): void;
  closeView(id: string): void;
  openPlan(): void;
  applyActive(): void;
  renderTabs(): void;
  refreshLevelViews(): void;
  planCut(v: ViewRef): number;
  titleName(): string;
  docName(): string;
  applyViewRange(v: ViewRef | undefined): void;
  show3D(): void;
  addLevel(): Promise<void>;
  levelMarks(): ReturnType<typeof createLevelMarks>['marks'];
}

export function mountViews(ctx: WorkspaceContext, deps: ViewsDeps): ViewsController {
  const { layout, state, viewer, opts, status, ribbon } = ctx;
  const { view, tabbar, levelOverlay } = layout;
  const { tabs } = deps;

  mountViewCube(view, viewer, {
    // only in 3D, like Revit: plans and elevations are always parallel. The saved camera of the tab
    // includes the projection, so each 3D view keeps its own.
    onContextMenu: (anchor) => {
      if (tabs.active?.view.kind !== '3d') return;
      toggleRadioMenu(anchor, PROJECTIONS, viewer.getCameraState().projection, (v) =>
        viewer.setProjection(v as CameraState['projection']),
      );
    },
  });
  const levelList = mountLevelList(view, (path) => deps.select(path));
  const levelMarksView = createLevelMarks(viewer, levelOverlay, (path) => deps.select(path));

  const docName = (): string => state.model?.name ?? UNTITLED;
  const titleName = (): string => docName() + (state.dirty ? '*' : '');
  /** Level immediately above the plan's (by elevation), or null on the highest one. */
  const levelAbove = (v: ViewRef): LevelInfo | null => {
    if (v.kind !== 'plan') return null;
    const i = state.levels.findIndex((l) => l.path === v.level.path);
    return i >= 0 ? state.levels[i + 1] ?? null : null;
  };
  /** Top of a plan's view range: the next level's elevation (on the last one, all of its own). */
  const planCut = (v: ViewRef) =>
    v.kind !== 'plan' ? 0 : (levelAbove(v)?.minZ ?? v.level.maxZ) + PLAN_TOP_CLEARANCE; // without eating the top face of walls

  /**
   * View range: on a plan its own level is seen normally, the one below and the one above are dimmed,
   * and the grid is at its elevation; outside plans, the whole model with the grid at the bottom.
   */
  function applyViewRange(v: ViewRef | undefined): void {
    if (v?.kind !== 'plan') {
      viewer.setLevelFocus(null);
      viewer.setGridZ(null);
      return;
    }
    const i = state.levels.findIndex((l) => l.path === v.level.path);
    const below = i > 0 ? state.levels[i - 1] : null;
    const underlay = [below, levelAbove(v)].filter((l): l is LevelInfo => l !== null).map((l) => l.path);
    viewer.setLevelFocus({ current: v.level.path, underlay });
    viewer.setGridZ(v.level.minZ);
  }

  function renderTabs(): void {
    const views = tabs.openViews();
    tabbar.replaceChildren(
      ...tabs.list().map((t, i) => {
        const tab = el('div', 'ws-tab');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(t.active));
        tab.dataset.id = t.id;
        tab.tabIndex = t.active ? 0 : -1;
        tab.title = t.label;
        tab.classList.toggle('active', t.active);
        tab.append(svgIcon(VIEW_ICON[views[i].kind], 14), el('span', 'ws-tab-label', t.label));
        const close = el('button', 'ws-tab-close');
        close.type = 'button';
        close.title = `Close ${t.label}`;
        close.setAttribute('aria-label', `Close ${t.label}`);
        close.appendChild(svgIcon('close', 10));
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          closeView(t.id);
        });
        tab.append(close);
        tab.addEventListener('click', () => activateView(t.id));
        tab.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateView(t.id);
          }
        });
        return tab;
      }),
    );
  }

  /** Saves the active view's camera if it is about to be left for another. */
  function leaveActive(nextId: string): void {
    const prev = tabs.active;
    if (prev && prev.id !== nextId) tabs.saveCamera(prev.id, viewer.getCameraState());
  }

  /** Configures the viewer for the active view (projection, cut and camera) and updates the texts. */
  function applyActive(): void {
    renderTabs();
    const a = tabs.active;
    view.classList.toggle('no-view', !a);
    if (!a) {
      applyViewRange(undefined);
      status.setLevel('');
      setDocumentTitle(titleName(), null);
      refreshLevelViews();
      return;
    }
    if (viewer.walking) viewer.exitWalk();
    const v = a.view;
    viewer.setProjection(v.kind === '3d' ? 'perspective' : 'orthographic');
    viewer.setSectionAt(v.kind === 'plan', planCut(v));
    applyViewRange(v);
    viewer.setVisualStyle(a.style);
    deps.showStyleIcon(a.style);
    if (a.camera) viewer.setCameraState(a.camera);
    else {
      // view() frames the selection in the viewer; a freshly opened view shows the whole model, so the
      // selection is released while it turns (a later fit with no direction would cancel the turn)
      viewer.select(null);
      viewer.view(v.kind === '3d' ? 'iso' : v.kind === 'plan' ? 'top' : v.side === 'front' ? 'front' : 'right');
      if (state.selection.length > 1) viewer.selectMany(state.selection);
      else viewer.select(state.inViewer);
    }
    state.toggles.section = v.kind === 'plan';
    ribbon.setPressed('section', state.toggles.section);
    status.setLevel(levelText(v));
    setDocumentTitle(titleName(), viewLabel(v));
    refreshLevelViews();
    deps.refreshGizmo(); // no Z on plans
    // a floor sketch belongs to one plan: changing views drops it
    if (deps.floorActive()) deps.stopFloor();
    // the Wall tool only lives on plans; changing plans restarts the chain
    if (deps.wallActive()) {
      if (v.kind === 'plan') deps.wallRestart();
      else deps.wallStop();
    }
  }

  function openView(v: ViewRef): void {
    const id = viewId(v);
    if (tabs.active?.id === id) return; // it is already the active one
    leaveActive(id);
    tabs.open(v);
    applyActive();
  }

  function activateView(id: string): void {
    if (tabs.active?.id === id) return;
    leaveActive(id);
    tabs.activate(id);
    applyActive();
  }

  function closeView(id: string): void {
    const wasActive = tabs.active?.id === id;
    tabs.close(id);
    if (wasActive) applyActive();
    else renderTabs();
  }

  /** «Plan» of the ribbon: the plan already open, else the first level's, else the top view. */
  function openPlan(): void {
    if (tabs.active?.view.kind === 'plan') return;
    const open = tabs.openViews().find((v) => v.kind === 'plan');
    if (open) openView(open);
    else if (state.levels.length) openView({ kind: 'plan', level: state.levels[0] });
    else viewer.view('top');
  }

  const show3D = (): void => {
    openView({ kind: '3d' });
    // if {3D} was already the active one nothing was touched: the title is put back (when coming from Home)
    const a = tabs.active;
    if (a) setDocumentTitle(titleName(), viewLabel(a.view));
  };

  /** Level button: creates the level and selects it (Properties shows it at once). */
  async function addLevel(): Promise<void> {
    const id = await opts.studio?.addLevel();
    const path = id ? deps.pathOfId(id) : null;
    if (path) deps.select(path);
  }

  /**
   * Levels on screen. The list under the ViewCube always (it highlights the selected level and the
   * one of the open plan); the marks only in {3D} and elevations, with a model and a style other than
   * Off. With Selected only the selected level is drawn, as a plane.
   */
  function refreshLevelViews(): void {
    const v = tabs.active?.view;
    const level = state.selected && state.levels.some((l) => l.path === state.selected) ? state.selected : null;
    levelList.update(state.levels, [...(level ? [level] : []), ...(v?.kind === 'plan' ? [v.level.path] : [])]);
    if (!state.model || state.levelsStyle === 'off' || !(v?.kind === '3d' || v?.kind === 'elevation')) return levelMarksView.clear();
    if (state.levelsStyle === 'selected') {
      const one = state.levels.filter((l) => l.path === level);
      return levelMarksView.show(levelMarks(one, viewer.modelFootprint), 'plane', level);
    }
    levelMarksView.show(levelMarks(state.levels, viewer.modelFootprint), state.levelsStyle, level);
  }

  return {
    openView,
    activateView,
    closeView,
    openPlan,
    applyActive,
    renderTabs,
    refreshLevelViews,
    planCut,
    titleName,
    docName,
    applyViewRange,
    show3D,
    addLevel,
    levelMarks: () => levelMarksView.marks,
  };
}
