import type { ColorFn } from '../../render/coloroverride';
import { matchRule } from '../../materials/catalog';
import { GHOST, GHOST_OPACITY, PICKED } from '../colors';
import { type Task } from '../state';
import type { ScheduleModeContext } from './context';

export function installPicking(ctx: ScheduleModeContext): void {
  ctx.startPicking = startPicking;
  ctx.linkSelection = linkSelection;
  ctx.showElement = showElement;
  // --- Choosing elements in the model to add them (from the task dialog) ------------------------
  ctx.picking = null;

  /**
   * Each click on an element of the model is delivered to `onPick`. While it lasts, only the 3d is active and what
   * ya es de la tarea (lo enlazado en el borrador y lo de su regla) resaltado y el resto atenuado. Termina con `stop`,
   * Esc o al salir del modo.
   */
  function startPicking(
    task: Task,
    current: string[],
    onPick: (items: { key: string; label: string }[]) => void,
  ): { done: Promise<void>; stop(): void } {
    ctx.picking?.finish();
    const mine = new Set<string>(task.rule ? matchRule(ctx.rows, task.rule) : []);
    for (const key of current) {
      const path = ctx.toComposed(key);
      if (path) mine.add(path);
    }
    const paint: ColorFn = (path) => (mine.has(path) ? { color: PICKED, opacity: 1 } : { color: GHOST, opacity: GHOST_OPACITY });
    let resolveDone = () => {};
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    const finish = () => {
      if (ctx.picking?.finish !== finish) return; // already finished is painted
      ctx.picking = null;
      document.removeEventListener('keydown', onKey, true);
      ctx.d.setPicking?.(false);
      ctx.apply4D(); // the 4D colors come back
      resolveDone();
    };
    ctx.picking = {
      onPick: (items) => {
        for (const item of items) {
          const path = ctx.toComposed(item.key);
          if (path) mine.add(path);
        }
        ctx.d.viewer.setColorOverride(paint);
        onPick(items);
      },
      finish,
    };
    ctx.d.setPicking?.(true);
    ctx.d.viewer.setColorOverride(paint);
    document.addEventListener('keydown', onKey, true);
    return { done, stop: finish };
  }

  /** Links to the chosen task everything selected in the model (what it already had is not repeated). */
  function linkSelection(): void {
    if (!ctx.editable) return;
    const task = ctx.findTask(ctx.selectedTask);
    const keys = ctx.selectionKeys().map((k) => k.key);
    if (!task || !keys.length) return ctx.d.toast('Select a task and an element first', 'info');
    const fresh = keys.filter((k) => !task.elements.includes(k));
    if (!fresh.length) return ctx.d.toast('Already in this task', 'info');
    ctx.change('Link Selection', task.id, (t) => ({ ...t, elements: [...t.elements, ...fresh] }));
    if (fresh.length > 1) ctx.d.toast(`Linked ${fresh.length} elements`, 'info');
  }

  function showElement(path: string): void {
    const own = ctx.ganttRows.filter((r) => ctx.elements.get(r.task.id)?.elements.includes(path));
    // what is known about the element: its meshes in the quantities (there may be several), its 4D state and its cost
    const mine = ctx.rows.filter((r) => r.element === path);
    const node = ctx.d.model()?.result.byPath.get(path);
    const first = mine[0];
    const info = {
      name: first?.name ?? node?.name ?? path,
      cls: first?.cls ?? ((node?.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code ?? ''),
      storey: first?.storey && first.storey !== 'No storey' ? first.storey : '',
      materials: [...new Set(mine.map((r) => r.material).filter(Boolean))],
      volume: mine.reduce((n, r) => n + r.volume, 0),
      area: mine.reduce((n, r) => n + r.area, 0),
      state: ctx.active && ctx.day ? (ctx.states.get(path) ?? (ctx.uses.has(path) ? null : 'none')) : null,
      day: ctx.day,
      cost: ctx.costOf.size ? (ctx.costOf.get(path) ?? 0) : null,
      currency: ctx.currency(),
    };
    ctx.taskPanel.showElement(path, own, info);
    ctx.marked = own.map((r) => r.task.id);
    for (const g of ctx.views()) g.markTasks(ctx.marked);
  }

  const choices = (except?: string) => ({
    tasks: ctx.state().tasks.filter((t) => t.id !== except).map((t) => ({ id: t.id, name: t.name })),
    classes: [...new Set(ctx.rows.map((r) => r.cls))].sort(),
    storeys: [...new Set(ctx.rows.map((r) => r.storey))].sort(),
    materials: ctx.d.actions.materials().map((m) => ({ code: m.code, name: m.name })),
  });
  ctx.choices = choices;
}
