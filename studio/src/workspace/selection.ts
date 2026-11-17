import type { ComposedNode } from '../ifcx/types';
import type { LevelMark } from './levelmarks-geom';
import { pickLevelEdge, pickLevelPlane } from './levelmarks-geom';
import { hoverText } from './statusbar';
import type { WorkspaceContext } from './context';
import type { WorkspaceViewer } from './types';

export type SelectionFrom = 'viewer' | 'browser' | 'stage' | 'keyboard' | 'agent';

export interface SelectionDeps {
  showProperties(node: ComposedNode | null): void;
  showMove(node: ComposedNode | null): void;
  refreshLevelViews(): void;
  reveal(path: string | null): void;
  markSelected(paths: string[]): void;
  selectReference(node: ComposedNode | null): void;
  /** Tells the active modes which path is selected. */
  selectionChanged(path: string | null): void;
  /** A drawing tool is active (wall or floor sketch). */
  drawing(): boolean;
  /** The move arrows are dragging. */
  gizmoDragging(): boolean;
  /** The level marks currently drawn in the viewer. */
  levelMarks(): LevelMark[];
  projectWorld(x: number, y: number, z: number): { x: number; y: number } | null;
}

export interface SelectionController {
  select(path: string | null, from?: SelectionFrom, toggle?: boolean): void;
  applySelection(from?: SelectionFrom): void;
  selectedNode(): ComposedNode | null;
  elementPath(path: string): string;
  idOfPath(path: string): string;
  pathOfId(id: string): string | null;
  ifcClass(node: ComposedNode): unknown;
}

export function mountSelection<V extends WorkspaceViewer>(
  ctx: WorkspaceContext<V>,
  deps: SelectionDeps,
): SelectionController {
  const { layout, state, viewer, opts, status } = ctx;
  const { canvasHost } = layout;

  const ifcClass = (n: ComposedNode): unknown => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;

  /**
   * Climbs from the chosen path to the first ancestor (or the path itself) with an IFC class or
   * that is the container of a placed file: the element is selected, like in Revit.
   */
  function elementPath(path: string): string {
    let n = state.model?.result.byPath.get(path) ?? null;
    const start = n;
    while (n && !ifcClass(n) && !opts.studio?.placement?.(n.origin)) n = n.parent;
    return (n ?? start)?.path ?? path;
  }

  /** Studio id (the `origin` of the node) of a composed path; the path itself when the node does not exist. */
  const idOfPath = (path: string): string => state.model?.result.byPath.get(path)?.origin ?? path;

  /** Composed path of the node with that Studio id. */
  const pathOfId = (id: string): string | null => {
    for (const n of state.model?.result.byPath.values() ?? []) if (n.origin === id) return n.path;
    return null;
  };

  function select(path: string | null, from: SelectionFrom = 'viewer', toggle = false): void {
    if (path) path = elementPath(path);
    if (!toggle) state.selection = path ? [path] : [];
    else if (path) state.selection = state.selection.includes(path) ? state.selection.filter((p) => p !== path) : [...state.selection, path];
    applySelection(from);
  }

  /** Applies `state.selection` to the view, the Stage, Properties and the modes (which get the main one). */
  function applySelection(from: SelectionFrom = 'viewer'): void {
    const path = state.selection.at(-1) ?? null;
    state.selected = path;
    const node = path ? state.model?.result.byPath.get(path) ?? null : null;
    // a level is not "all of its content": selecting it does not highlight its walls in 3D
    state.inViewer = node && ifcClass(node) === 'IfcBuildingStorey' ? null : path;
    if (state.selection.length > 1) viewer.selectMany(state.selection);
    else viewer.select(state.inViewer);
    // the selection shows in the Stage (without changing tabs) also when clicking it there: with Ctrl the
    // clicked row may have been removed and the main one may be another
    deps.reveal(node?.path ?? null);
    deps.showProperties(node);
    deps.markSelected(state.selection);
    deps.selectReference(node);
    deps.showMove(node);
    deps.refreshLevelViews();
    deps.selectionChanged(path);
  }

  /** Selected node in the current model. */
  const selectedNode = (): ComposedNode | null => (state.selected ? state.model?.result.byPath.get(state.selected) ?? null : null);

  /** Level (line or plane) under the last click, computed before the viewer reports its `onPick`. */
  let levelHit: { edge: string | null; plane: string | null } = { edge: null, plane: null };

  canvasHost.addEventListener(
    'pointerup',
    (e) => {
      levelHit = { edge: null, plane: null };
      const shown = deps.levelMarks();
      if (!shown.length || deps.drawing()) return;
      const client = { x: e.clientX, y: e.clientY };
      levelHit.edge = pickLevelEdge(shown, deps.projectWorld, client);
      if (state.levelsStyle === 'plane') levelHit.plane = pickLevelPlane(shown, deps.projectWorld, client);
    },
    true,
  );

  // The level line wins; then the element; the inside of a plane only when nothing is below it.
  viewer.onPick = (p, toggle) => {
    const { edge, plane } = levelHit;
    levelHit = { edge: null, plane: null };
    if (deps.gizmoDragging()) return; // the click that ends an arrow drag does not select
    if (!deps.drawing()) select(edge ?? p ?? plane, 'viewer', !!toggle && (edge ?? p ?? plane) !== null);
  };
  viewer.onHover = (p) => {
    if (deps.drawing()) return; // the status bar shows the tool instruction
    const n = p ? state.model?.result.byPath.get(p) : undefined;
    status.setMessage(n ? hoverText(n) : null);
  };

  return { select, applySelection, selectedNode, elementPath, idOfPath, pathOfId, ifcClass };
}
