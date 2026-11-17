import { wouldLoop } from '../plan';
import { type Task } from '../state';
import { askTask } from '../taskdialog';
import type { ScheduleModeContext } from './context';

export function installEdit(ctx: ScheduleModeContext): void {
  ctx.edit = edit;
  ctx.remove = remove;
  const LOOP = 'That link would make a loop';
  ctx.LOOP = LOOP;

  async function edit(task: Task | undefined): Promise<void> {
    if (!ctx.editable || !task) return;
    const named = task.elements.map((key) => {
      const path = ctx.toComposed(key);
      return { key, label: path ? ctx.elementLabel(path) : `${key} (missing)` };
    });
    const changed = await askTask(task, { ...ctx.choices(task.id), elements: named, pickElements: (current, onPick) => ctx.startPicking(task, current, onPick) });
    if (!changed) return;
    if (wouldLoop(ctx.state(), task.id, changed.deps)) return ctx.d.toast(LOOP, 'info');
    await ctx.d.actions.change('Change Task', (s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === task.id ? changed : t)) }));
  }

  async function remove(task: Task | undefined): Promise<void> {
    if (!ctx.editable || !task) return;
    if (!(await ctx.d.actions.confirm(`Delete task ${task.name}?`, 'Delete'))) return;
    await ctx.d.actions.change('Delete Task', (s) => ({
      ...s,
      tasks: s.tasks
        .filter((t) => t.id !== task.id)
        .map((t) => (t.deps.some((x) => x.task === task.id) ? { ...t, deps: t.deps.filter((x) => x.task !== task.id) } : t)),
    }));
  }
}
