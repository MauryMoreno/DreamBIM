import { displayDay, workdaysBetween } from '../calendar';
import { mountDateBar } from '../datebar';
import { mountGantt, type Gantt, type GanttCallbacks, type GanttRow } from '../gantt';
import { projectSpan } from '../plan';
import { type Task } from '../state';
import { mountTaskPanel, type ElementItem } from '../taskpanel';
import type { ScheduleModeContext } from './context';

export function installPanels(ctx: ScheduleModeContext): void {
  ctx.change = change;
  ctx.renderPhases = renderPhases;
  ctx.showSelected = showSelected;
  ctx.selectTask = selectTask;
  // --- Paneles --------------------------------------------------------------------------------------
  const phases = document.createElement('section');

  phases.className = 'ws-panel sch-phases';

  phases.setAttribute('aria-label', 'Phases');

  const phasesTitle = document.createElement('header');

  phasesTitle.className = 'ws-panel-title';

  phasesTitle.textContent = 'Phases';

  const phasesBody = document.createElement('div');

  phasesBody.className = 'ws-panel-body sch-task-body';

  phases.append(phasesTitle, phasesBody);

  ctx.hosts[0].append(phases);

  const taskPanel = mountTaskPanel(ctx.hosts[1], {
    onPickElement: (path) => ctx.d.viewer.selectMany([path]),
    onPickTask: (id) => selectTask(id),
  });
  ctx.taskPanel = taskPanel;

  const ganttCallbacks: GanttCallbacks = {
    onSelect: (id) => selectTask(id),
    onEdit: (id) => void ctx.edit(ctx.findTask(id)),
    onDelete: (id) => void ctx.remove(ctx.findTask(id)),
    onMove: (id, start) => change('Move Task', id, (t) => ({ ...t, start })),
    onResize: (id, duration) => change('Resize Task', id, (t) => ({ ...t, duration })),
    // the dragged red line: to the last working day that does not exceed it, within the schedule
    onDay: (x) => {
      if (!ctx.span) return;
      const days = workdaysBetween(ctx.span.start, ctx.span.end, ctx.state().calendar);
      const at = [...days].reverse().find((w) => w <= x) ?? days[0];
      if (at && at !== ctx.day) ctx.setDay(at);
    },
  };
  ctx.ganttCallbacks = ganttCallbacks;

  // en el panel, sin barra de botones (el zoom va con Ctrl + rueda; la ventana ampliada trae los suyos)
  const gantt = mountGantt(ctx.hosts[2], { ...ganttCallbacks, onExpand: () => ctx.openTimeline() }, { toolbar: false });

  // the enlarged timeline (modal): a second Gantt with the same data, up to date while it is open
  ctx.timeline = null;

  ctx.critical = true;

  ctx.marked = [];

  const views = (): Gantt[] => (ctx.timeline ? [gantt, ctx.timeline.gantt] : [gantt]);
  ctx.views = views;

  const dateHost = document.createElement('div');

  dateHost.className = 'sch-datebar-host';

  const dateBar = mountDateBar(dateHost, { onDay: (x) => ctx.setDay(x), onPlay: (on) => (on ? ctx.play() : ctx.stop()) });
  ctx.dateBar = dateBar;

  function change(label: string, id: string, patch: (t: Task) => Task): void {
    if (!ctx.editable) return;
    void ctx.d.actions.change(label, (s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? patch(t) : t)) }));
  }

  function renderPhases(): void {
    const groups = new Map<string, GanttRow[]>();
    for (const r of ctx.ganttRows) {
      const name = r.task.phase || 'General';
      groups.set(name, [...(groups.get(name) ?? []), r]);
    }
    if (!groups.size) {
      const p = document.createElement('p');
      p.className = 'sch-empty';
      p.textContent = 'No phases yet.';
      return phasesBody.replaceChildren(p);
    }
    phasesBody.replaceChildren(
      ...[...groups].map(([name, list]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sch-phase-btn';
        const s = projectSpan(new Map(list.map((r) => [r.task.id, r.dates])))!;
        b.textContent = `${name} · ${list.length} tasks · ${displayDay(s.start)} – ${displayDay(s.end)}`;
        b.addEventListener('click', () => {
          const all = [...new Set(list.flatMap((r) => ctx.elements.get(r.task.id)?.elements ?? []))];
          if (all.length) ctx.d.viewer.selectMany(all);
        });
        return b;
      }),
    );
  }

  /** Cost of a task: that of its elements, split among the tasks that share each one. */
  const taskCost = (id: string): number | null => {
    const list = ctx.elements.get(id)?.elements ?? [];
    if (!ctx.costOf.size) return null;
    return list.reduce((n, p) => n + (ctx.costOf.get(p) ?? 0) / (ctx.uses.get(p) ?? 1), 0);
  };

  function showSelected(): void {
    const row = ctx.ganttRows.find((r) => r.task.id === ctx.selectedTask) ?? null;
    const names = row
      ? row.task.deps.map((dep) => {
          const link = dep.type === 'FS' && !dep.lag ? '' : ` (${dep.type}${dep.lag ? (dep.lag > 0 ? '+' : '') + dep.lag : ''})`;
          return `${ctx.findTask(dep.task)?.name ?? dep.task}${link}`;
        })
      : [];
    const items: ElementItem[] = row ? (ctx.elements.get(row.task.id)?.elements ?? []).map((path) => ({ path, label: ctx.elementLabel(path) })) : [];
    taskPanel.showTask(row, row ? taskCost(row.task.id) : null, ctx.currency(), names, row ? variance(row) : null, items);
  }

  /** Working days by which the end is behind (+) or ahead (−) of the baseline. */
  function variance(row: GanttRow): number | null {
    const b = row.task.baseline;
    if (!b) return null;
    const cal = ctx.state().calendar;
    if (b.end === row.dates.end) return 0;
    const late = row.dates.end > b.end;
    const n = workdaysBetween(late ? b.end : row.dates.end, late ? row.dates.end : b.end, cal).length - 1;
    return late ? n : -n;
  }

  function selectTask(id: string): void {
    ctx.selectedTask = id;
    for (const g of views()) g.setSelected(id);
    ctx.timeline?.renderLive();
    const list = ctx.elements.get(id)?.elements ?? [];
    if (list.length) ctx.d.viewer.selectMany(list);
    showSelected();
  }
}
