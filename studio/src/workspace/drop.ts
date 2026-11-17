import type { ComposedNode } from '../ifcx/types';
import { editPath } from '../composer/edits';
import { mountMoveBox } from '../composer/movebox';
import { draggedAsset, mountLibraryPanel } from '../library/librarypanel';
import { displayName } from '../ifcx/names';
import type { ModeId } from '../modes/definition';
import { pointOnLevel } from '../modeling/walltool';
import type { Vec2 } from '../modeling/footprint';
import { MATERIAL_DRAG_TYPE } from '../materials/browserpanel';
import { COST_CODE_DRAG } from '../costs/treepanel';
import type { PlaceTarget, StackRow } from '../composer/rows';
import type { StageData } from '../composer/stagepanel';
import type { Vec3 } from '../composer/xform';
import {
  allowedAxes, rotScaleAxes, targetPosition, targetRotScale, type MoveStudio, type MoveTarget,
} from '../document/controller';
import type { WorkspaceContext } from './context';
import { mountGizmo } from './gizmo';
import type { ViewTabs } from './viewtabs';

export interface DropDeps {
  tabs: ViewTabs;
  currentMode(): ModeId;
  /** Climbs to the element's path for a material or cost code drop. */
  elementPath(path: string): string;
  /** Studio id of a composed path (for the plan level). */
  idOfPath(path: string): string;
  /** A drawing tool is active (wall or floor sketch). */
  drawing(): boolean;
  /** Data of the Stage brought by the last setComposer. */
  stageData(): StageData;
  /** Layers with their edits off. */
  editsOff(): ReadonlySet<string>;
  dropCode(code: string, elementPath: string | null): void;
  dropMaterial(code: string, elementPath: string | null): void;
}

export interface DropController {
  placeAsset(path: string): void;
  setPlaceTargets(rows: StackRow[] | null): void;
  setLibraryEnabled(on: boolean): void;
  setLibraryFolder(dir: string | null): Promise<void>;
  libraryFolder(): string | null;
  showMove(node: ComposedNode | null): void;
  refreshGizmo(): void;
  readonly gizmoDragging: boolean;
}

