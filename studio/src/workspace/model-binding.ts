import { viewLabel } from '../browser/views';
import type { WorkspaceAgentApi } from '../assistant/studio/host';
import { explainElement } from '../assistant/studio/provenance';
import type { StackRow } from '../composer/rows';
import type { StageData } from '../composer/stagepanel';
import { catalog } from '../materials/catalog';
import type { LoadedModel } from '../model/load';
import { withDocumentLevels } from '../modeling/levels';
import { loadMode } from '../modes/memory';
import type { ElementColor } from '../render/coloroverride';
import { perfSpan } from '../render/perf';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { setDocumentTitle } from '../shell/screens';
import type { Toggle } from './constants';
import { NOT_STUDIO } from './constants';
import type { WorkspaceContext } from './context';
import type { DropController } from './drop';
import { el } from './layout';
import type { ModesHostController } from './modes-host';
import type { PanelsController } from './panels';
import type { SelectionController } from './selection';
import type { ViewTabs } from './viewtabs';
import type { ViewsController } from './views';
import type { WallController } from './tools/wall';

export interface ModelBindingDeps {
  tabs: ViewTabs;
  panels: PanelsController;
  views: ViewsController;
  selection: SelectionController;
  drop: DropController;
  wall: WallController;
  modes: ModesHostController;
  syncCostsRibbon(): void;
  setToggle(t: Toggle, on: boolean): void;
}

export interface ModelBindingController {
  setModel(m: LoadedModel | null): void;
  updateModel(m: LoadedModel): void;
  setEditable(on: boolean, withTools?: boolean): void;
  setStage(data: StageData): void;
  setComposer(rows: StackRow[] | null, data: StageData): void;
  setDirty(on: boolean): void;
  dataChanged(): void;
  highlight(paths: string[], c: ElementColor): void;
  clearHighlight(paths?: string[]): void;
  readonly agent: WorkspaceAgentApi;
}

