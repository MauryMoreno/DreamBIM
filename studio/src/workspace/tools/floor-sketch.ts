import { FLOOR_SKETCH_TAB } from '../../ribbon/definition';
import { NOT_EDITABLE } from '../../ribbon/filemenu';
import { toast } from '../../shell/toast';
import { FloorTool } from '../../modeling/floortool';
import type { Vec2 } from '../../modeling/footprint';
import { NOT_STUDIO } from '../constants';
import type { WorkspaceContext } from '../context';
import type { SelectionFrom } from '../selection';
import { createSketchPreview } from '../sketchpreview';
import type { ViewTabs } from '../viewtabs';
import type { WallController } from './wall';

export interface FloorDeps {
  tabs: ViewTabs;
  wall: Pick<WallController, 'active' | 'stop' | 'project' | 'levelZ'>;
  openPlan(): void;
  refreshGizmo(): void;
  select(path: string | null, from?: SelectionFrom): void;
  idOfPath(path: string): string;
  pathOfId(id: string): string | null;
}

export interface FloorController {
  active(): boolean;
  start(): void;
  /** Leaves the sketch discarding it (Cancel, view change or document change). */
  stop(): void;
  /** Start point of the current chain (for the closing snap). */
  startPoint(): Vec2 | null;
  /** First point of the chain (for the closing snap). */
  chainStartPoint(): Vec2 | null;
  sketchClick(p: Vec2): void;
  sketchMove(p: Vec2 | null, z: number): void;
  refresh(): void;
  deleteSelected(): boolean;
  /** Esc in the sketch: cuts the chain, leaves the drawing tool or exits the sketch. */
  escape(): void;
  setMode(m: 'pick' | 'line' | 'rect'): void;
  /** Finish Edit Mode. */
  finish(): Promise<void>;
}

export function mountFloorSketch(ctx: WorkspaceContext, deps: FloorDeps): FloorController {
  const { layout, state, opts, status, ribbon } = ctx;
  const { canvasHost } = layout;
  const { tabs } = deps;

  // floor sketch (Floor): magenta line on the plan until Finish or Cancel
  const floorTool = new FloorTool();
  const sketch = createSketchPreview(ctx.viewer);
  /** Lines with a loose end after a rejected Finish: highlighted until the next change. */
  let openLines: string[] = [];

  /** Radius (m) at which a click reaches a sketch line: 6 px, or 10 cm if the view is not projectable. */
  const PICK_PX = 6;
  const PICK_FALLBACK = 0.1;
  const sketchTol = (p: Vec2): number => {
    const a = deps.wall.project(p);
    const b = deps.wall.project([p[0] + 1, p[1]]);
    const pxPerM = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    return Number.isFinite(pxPerM) && pxPerM > 1e-6 ? PICK_PX / pxPerM : PICK_FALLBACK;
  };

  /** Studio id of the active plan's level (null outside plans). */
  const planLevelId = (): string | null => {
    const v = tabs.active?.view;
    return v?.kind === 'plan' ? deps.idOfPath(v.level.path) : null;
  };

  /** Walls of the plan's level (the ones Pick Walls can choose). */
  const levelWalls = () => {
    const id = planLevelId();
    return id ? (opts.studio?.walls() ?? []).filter((w) => w.baseLevelId === id) : [];
  };

  /** Draws the sketch lines and restores the status bar message. */
  function refreshSketch(): void {
    const z = deps.wall.levelZ();
    if (z !== null) sketch.setLines(floorTool.lines, z, { selected: floorTool.selected, open: openLines });
    status.setMessage(floorTool.prompt);
  }

  function sketchClick(p: Vec2): void {
    openLines = [];
    floorTool.click(p, levelWalls(), sketchTol(p));
    sketch.setRubber([], deps.wall.levelZ() ?? 0);
    refreshSketch();
  }

  function sketchMove(p: Vec2 | null, z: number): void {
    const segs = p ? floorTool.move(p, levelWalls()) : [];
    sketch.setRubber(segs, z);
    const line = floorTool.mode === 'line' ? segs[0] : undefined;
    const len = line ? Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) : null;
    status.setMessage(len === null ? floorTool.prompt : `${floorTool.prompt} — Length: ${len.toFixed(2)} m`);
  }

  function setSketchMode(m: 'pick' | 'line' | 'rect'): void {
    if (!floorTool.active) return;
    floorTool.setMode(m);
    openLines = [];
    sketch.setRubber([], deps.wall.levelZ() ?? 0);
    refreshSketch();
  }

  function floorEscape(): void {
    const r = floorTool.escape();
    if (r === 'exit') return endSketch(true); // escape() already discarded the sketch
    if (r === 'mode-off') for (const a of ['sketchPick', 'sketchLine', 'sketchRect'] as const) ribbon.setPressed(a, false);
    sketch.setRubber([], deps.wall.levelZ() ?? 0);
    refreshSketch();
  }

  /** Wall, Floor and Level are not used while a sketch lasts. */
  function lockTools(locked: boolean): void {
    for (const a of ['wall', 'floor', 'level'] as const) {
      const on = !locked && state.tools;
      ribbon.setEnabled(a, on, locked ? 'Finish or cancel the current sketch first' : on ? '' : state.editable ? NOT_STUDIO : NOT_EDITABLE);
    }
  }

  function startFloor(): void {
    if (!state.tools) return void ribbon.setPressed('floor', false);
    if (!state.levels.length) {
      toast('Add a level to draw floors', 'info');
      return void ribbon.setPressed('floor', false);
    }
    deps.wall.stop(); // the wall (and any previous sketch) does not live with the floor
    if (tabs.active?.view.kind !== 'plan') deps.openPlan();
    floorTool.start();
    ribbon.setPressed('floor', true);
    ribbon.showContextual(FLOOR_SKETCH_TAB);
    ribbon.setPressed('sketchPick', true);
    lockTools(true);
    canvasHost.classList.add('drawing');
    refreshSketch();
    deps.refreshGizmo();
  }

  function stopFloor(): void {
    const was = floorTool.active;
    floorTool.cancel();
    endSketch(was);
  }

  /** Removes everything of the sketch from the workspace (tab, lines, locks). */
  function endSketch(was: boolean): void {
    openLines = [];
    sketch.clear();
    ribbon.hideContextual();
    ribbon.setPressed('floor', false);
    lockTools(false);
    if (!deps.wall.active()) canvasHost.classList.remove('drawing');
    if (was) status.setMessage(null);
    deps.refreshGizmo();
  }

  /** Finish Edit Mode: with a closed loop it creates the floor and selects it; otherwise it warns and continues. */
  async function finishFloor(): Promise<void> {
    if (!floorTool.active) return;
    const r = floorTool.finish();
    if (!r.ok) {
      openLines = r.open;
      refreshSketch();
      toast('Boundary must be a single closed loop.', 'error');
      return;
    }
    const levelId = planLevelId();
    endSketch(true); // finish() already discarded the sketch
    if (!levelId) return;
    const id = await opts.editor?.addFloor(r.polygon, levelId);
    const path = id ? deps.pathOfId(id) : null;
    if (path) deps.select(path);
  }

  return {
    active: () => floorTool.active,
    start: startFloor,
    stop: stopFloor,
    startPoint: () => floorTool.currentStart,
    chainStartPoint: () => floorTool.chainStart,
    sketchClick,
    sketchMove,
    refresh: refreshSketch,
    deleteSelected: () => floorTool.deleteSelected(),
    escape: floorEscape,
    setMode: setSketchMode,
    finish: finishFloor,
  };
}