export function mountDrop(ctx: WorkspaceContext, deps: DropDeps): DropController {
  const { layout, state, viewer, opts } = ctx;
  const { view, canvasHost, layerHost, libHost, moveHost } = layout;
  const { tabs } = deps;

  /** Where a file can be placed (project and levels); empty without a document or in read-only. */
  let placeTargets: PlaceTarget[] = [];
  /** Library panel folder right now (the Assistant queries it). */
  let libraryDir: string | null = opts.library?.folder ?? null;
  const library = mountLibraryPanel(libHost, {
    chooseFolder: () => opts.library?.chooseFolder() ?? Promise.resolve(null),
    list: (dir) => opts.library?.list(dir) ?? Promise.resolve([]),
    onFolderChange: (dir) => {
      libraryDir = dir;
      opts.library?.onFolderChange?.(dir);
    },
    onActivate: (path) => dropAsset(path, null),
    onOpenCollection: opts.library?.onOpenCollection,
  });
  if (opts.library?.folder) void library.setFolder(opts.library.folder);

  /** Point of the horizontal plane at elevation `z` under the pointer (null if the ray misses it). */
  const groundPoint = (e: MouseEvent, z: number): Vec2 | null => {
    if (opts.pickPoint) return opts.pickPoint(e as PointerEvent);
    const r = canvasHost.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    return pointOnLevel(ndc, viewer.camera, z);
  };

  /**
   * Places a library file: on a plan, under its level; otherwise, under the project. Dropped on the
   * view (`e`), at the ground point under the pointer. In read-only it is only linked.
   */
  function dropAsset(path: string, e: MouseEvent | null): void {
    if (!state.editable || !placeTargets.length) {
      void opts.composer?.linkAsset?.(path);
      return;
    }
    const v = tabs.active?.view;
    const levelId = v?.kind === 'plan' ? deps.idOfPath(v.level.path) : null;
    // the plan's level (also the storey of an IFCx that is not from Studio: the controller validates it)
    const parent = levelId ?? placeTargets[0].id;
    // plan and 3D elevations: the level's floor, or elevation 0
    const at = e && (v?.kind === 'plan' || v?.kind === '3d') ? groundPoint(e, v.kind === 'plan' ? v.level.minZ : 0) : null;
    void opts.composer?.placeAsset?.(path, parent, at ?? undefined);
  }

  const materialDrag = (e: DragEvent): boolean => !!e.dataTransfer?.types && [...e.dataTransfer.types].includes(MATERIAL_DRAG_TYPE);
  const costDrag = (e: DragEvent): boolean => !!e.dataTransfer?.types && [...e.dataTransfer.types].includes(COST_CODE_DRAG);
  view.addEventListener('dragover', (e) => {
    if (costDrag(e) && deps.currentMode() === 'costs') {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (materialDrag(e) && deps.currentMode() === 'materials') {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!draggedAsset() || !tabs.active) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    view.classList.add('lib-drop-target');
  });
  view.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node) || !view.contains(e.relatedTarget)) view.classList.remove('lib-drop-target');
  });
  view.addEventListener('drop', (e) => {
    view.classList.remove('lib-drop-target');
    if (costDrag(e) && deps.currentMode() === 'costs') {
      e.preventDefault();
      const hit = viewer.pick(e);
      deps.dropCode(e.dataTransfer!.getData(COST_CODE_DRAG), hit ? deps.elementPath(hit) : null);
      return;
    }
    if (materialDrag(e) && deps.currentMode() === 'materials') {
      e.preventDefault();
      const hit = viewer.pick(e);
      deps.dropMaterial(e.dataTransfer!.getData(MATERIAL_DRAG_TYPE), hit ? deps.elementPath(hit) : null);
      return;
    }
    const path = draggedAsset();
    if (!path || !tabs.active) return;
    e.preventDefault();
    dropAsset(path, e);
  });
  layerHost.addEventListener('dragover', (e) => {
    if (!draggedAsset()) return; // without a document the cards cannot be dragged
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
  });
  layerHost.addEventListener('drop', (e) => {
    const path = draggedAsset();
    if (!path) return;
    e.preventDefault();
    void opts.composer?.linkAsset?.(path);
  });

  /** What the Move box moves (null if it is not shown). */
  let moveTarget: MoveTarget | null = null;
  const moveBox = mountMoveBox(moveHost, {
    moveTo: (p) => {
      if (moveTarget) void opts.composer?.moveTo?.(moveTarget, p);
    },
    moveBy: (d) => {
      if (moveTarget) void opts.composer?.moveBy?.(moveTarget, d);
    },
    rotateTo: opts.composer?.rotateTo && ((r) => {
      if (moveTarget) void opts.composer?.rotateTo?.(moveTarget, r);
    }),
    scaleTo: opts.composer?.scaleTo && ((sc) => {
      if (moveTarget) void opts.composer?.scaleTo?.(moveTarget, sc);
    }),
  });
  /** Without editable Properties there are no Studio walls, floors or levels to move. */
  const noStudio: MoveStudio = { levels: () => [], wall: () => undefined, floor: () => undefined };
  /** Axes and position of the Move box (the arrows use the same). */
  let moveAxes: { x: boolean; y: boolean; z: boolean } | null = null;
  let moveOrigin: Vec3 = [0, 0, 0];
  // X/Y/Z arrows in the view: dragging moves the element; the Move box follows the drag
  const gizmo = mountGizmo(
    viewer,
    canvasHost.querySelector('canvas') ?? canvasHost, // on the canvas, like the orbit: they share pointer capture
    {
      preview: (d) => moveBox.preview([moveOrigin[0] + d[0], moveOrigin[1] + d[1], moveOrigin[2] + d[2]]),
      // false if there is nothing to save it with: the preview is undone
      commit: (d) => (moveTarget && opts.composer?.moveBy ? opts.composer.moveBy(moveTarget, d) : false),
      cancel: () => moveBox.preview(moveOrigin), // the box goes back to the real position
    },
    opts.makeTransformControls,
    ctx.dispose,
  );
  /** Arrows over the selection if it can be moved, without a drawing tool or a walk. */
  function refreshGizmo(): void {
    const kind = tabs.active?.view.kind;
    const on = state.selected && state.selection.length <= 1 && moveTarget && moveAxes && kind && !deps.drawing() && !viewer.walking;
    gizmo.attach(on ? state.selected : null, moveAxes ?? { x: false, y: false, z: false }, kind);
  }

  /**
   * Move box of the selected element: only in editable documents and if the element can move on
   * some axis. Its branch (document or linked layer) comes from the Stage (`sourceOf`).
   */
  function showMove(node: ComposedNode | null): void {
    const source = node ? deps.stageData().sourceOf.get(node.origin) : undefined;
    const t: MoveTarget | null =
      !node || !state.model || !state.editable || !opts.composer?.moveBy || !source || deps.editsOff().has(source) ? null
      : source === 'document' ? { branch: 'document', origin: node.origin }
      : { branch: source, path: editPath(node, state.model.result), node };
    const studio = opts.studio ?? noStudio;
    const axes = t ? allowedAxes(t, studio) : null;
    const rs = t ? rotScaleAxes(t, studio) : null;
    const any = (a: { x: boolean; y: boolean; z: boolean } | null | undefined) => !!a && (a.x || a.y || a.z);
    moveTarget = any(axes) || any(rs?.rot) || any(rs?.scale) ? t : null;
    // moveAxes governs the arrows: only with some translation axis
    moveAxes = moveTarget && any(axes) ? axes : null;
    moveOrigin = moveTarget ? targetPosition(moveTarget, studio) : [0, 0, 0];
    const now = moveTarget ? targetRotScale(moveTarget, studio) : null;
    moveBox.show(
      moveTarget && node && axes && rs && now
        ? { title: displayName(node), pos: moveOrigin, axes, rot: now.rot, rotAxes: rs.rot, scale: now.scale, scaleAxes: rs.scale }
        : null,
    );
    refreshGizmo();
  }

  return {
    placeAsset: (path) => dropAsset(path, null),
    setPlaceTargets: (rows) => {
      placeTargets = (rows ?? []).flatMap((r) => (r.kind === 'document' ? r.targets ?? [] : []));
    },
    setLibraryEnabled: (on) => library.setEnabled(on),
    setLibraryFolder: (dir) => {
      libraryDir = dir;
      return library.setFolder(dir);
    },
    libraryFolder: () => libraryDir,
    showMove,
    refreshGizmo,
    get gizmoDragging() {
      return gizmo.dragging;
    },
  };
}
