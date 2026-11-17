import { MODES, type ModeId } from '../modes/definition';
import { modeFromKey } from '../modes/keys';
import { saveMode } from '../modes/memory';
import { mountModeTabs } from '../modes/modetabs';
import { Slot } from '../modes/slot';
import { ModeSwitcher } from '../modes/switcher';
import { createCostsMode, type CostsMode } from '../costs/mode';
import { createMaterialsMode, type MaterialsMode } from '../materials/mode';
import { createScheduleMode, type FutureStyle, type ScheduleMode } from '../schedule/mode';
import { setPickShield } from '../schedule/pickshield';
import { toast } from '../shell/toast';
import type { RailItem } from './collapse';
import { BOQ_HEIGHT, GANTT_HEIGHT } from './constants';
import { onWindow, type WorkspaceContext } from './context';
import { isTyping } from './layout';
import type { FloorController } from './tools/floor-sketch';
import type { WallController } from './tools/wall';

export interface ModesHostDeps {
  host: HTMLElement;
  wall: WallController;
  floor: FloorController;
  setModeHidden(paths: ReadonlySet<string>): void;
  syncCostsRibbon(): void;
  scheduleFuture(): FutureStyle;
}

export interface ModesHostController {
  readonly switcher: ModeSwitcher;
  readonly materials: MaterialsMode | null;
  readonly costs: CostsMode | null;
  readonly schedule: ScheduleMode | null;
}

/** The four modes: their panels, the rails, the tabs and the mode shortcuts. */
export function mountModesHost(ctx: WorkspaceContext, deps: ModesHostDeps): ModesHostController {
  const { layout, state, viewer, opts, ribbon } = ctx;
  const { left, right, libHost, view, viewbar, leftPane, rightPane, bottomPane, showComposerTab } = layout;

  const materialsMode = opts.materials
    ? createMaterialsMode({
        actions: opts.materials,
        viewer,
        model: () => state.model,
        selected: () => state.selected,
        toast,
        editable: state.editable,
      })
    : null;
  const costsMode = opts.costs
    ? createCostsMode({
        actions: opts.costs,
        viewer,
        model: () => state.model,
        selected: () => state.selected,
        selection: () => [...state.selection],
        wallLength: (path) => {
          const w = opts.studio?.wall(state.model?.result.byPath.get(path)?.origin ?? '');
          return w ? Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) : null;
        },
        toast,
        editable: state.editable,
      })
    : null;
  const scheduleMode = opts.schedule
    ? createScheduleMode({
        actions: opts.schedule,
        viewer,
        model: () => state.model,
        selected: () => state.selected,
        selection: () => [...state.selection],
        setPicking: (on) => setPickShield(view, on),
        wallLength: (path) => {
          const w = opts.studio?.wall(state.model?.result.byPath.get(path)?.origin ?? '');
          return w ? Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) : null;
        },
        setHidden: (paths) => {
          deps.setModeHidden(paths);
        },
        toast,
        editable: state.editable,
      })
    : null;
  if (scheduleMode) {
    viewbar.append(scheduleMode.dateBar); // the timeline, in the view bar after the visual style
    view.append(scheduleMode.dateOverlay); // and the date, over the model, bottom left
  }
  if (scheduleMode) {
    // the critical path starts highlighted (the ribbon button turns it off)
    scheduleMode.setCritical(true);
    ribbon.setPressed('schCritical', true);
  }

  function railItemsFor(host: HTMLElement, fallback: string): RailItem[] {
    const items: RailItem[] = [];
    for (const child of Array.from(host.children)) {
      if (!(child instanceof HTMLElement) || child.classList.contains('ws-mode-off')) continue;
      for (const candidate of [child, ...Array.from(child.children)]) {
        if (!(candidate instanceof HTMLElement) || candidate.hidden || candidate.classList.contains('ws-mode-off')) continue;
        const label = candidate.getAttribute('aria-label');
        if (label) items.push({ label });
      }
    }
    return items.length ? items : [{ label: fallback }];
  }
  function refreshRails(id: ModeId): void {
    const fallback = MODES.find((m) => m.id === id)?.label ?? id;
    leftPane.setRailItems(id === 'model'
      ? [{ label: 'Properties' }, { label: 'Project Browser' }]
      : railItemsFor(left, fallback));
    rightPane.setRailItems(id === 'model'
      ? (['Stage', 'Layer', 'References'] as const).map((label) => ({ label, onSelect: () => showComposerTab(label) }))
      : railItemsFor(right, fallback));
    bottomPane.setRailItems(id === 'model' ? [{ label: 'Library' }] : railItemsFor(libHost, fallback));
  }

  const modeTabs = opts.modeHost ? mountModeTabs(opts.modeHost, MODES, (id) => switcher.set(id)) : undefined;
  const switcher = new ModeSwitcher({
    modes: MODES,
    slots: [new Slot(left), new Slot(right), new Slot(libHost)],
    ribbon,
    tabs: modeTabs,
    canLeave: () => (deps.floor.active() ? 'Finish or cancel the floor sketch first' : null),
    onLeave: (from) => {
      if (deps.wall.active()) deps.wall.stop();
      if (from === 'materials') materialsMode?.leave();
      if (from === 'costs') costsMode?.leave();
      if (from === 'schedule') scheduleMode?.leave();
    },
    onChange: (id) => {
      saveMode(state.model?.path ?? null, id);
      refreshRails(id);
    },
    panels: (id, slot) =>
      (id === 'materials' ? materialsMode?.panel(slot)
      : id === 'costs' ? costsMode?.panel(slot)
      : id === 'schedule' ? scheduleMode?.panel(slot)
      : null) ?? null,
    sizes: (id, slot) =>
      slot !== 2 ? undefined
      : id === 'costs' && costsMode ? BOQ_HEIGHT
      : id === 'schedule' && scheduleMode ? GANTT_HEIGHT
      : undefined,
    onEnter: (id) => {
      if (id === 'materials') materialsMode?.enter();
      if (id === 'costs') {
        costsMode?.enter();
        deps.syncCostsRibbon();
      }
      if (id === 'schedule') {
        scheduleMode?.enter();
        ribbon.setMenuValue('schFuture', deps.scheduleFuture());
      }
    },
  });
  onWindow(ctx, 'keydown', (e) => {
    if (deps.host.hidden || !deps.host.isConnected || deps.host.closest('[hidden]')) return;
    if (isTyping(e.target)) return;
    const next = modeFromKey(e, switcher.current);
    if (!next) return;
    e.preventDefault();
    switcher.set(next);
  });

  return {
    switcher,
    materials: materialsMode,
    costs: costsMode,
    schedule: scheduleMode,
  };
}