/** Model, document and selection binding: the changes main.ts asks for and the Assistant API. */
export function mountModelBinding(ctx: WorkspaceContext, deps: ModelBindingDeps): ModelBindingController {
  const { layout, state, viewer, opts, status, ribbon } = ctx;
  const { view } = layout;
  const { tabs, panels, views, selection, drop, wall, modes } = deps;

  // --- Temporary Assistant colors ------------------------------------------------------
  /** Colors by composed path; they only exist in the view, never in the model. */
  let assistantColors = new Map<string, ElementColor>();
  let colorsChip: HTMLButtonElement | null = null;
  /** Without `paths` it clears everything; with `paths`, only those (the chip goes with the last one). */
  function clearAssistantColors(paths?: string[]): void {
    if (paths) {
      if (!paths.some((p) => assistantColors.has(p))) return;
      for (const p of paths) assistantColors.delete(p);
    } else assistantColors = new Map();
    if (assistantColors.size) {
      viewer.setAssistantColors(new Map(assistantColors));
      return;
    }
    viewer.setAssistantColors(null);
    colorsChip?.remove();
    colorsChip = null;
  }
  function highlight(paths: string[], c: ElementColor): void {
    for (const p of paths) assistantColors.set(p, c);
    viewer.setAssistantColors(new Map(assistantColors));
    if (!colorsChip) {
      colorsChip = el('button', 'ws-assistant-colors', 'Assistant colors \u2715') as HTMLButtonElement;
      colorsChip.type = 'button';
      colorsChip.title = 'Remove the colors the Assistant put on the view';
      colorsChip.addEventListener('click', () => clearAssistantColors());
      view.append(colorsChip);
    }
  }

  function setModel(m: LoadedModel | null): void {
    wall.stop();
    viewer.disposeModel(); // release the GPU of the previous model before building the new one
    state.model = m;
    const root = m?.result.root ?? null;
    viewer.setSavedColors(m?.savedColors ?? null);
    perfSpan('studio.viewer', () => viewer.setModel(root));
    state.levels = root ? perfSpan('studio.levels', () => withDocumentLevels(root, viewer.levels())) : []; // sorted bottom to top; includes Studio levels without geometry
    perfSpan('studio.browser', () => panels.setBrowserModel(root, state.levels));
    perfSpan('studio.stage', () => setStage({ ...panels.stageData, root }));
    state.selection = [];
    clearAssistantColors();
    selection.select(null);
    status.setMessage(null);
    tabs.clear();
    tabs.open({ kind: '3d' });
    viewer.setProjection('perspective');
    viewer.setSectionAt(false, 0);
    if (root) viewer.fit(null, false);
    views.applyActive();
    modes.switcher.set(loadMode(m?.path ?? null)); // each document opens in its last mode
  }

  function updateModel(m: LoadedModel): void {
    viewer.disposeModel();
    state.model = m;
    const root = m.result.root;
    viewer.setSavedColors(m.savedColors ?? null);
    viewer.setModel(root);
    state.levels = withDocumentLevels(root, viewer.levels());
    panels.setBrowserModel(root, state.levels);
    setStage({ ...panels.stageData, root });
    tabs.refreshLevels(state.levels); // a renamed or moved level changes its tab and its cut plane
    views.renderTabs();
    // the new model comes back without a cut: the active view's cut is restored without touching the camera
    const v = tabs.active?.view;
    if (v?.kind === 'plan') viewer.setSectionAt(true, views.planCut(v));
    else if (state.toggles.section) viewer.setSectionBox(true);
    views.applyViewRange(v); // the new model comes back without a range: the active view's range is restored
    state.selection = state.selection.filter((p) => m.result.byPath.has(p));
    selection.applySelection();
    setDocumentTitle(views.titleName(), v ? viewLabel(v) : null);
    if (modes.switcher.current === 'materials') modes.materials?.refresh();
    if (modes.switcher.current === 'costs') {
      modes.costs?.refresh();
      deps.syncCostsRibbon();
    }
    if (modes.switcher.current === 'schedule') modes.schedule?.refresh();
  }

  function dataChanged(): void {
    if (modes.switcher.current === 'costs') {
      modes.costs?.refresh();
      deps.syncCostsRibbon();
    }
    if (modes.switcher.current === 'schedule') modes.schedule?.refresh();
  }

  function setEditable(on: boolean, withTools = on): void {
    state.editable = on;
    state.tools = on && withTools;
    const why = on ? NOT_STUDIO : NOT_EDITABLE;
    ribbon.setEnabled('wall', state.tools, state.tools ? '' : why);
    ribbon.setEnabled('floor', state.tools, state.tools ? '' : why);
    ribbon.setEnabled('level', state.tools, state.tools ? '' : why);
    for (const a of ['matNew', 'matAssign', 'matRule'] as const) ribbon.setEnabled(a, on, on ? '' : NOT_EDITABLE);
    for (const a of ['costEdit', 'costEditSystem', 'costAssign', 'costClearAssign'] as const) {
      ribbon.setEnabled(a, on, on ? '' : NOT_EDITABLE);
    }
    for (const a of ['schNew', 'schEdit', 'schDelete', 'schLink', 'schByLevel', 'schCalendar', 'schBaseline', 'schImport'] as const) {
      ribbon.setEnabled(a, on, on ? '' : NOT_EDITABLE);
    }
    modes.materials?.setEditable(on);
    modes.costs?.setEditable(on);
    modes.schedule?.setEditable(on);
    wall.stop();
    panels.showProperties(selection.selectedNode()); // in read-only there are no fields
    drop.showMove(selection.selectedNode()); // in read-only there is no Move box
  }

  function setStage(data: StageData): void {
    panels.setStage(data);
    // the selection stays highlighted after rebuilding the tree
    const node = selection.selectedNode();
    if (node) panels.reveal(node.path);
    // the element's source layer and its edit marks may have changed
    panels.showProperties(node);
    panels.setReferencesModel(state.model ? { result: state.model.result, path: state.model.path } : null);
    panels.selectReference(node);
    drop.showMove(node);
  }

  /** Rows of the stack of the last setComposer (the Assistant queries them). */
  let stackRows: StackRow[] | null = null;

  function setComposer(rows: StackRow[] | null, data: StageData): void {
    stackRows = rows;
    panels.setStack(rows);
    drop.setPlaceTargets(rows);
    drop.setLibraryEnabled(rows !== null);
    setStage(data);
  }

  function setDirty(on: boolean): void {
    state.dirty = on;
    const v = tabs.active?.view;
    setDocumentTitle(views.titleName(), v ? viewLabel(v) : null);
  }

  const agent: WorkspaceAgentApi = {
    model: () => (state.model?.result.root ? { name: state.model.name, path: state.model.path, root: state.model.result.root } : null),
    levels: () => state.levels.map((l) => ({ name: l.name, elevation: l.minZ, path: l.path })),
    selection: () => [...state.selection],
    select: (path) => selection.select(path),
    selectMany: (paths) => {
      state.selection = paths.filter((p) => state.model?.result.byPath.has(p));
      selection.applySelection('agent');
    },
    highlight,
    clearHighlight: clearAssistantColors,
    materials: () =>
      catalog(state.model ? opts.materials?.nodes() ?? [] : [], state.model ? viewer.quantities(false) : []).map(
        (e) => ({ code: e.def.code, name: e.def.name, color: e.def.color, opacity: e.def.opacity, elements: e.elements }),
      ),
    provenance: (path) => {
      const n = state.model?.result.byPath.get(path);
      return n && state.model ? explainElement(n, state.model.result.provenance, state.model.path) : null;
    },
    openView: (v) => {
      if (v.kind !== 'plan') return views.openView(v.kind === '3d' ? { kind: '3d' } : { kind: 'elevation', side: v.side });
      if (v.level === null) return views.openPlan();
      const level = state.levels.find((l) => l.name === v.level);
      if (level) views.openView({ kind: 'plan', level });
    },
    fit: (path) => viewer.fit(path),
    setToggle: (name, on) => deps.setToggle(name, on),
    layers: () =>
      (stackRows ?? []).flatMap((r) =>
        r.kind === 'file' ? [{ id: r.id, name: r.name, uri: r.path, enabled: r.enabled, hidden: panels.isLayerHidden(r.id) }] : [],
      ),
    setLayerHidden: (id, hidden) => panels.setLayerHidden(id, hidden),
    screenshot: () => (tabs.active ? viewer.screenshot() : null),
    libraryFolder: () => drop.libraryFolder(),
  };

  return {
    setModel,
    updateModel,
    setEditable,
    setStage,
    setComposer,
    setDirty,
    dataChanged,
    highlight,
    clearHighlight: clearAssistantColors,
    agent,
  };
}
