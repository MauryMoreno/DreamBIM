import { PLAY_MS } from './helpers';
import type { ColorFn } from '../../render/coloroverride';
import { computeBudget } from '../../costs/budget';
import { elementCode, readCostSystem } from '../../costs/system';
import { elementMeasures } from '../../costs/takeoff';
import { NO_MATERIAL } from '../../materials/catalog';
import { addWorkdays, today } from '../calendar';
import { ACTIVE, DEMOLISH, GHOST, GHOST_OPACITY, TEMPORARY } from '../colors';
import { costCurve, elementStates, projectSpan, schedule, taskElements, type ElementState } from '../plan';
import type { ScheduleModeContext } from './context';

export function installFourD(ctx: ScheduleModeContext): void {
  ctx.apply4D = apply4D;
  ctx.setDay = setDay;
  ctx.play = play;
  ctx.stop = stop;
  ctx.refresh = refresh;
  // --- 4D ---------------------------------------------------------------------------------------------
  ctx.states = new Map<string, ElementState>();

  const colorFn: ColorFn = (path) => {
    const s = ctx.states.get(path) ?? 'none';
    if (s === 'done' || s === 'removed') return null; // lo quitado ya va oculto
    if (s === 'active') return { color: ACTIVE, opacity: 1 };
    if (s === 'demolish') return { color: DEMOLISH, opacity: 1 };
    if (s === 'temporary') return { color: TEMPORARY, opacity: 1 };
    if (s === 'future') return ctx.future === 'ghost' ? { color: GHOST, opacity: GHOST_OPACITY } : null;
    return NO_MATERIAL;
  };

  function apply4D(): void {
    if (!ctx.active || ctx.day === null) {
      ctx.d.viewer.setColorOverride(null);
      ctx.d.setHidden(new Set());
      return;
    }
    const all = [...new Set(ctx.rows.map((r) => r.element))];
    ctx.states = elementStates(ctx.dates, ctx.elements, ctx.day, all, ctx.kinds);
    const hidden = new Set<string>();
    for (const [p, s] of ctx.states) if (s === 'removed' || (s === 'future' && ctx.future === 'hidden')) hidden.add(p);
    ctx.d.setHidden(hidden);
    ctx.d.viewer.setColorOverride(colorFn);
  }

  let curve: ReturnType<typeof costCurve> | null = null;

  function setDay(x: string): void {
    ctx.day = x;
    ctx.dateBar.setDay(x);
    for (const g of ctx.views()) g.setDay(x);
    ctx.timeline?.renderLive();
    ctx.taskPanel.setCurve(curve, ctx.currency(), x);
    apply4D();
  }

  function play(): void {
    if (!ctx.span || ctx.stopPlay) return;
    if (!ctx.day || ctx.day >= ctx.span.end) setDay(ctx.span.start);
    ctx.dateBar.setPlaying(true);
    ctx.stopPlay = ctx.timer.every(PLAY_MS, () => {
      if (!ctx.span || !ctx.day) return stop();
      const next = addWorkdays(ctx.day, 1, ctx.state().calendar);
      if (next > ctx.span.end || next === ctx.day) return stop();
      setDay(next);
      if (next >= ctx.span.end) stop();
    });
  }

  function stop(): void {
    ctx.stopPlay?.();
    ctx.stopPlay = null;
    ctx.dateBar.setPlaying(false);
  }

  function refresh(): void {
    const s = ctx.state();
    ctx.rows = ctx.d.model() ? ctx.d.viewer.quantities(false) : [];
    ({ dates: ctx.dates, cpm: ctx.cpm } = schedule(s));
    ctx.kinds = new Map(s.tasks.map((t) => [t.id, t.kind ?? 'construct']));
    ctx.elements = taskElements(s, ctx.rows, ctx.toComposed);
    ctx.ganttRows = s.tasks.map((t) => ({
      task: t,
      dates: ctx.dates.get(t.id)!,
      elements: ctx.elements.get(t.id)?.elements.length ?? 0,
      missing: ctx.elements.get(t.id)?.missing ?? 0,
      cpm: ctx.cpm.get(t.id),
    }));
    ctx.span = projectSpan(ctx.dates);
    ctx.uses = new Map();
    for (const { elements: list } of ctx.elements.values()) for (const p of list) ctx.uses.set(p, (ctx.uses.get(p) ?? 0) + 1);
    // cost per element with the budget of the cost system of the model (without a system, there are no costs)
    const model = ctx.d.model();
    const system = model ? readCostSystem(model.result) : null;
    ctx.costCurrency = system?.currency ?? 'USD';
    ctx.costOf = new Map();
    if (model && system) {
      const measures = elementMeasures(ctx.rows, ctx.d.actions.materials(), ctx.d.wallLength);
      const els = [...new Map(ctx.rows.map((r) => [r.element, { path: r.element, cls: r.cls }])).values()];
      const codeOf = (path: string): string | null => {
        const node = model.result.byPath.get(path);
        return node ? elementCode(node, system) : null;
      };
      for (const [p, e] of computeBudget(system, els, codeOf, measures).elementCost) ctx.costOf.set(p, e.amount);
    }
    const c = costCurve(s, ctx.dates, ctx.elements, (p) => ctx.costOf.get(p) ?? 0);
    curve = c.total > 0 ? c : null;
    if (ctx.selectedTask && !ctx.findTask(ctx.selectedTask)) ctx.selectedTask = null;
    for (const g of ctx.views()) {
      g.setRows(ctx.ganttRows, ctx.span, s.calendar);
      g.setSelected(ctx.selectedTask);
    }
    ctx.timeline?.renderLive();
    ctx.dateBar.setRange(ctx.span, s.calendar);
    ctx.renderPhases();
    ctx.showSelected();
    setDay(ctx.day ?? ctx.span?.start ?? today());
    const sel = ctx.d.selected();
    if (sel && !ctx.selectedTask) ctx.showElement(sel);
  }
}
