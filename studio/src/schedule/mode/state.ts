import { realTimer } from './helpers';
import { type TaskDates, type TaskFloat } from '../plan';
import { type Task, type TaskKind } from '../state';
import type { ScheduleModeContext } from './context';

export function installState(ctx: ScheduleModeContext): void {
  const timer = ctx.d.timer ?? realTimer;
  ctx.timer = timer;

  const hosts = [0, 1, 2].map(() => {
    const h = document.createElement('div');
    h.className = 'sch-host';
    return h;
  });
  ctx.hosts = hosts;

  ctx.rows = [];

  ctx.dates = new Map<string, TaskDates>();

  ctx.cpm = new Map<string, TaskFloat>();

  ctx.kinds = new Map<string, TaskKind>();

  ctx.elements = new Map<string, { elements: string[]; missing: number }>();

  ctx.ganttRows = [];

  ctx.span = null;

  ctx.costOf = new Map<string, number>();

  ctx.uses = new Map<string, number>();

  ctx.day = null;

  ctx.future = 'hidden';

  ctx.selectedTask = null;

  ctx.stopPlay = null;

  ctx.active = false;

  ctx.editable = ctx.d.editable;

  const state = () => ctx.d.actions.state();
  ctx.state = state;

  const findTask = (id: string | null): Task | undefined => state().tasks.find((t) => t.id === id);
  ctx.findTask = findTask;

  /** Moneda del sistema de costos del modelo (USD si no tiene). */
  ctx.costCurrency = 'USD';

  const currency = () => ctx.costCurrency;
  ctx.currency = currency;
}
