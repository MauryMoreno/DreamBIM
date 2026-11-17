// Modo Schedule: une fases, el panel Task, el Gantt y la barra de fecha con el visor (4D) y el controlador.
// It receives everything injected (no DOM of the workspace) so it can be tested.
import { addWorkdays, today } from './calendar';
import { askCalendar } from './calendardialog';
import { mergeImported, parseScheduleFile, toMspdi } from './exchange';
import { schedule, tasksByLevel, wouldLoop } from './plan';
import { nextTaskId, type Task } from './state';
import { askTask } from './taskdialog';
import { installState } from './mode/state';
import { installPaths } from './mode/paths';
import { installPanels } from './mode/panels';
import { installFourD } from './mode/four-d';
import { installTimeline } from './mode/timeline';
import { installPicking } from './mode/picking';
import { installEdit } from './mode/edit';
import type { ScheduleModeContext } from './mode/context';
import { ScheduleModeDeps, ScheduleMode } from './mode/types';
export type { FutureStyle, ScheduleActions, ScheduleModeDeps, ScheduleMode } from './mode/types';

export function createScheduleMode(d: ScheduleModeDeps): ScheduleMode {
  const ctx = { d } as unknown as ScheduleModeContext;
  installState(ctx);
  installPaths(ctx);
  installPanels(ctx);
  installFourD(ctx);
  installTimeline(ctx);
  installPicking(ctx);
  installEdit(ctx);

  return {
    panel: (slot) => ctx.hosts[slot] ?? null,
    dateBar: ctx.dateBar.root,
    dateOverlay: ctx.dateBar.overlay,
    enter() {
      ctx.active = true;
      ctx.dateBar.setVisible(true);
      ctx.refresh();
    },
    leave() {
      ctx.active = false;
      ctx.picking?.finish();
      ctx.timeline?.close();
      ctx.stop();
      ctx.dateBar.setVisible(false);
      ctx.apply4D();
    },
    refresh: ctx.refresh,
    selectionChanged(path) {
      if (!ctx.active) return;
      if (ctx.picking) {
        // eligiendo: lo que se pulsa en el modelo se agrega, y el panel sigue con la tarea
        const items = ctx.selectionKeys();
        if (items.length) ctx.picking.onPick(items);
        return;
      }
      if (path) ctx.showElement(path);
      else {
        ctx.marked = [];
        for (const g of ctx.views()) g.markTasks([]);
        ctx.showSelected();
      }
    },
    async newTask() {
      if (!ctx.editable) return;
      const sel = d.selected();
      const from = sel ? ctx.rows.find((r) => r.element === sel) : undefined;
      const draft: Task = {
        id: nextTaskId(ctx.state()), name: 'New task', phase: '', start: ctx.day ?? today(), duration: 5, deps: [],
        rule: from ? { cls: from.cls, storey: from.storey } : null, elements: [],
      };
      const made = await askTask(draft, ctx.choices());
      if (!made) return;
      if (wouldLoop({ ...ctx.state(), tasks: [...ctx.state().tasks, made] }, made.id, made.deps)) return d.toast(ctx.LOOP, 'info');
      await d.actions.change('New Task', (s) => ({ ...s, tasks: [...s.tasks, { ...made, id: nextTaskId(s) }] }));
    },
    editTask: () => ctx.edit(ctx.findTask(ctx.selectedTask)),
    deleteTask: () => ctx.remove(ctx.findTask(ctx.selectedTask)),
    linkSelection: ctx.linkSelection,
    async tasksByLevel() {
      if (!ctx.editable) return;
      const lowest = new Map<string, number>();
      for (const r of ctx.rows) {
        if (r.storey === 'No storey') continue;
        lowest.set(r.storey, Math.min(lowest.get(r.storey) ?? Infinity, r.box[2]));
      }
      const storeys = [...lowest].sort((a, b) => a[1] - b[1]).map(([s]) => s);
      if (!storeys.length) return d.toast('This model has no levels', 'info');
      const s = ctx.state();
      if (s.tasks.length && !(await d.actions.confirm(`Add ${storeys.length} tasks after the existing ones?`, 'Add'))) return;
      const from = ctx.span ? addWorkdays(ctx.span.end, 1, s.calendar) : today();
      const ok = await d.actions.change('Create Tasks by Level', (st) => ({ ...st, tasks: [...st.tasks, ...tasksByLevel(st, storeys, from)] }));
      if (ok) d.toast(`Created ${storeys.length} tasks`, 'info');
    },
    async editCalendar() {
      if (!ctx.editable) return;
      const cal = await askCalendar(ctx.state().calendar);
      if (cal) await d.actions.change('Change Calendar', (s) => ({ ...s, calendar: cal }));
    },
    setFuture(v) {
      ctx.future = v;
      ctx.apply4D();
    },
    setCritical(on) {
      ctx.critical = on;
      for (const g of ctx.views()) g.setCritical(on);
    },
    async setBaseline() {
      if (!ctx.editable) return;
      const s = ctx.state();
      if (!s.tasks.length) return d.toast('Add tasks before setting a baseline', 'info');
      if (s.tasks.some((t) => t.baseline) && !(await d.actions.confirm('Replace the current baseline with today\'s dates?', 'Replace'))) return;
      const ok = await d.actions.change('Set Baseline', (st) => {
        const now = schedule(st).dates;
        return { ...st, tasks: st.tasks.map((t) => ({ ...t, baseline: { ...now.get(t.id)! } })) };
      });
      if (ok) d.toast(`Baseline set for ${s.tasks.length} tasks`, 'info');
    },
    async importSchedule() {
      if (!ctx.editable || !d.actions.importFile) return;
      const file = await d.actions.importFile();
      if (!file) return;
      let imp;
      try {
        imp = parseScheduleFile(file.name, file.text);
      } catch (e) {
        return d.toast(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
      const s = ctx.state();
      const ask = `Replace ${s.tasks.length} tasks with the ${imp.tasks.length} in ${file.name}? Tasks with the same name keep their linked elements.`;
      if (s.tasks.length && !(await d.actions.confirm(ask, 'Replace'))) return;
      const ok = await d.actions.change('Import Schedule', (st) => mergeImported(st, imp));
      if (ok) d.toast([`Imported ${imp.tasks.length} tasks from ${file.name}`, ...imp.notes].join('. '), 'info');
    },
    async exportSchedule() {
      if (!d.actions.exportFile) return;
      const s = ctx.state();
      if (!s.tasks.length) return d.toast('There are no tasks to export', 'info');
      const name = (d.model()?.name ?? 'schedule').replace(/\.ifcx$/i, '');
      try {
        const written = await d.actions.exportFile(`${name}.xml`, toMspdi(s, name));
        if (written) d.toast(`Exported ${written}`, 'info');
      } catch (e) {
        d.toast(`Could not export: ${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    },
    get day() {
      return ctx.day;
    },
    setEditable(on) {
      ctx.editable = on;
      for (const g of ctx.views()) g.setEditable(on);
    },
  };
}
