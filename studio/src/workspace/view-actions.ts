import type { CostsMode, ColorBy } from '../costs/mode';
import type { MaterialsMode } from '../materials/mode';
import type { ViewAction } from '../ribbon/definition';
import type { FutureStyle, ScheduleMode } from '../schedule/mode';
import { toast } from '../shell/toast';
import type { Toggle } from './constants';
import type { WorkspaceContext } from './context';
import { isLevelsStyle, saveLevelsStyle } from './levelmarks-geom';
import type { FloorController } from './tools/floor-sketch';
import type { WallController } from './tools/wall';
import type { ViewsController } from './views';

/** The modes whose commands the ribbon actions call (null when the mode was not provided). */
export interface ViewActionModes {
  materials: MaterialsMode | null;
  costs: CostsMode | null;
  schedule: ScheduleMode | null;
}

export interface ViewActionsDeps {
  views: ViewsController;
  wall: WallController;
  floor: FloorController;
  setToggle(t: Toggle, on: boolean): void;
  modes(): ViewActionModes;
}

export type ViewActionHandler = (pressed: boolean, value?: string) => void;

export interface ViewActionsController {
  readonly actions: Record<ViewAction, ViewActionHandler>;
  action(a: ViewAction, pressed: boolean, value?: string): void;
  toggleWalk(): void;
  syncCostsRibbon(): void;
  scheduleFuture(): FutureStyle;
}

export function createViewActions(ctx: WorkspaceContext, deps: ViewActionsDeps): ViewActionsController {
  const { state, viewer, ribbon } = ctx;

  /** Value chosen in the Future menu of the Schedule ribbon. */
  let scheduleFuture: FutureStyle = 'hidden';
  /** Value chosen in the Color By menu of the Costs ribbon. */
  let costColor = 'item';
  function syncCostsRibbon(): void {
    ribbon.setMenuValue('costColor', costColor);
  }

  function toggleWalk(): void {
    if (viewer.walking) viewer.exitWalk();
    else {
      deps.wall.stop(); // walking and the Wall tool do not coexist
      if (!viewer.enterWalk()) toast('Open a model to walk through it', 'info');
    }
    ribbon.setPressed('walk', viewer.walking);
  }

  function screenshot(): void {
    const a = document.createElement('a');
    a.href = viewer.screenshot();
    a.download = `${deps.views.docName()} - screenshot.png`;
    a.click();
  }

  const actions = {
    schNew: () => void deps.modes().schedule?.newTask(),
    schEdit: () => void deps.modes().schedule?.editTask(),
    schDelete: () => void deps.modes().schedule?.deleteTask(),
    schLink: () => deps.modes().schedule?.linkSelection(),
    schByLevel: () => void deps.modes().schedule?.tasksByLevel(),
    schCalendar: () => void deps.modes().schedule?.editCalendar(),
    schCritical: (pressed) => deps.modes().schedule?.setCritical(pressed),
    schBaseline: () => void deps.modes().schedule?.setBaseline(),
    schImport: () => void deps.modes().schedule?.importSchedule(),
    schExport: () => void deps.modes().schedule?.exportSchedule(),
    schFuture: (_pressed, value) => {
      scheduleFuture = value === 'ghost' ? 'ghost' : 'hidden';
      ribbon.setMenuValue('schFuture', scheduleFuture);
      deps.modes().schedule?.setFuture(scheduleFuture);
    },
    costEdit: () => void deps.modes().costs?.editItem(),
    costEditSystem: () => void deps.modes().costs?.editSystem(),
    costAssign: () => void deps.modes().costs?.assignToSelection(),
    costClearAssign: () => void deps.modes().costs?.clearAssignment(),
    costColor: (_pressed, value) => {
      costColor = value ?? costColor;
      ribbon.setMenuValue('costColor', costColor);
      deps.modes().costs?.setColorBy(costColor as ColorBy);
    },
    matNew: () => deps.modes().materials?.newMaterial(),
    matAssign: () => deps.modes().materials?.assignToSelection(),
    matRule: () => void deps.modes().materials?.assignByRule(),
    matColors: (pressed) => deps.modes().materials?.setColors(pressed),
    view3d: () => deps.views.openView({ kind: '3d' }),
    plan: () => deps.views.openPlan(),
    front: () => deps.views.openView({ kind: 'elevation', side: 'front' }),
    side: () => deps.views.openView({ kind: 'elevation', side: 'side' }),
    fit: () => viewer.fit(null),
    xray: (pressed) => deps.setToggle('xray', pressed),
    section: (pressed) => deps.setToggle('section', pressed),
    shadows: (pressed) => deps.setToggle('shadows', pressed),
    grid: (pressed) => deps.setToggle('grid', pressed),
    walk: () => toggleWalk(),
    screenshot: () => screenshot(),
    wall: (pressed) => (pressed ? deps.wall.start() : deps.wall.stop()),
    floor: (pressed) => (pressed ? deps.floor.start() : deps.floor.stop()),
    sketchFinish: () => void deps.floor.finish(),
    sketchCancel: () => deps.floor.stop(),
    sketchPick: () => deps.floor.setMode('pick'),
    sketchLine: () => deps.floor.setMode('line'),
    sketchRect: () => deps.floor.setMode('rect'),
    level: () => void deps.views.addLevel(),
    levels: (_pressed, value) => {
      if (isLevelsStyle(value)) {
        state.levelsStyle = value;
        saveLevelsStyle(value);
        ribbon.setMenuValue('levels', value);
        deps.views.refreshLevelViews();
      }
    },
    lod: (_pressed, value) => {
      // View › Graphics › Detail ▾: detail level of the meshes that carry `studio::lod`
      const level = Number(value);
      if (!Number.isInteger(level)) return;
      viewer.setLod({ enabled: true, force: level });
      ribbon.setMenuValue('lod', String(level));
    },
  } satisfies Record<ViewAction, ViewActionHandler>;

  return {
    actions,
    action: (a, pressed, value) => actions[a]?.(pressed, value),
    toggleWalk,
    syncCostsRibbon,
    scheduleFuture: () => scheduleFuture,
  };
}
