import * as THREE from 'three';
import type { ComposedNode } from '../../ifcx/types';
import type { Vec2 } from '../../modeling/footprint';
import { JOIN_TOLERANCE } from '../../modeling/constants';
import { snapWallEnd, wallAngleDeg, type OrthoAxis } from '../../modeling/snap';
import { pointOnLevel, WallTool } from '../../modeling/walltool';
import { toast } from '../../shell/toast';
import { CLICK_SLOP } from '../constants';
import type { WorkspaceContext } from '../context';
import { mountWallOptionsBar } from '../optionsbar';
import type { SelectionFrom } from '../selection';
import type { ViewTabs } from '../viewtabs';
import { createWallPreview } from '../wallpreview';

export interface WallDeps {
  host: HTMLElement;
  tabs: ViewTabs;
  openPlan(): void;
  floorActive(): boolean;
  floorStart(): Vec2 | null;
  floorChainStart(): Vec2 | null;
  stopFloor(): void;
  sketchClick(p: Vec2): void;
  sketchMove(p: Vec2 | null, z: number): void;
  refreshSketch(): void;
  floorDeleteSelected(): boolean;
  select(path: string | null, from?: SelectionFrom): void;
  idOfPath(path: string): string;
  ifcClass(node: ComposedNode): unknown;
  refreshGizmo(): void;
}

export interface WallController {
  active(): boolean;
  drawing(): boolean;
  /** Restarts the chain on the active plan. */
  restart(): void;
  /** Cancels and ends the tool. */
  stop(): void;
  start(): void;
  levelZ(): number | null;
  project(p: Vec2): { x: number; y: number } | null;
  pickSnapped(e: PointerEvent, shift: boolean): { point: Vec2; axis: OrthoAxis | null } | null;
  deleteSelected(): void;
  /** Esc with the tool active: cuts the chain or exits. */
  escape(): void;
}

export function mountWallTool(ctx: WorkspaceContext, deps: WallDeps): WallController {
  const { layout, state, viewer, opts, status, ribbon } = ctx;
  const { canvasHost } = layout;
  const { tabs } = deps;

  const tool = new WallTool();
  const preview = createWallPreview(viewer);
  /** Last mouse move over the canvas: lets it repaint when pressing or releasing Shift without moving. */
  let lastMove: PointerEvent | null = null;

  // Wall Options Bar: toggling Chain cuts the running chain (like pressing Esc once)
  const wallOptions = mountWallOptionsBar((on) => {
    tool.chain = on;
    if (!tool.active) return;
    tool.cutChain();
    preview.clear();
    status.setMessage(tool.prompt);
  });
  layout.ribbonHost.after(wallOptions.root);

  /** A drawing tool is active (wall or floor sketch). */
  const drawing = (): boolean => tool.active || deps.floorActive();

  function endTool(wasActive: boolean): void {
    lastMove = null;
    wallOptions.setVisible(false);
    canvasHost.classList.remove('drawing');
    preview.clear();
    ribbon.setPressed('wall', false);
    if (wasActive) status.setMessage(null);
    deps.refreshGizmo();
  }

  function stopTool(): void {
    deps.stopFloor();
    const was = tool.active;
    tool.cancel();
    endTool(was);
  }

  function startWall(): void {
    if (!state.tools) return void ribbon.setPressed('wall', false);
    if (!state.levels.length) {
      toast('Add a level to draw walls', 'info');
      return void ribbon.setPressed('wall', false);
    }
    if (tabs.active?.view.kind !== 'plan') deps.openPlan();
    tool.chain = wallOptions.chain;
    tool.start();
    wallOptions.setVisible(true);
    canvasHost.classList.add('drawing'); // crosshair cursor while drawing
    status.setMessage(tool.prompt);
    deps.refreshGizmo(); // no arrows while drawing
  }

  /** Elevation of the active plan's level (null outside plans). */
  const levelZ = (): number | null => {
    const v = tabs.active?.view;
    return v?.kind === 'plan' ? v.level.minZ : null;
  };

  const pick = (e: PointerEvent): Vec2 | null => {
    if (opts.pickPoint) return opts.pickPoint(e);
    const z = levelZ();
    if (z === null) return null;
    const r = canvasHost.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    return pointOnLevel(ndc, viewer.camera, z);
  };

  /** Point on the plane → client coordinates (inverse of pick). */
  const project = (p: Vec2): { x: number; y: number } | null => {
    if (opts.projectPoint) return opts.projectPoint(p);
    const z = levelZ();
    if (z === null) return null;
    const r = canvasHost.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    viewer.camera.updateMatrixWorld();
    const v = new THREE.Vector3(p[0], p[1], z).project(viewer.camera);
    if (!Number.isFinite(v.x) || v.z > 1) return null;
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };

  /** pick + closing snap to the chain's first point + orthogonal snap (Shift forces it). */
  const pickSnapped = (e: PointerEvent, shift: boolean): { point: Vec2; axis: OrthoAxis | null } | null => {
    const p = pick(e);
    const floor = deps.floorActive();
    const start = floor ? deps.floorStart() : tool.currentStart;
    if (!p || !start) return p ? { point: p, axis: null } : null;
    const first = floor ? deps.floorChainStart() : tool.chainStart;
    // with a single wall drawn there is no chain to close to
    const chainStart = first && Math.hypot(first[0] - start[0], first[1] - start[1]) > JOIN_TOLERANCE ? first : null;
    return snapWallEnd(p, start, chainStart, project, { x: e.clientX, y: e.clientY }, shift);
  };

  let down: { x: number; y: number } | null = null;
  canvasHost.addEventListener('pointerdown', (e) => {
    down = drawing() && !viewer.walking && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  });
  canvasHost.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || !drawing() || viewer.walking || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
    const sp = pickSnapped(e as PointerEvent, e.shiftKey);
    if (!sp) return;
    if (deps.floorActive()) return deps.sketchClick(sp.point);
    const r = tool.click(sp.point);
    preview.clear();
    status.setMessage(tool.prompt);
    const v = tabs.active?.view;
    if (r && v?.kind === 'plan') opts.editor?.addWall(r.start, r.end, deps.idOfPath(v.level.path));
  });
  const updatePreview = (e: PointerEvent, shift: boolean): void => {
    const z = levelZ();
    if (!drawing() || viewer.walking || z === null) return;
    const sp = pickSnapped(e, shift);
    if (deps.floorActive()) return deps.sketchMove(sp?.point ?? null, z);
    const m = sp ? tool.move(sp.point) : null;
    if (sp && m) {
      preview.show(m.start, m.end, z);
      if (sp.axis) preview.showGuide(m.start, m.end, z);
      else preview.clearGuide();
      const len = Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]);
      status.setMessage(`${tool.prompt} — Length: ${len.toFixed(2)} m · Angle: ${wallAngleDeg(m.start, m.end).toFixed(2)}°`);
    } else preview.clear();
  };
  canvasHost.addEventListener('pointermove', (e) => {
    lastMove = e as PointerEvent;
    updatePreview(lastMove, e.shiftKey);
  });

  // Shift pressed or released with the mouse still: repaints with the new state
  function shiftChanged(e: KeyboardEvent): void {
    if (e.key !== 'Shift' || !lastMove || !drawing()) return;
    if (deps.host.hidden || !deps.host.isConnected || deps.host.closest('[hidden]')) return;
    updatePreview(lastMove, e.type === 'keydown');
  }
  const onShiftKeydown = (e: KeyboardEvent): void => shiftChanged(e);
  const onShiftKeyup = (e: KeyboardEvent): void => shiftChanged(e);
  window.addEventListener('keydown', onShiftKeydown);
  window.addEventListener('keyup', onShiftKeyup);
  ctx.dispose.add(() => {
    window.removeEventListener('keydown', onShiftKeydown);
    window.removeEventListener('keyup', onShiftKeyup);
  });

  /** Esc with the tool active: cuts the chain or exits. */
  function toolEscape(): void {
    if (tool.escape() === 'exit') endTool(true); // escape() already cancelled the tool
    else {
      preview.clear();
      status.setMessage(tool.prompt);
    }
  }

  function deleteSelected(): void {
    if (deps.floorActive()) {
      if (deps.floorDeleteSelected()) deps.refreshSketch();
      return;
    }
    const n = state.selected ? state.model?.result.byPath.get(state.selected) : undefined;
    if (!state.tools || !n) return;
    const stair = opts.studio?.stair?.(n.origin);
    if (stair) {
      opts.editor?.deleteStair?.(stair.id);
      deps.select(null, 'keyboard');
      return;
    }
    const cls = deps.ifcClass(n);
    if (cls !== 'IfcWall' && cls !== 'IfcSlab') return;
    if (cls === 'IfcWall') opts.editor?.deleteWall(n.origin);
    else opts.editor?.deleteFloor(n.origin);
    deps.select(null, 'keyboard');
  }

  // The options bar is shown/hidden by start/stop.

  return {
    active: () => tool.active,
    drawing,
    restart: () => {
      tool.start();
      preview.clear();
      status.setMessage(tool.prompt);
    },
    stop: stopTool,
    start: startWall,
    levelZ,
    project,
    pickSnapped,
    deleteSelected,
    escape: toolEscape,
  };
}
