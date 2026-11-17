// Gantt like MS Project's: a table by phase on the left (#, task, duration, start, end, predecessors,
// progress, slack) and bars on a scale of days on the right. The bars are dragged (move) and stretched
// by their right edge (duration); the dependencies are SVG arrows that leave and arrive at the end that
// their type marks. Each phase has its summary bar, milestones are diamonds and the critical path is red.
import { installLayout } from './gantt/layout';
import { installZoom } from './gantt/zoom';
import { installDrag } from './gantt/drag';
import { installRender } from './gantt/render';
import { installDay } from './gantt/day';
import { installInit } from './gantt/init';
import type { GanttContext } from './gantt/context';
import { GanttCallbacks, Gantt, GanttOptions } from './gantt/types';
export type { GanttRow, GanttCallbacks, Gantt, GanttOptions } from './gantt/types';

export function mountGantt(host: HTMLElement, cb: GanttCallbacks, opts: GanttOptions = {}): Gantt {
  const ctx = { host, cb, opts } as unknown as GanttContext;
  installLayout(ctx);
  installZoom(ctx);
  installDrag(ctx);
  installRender(ctx);
  installDay(ctx);
  installInit(ctx);

  return {
    setRows(r, s, c) {
      ctx.rows = r;
      ctx.span = s;
      ctx.cal = c;
      ctx.render();
      if (ctx.autoFit) ctx.fit();
      else ctx.clampToFit();
    },
    setSelected(id) {
      ctx.selected = id;
      if (id) ctx.reveal(id);
      for (const tr of ctx.listBody.querySelectorAll<HTMLElement>('.sch-row')) tr.setAttribute('aria-selected', String(tr.dataset.id === id));
      for (const b of ctx.bars.querySelectorAll<HTMLElement>('.sch-bar')) b.classList.toggle('is-selected', b.dataset.id === id);
    },
    markTasks(ids) {
      ctx.marked = new Set(ids);
      for (const tr of ctx.listBody.querySelectorAll<HTMLElement>('.sch-row')) tr.classList.toggle('is-marked', ctx.marked.has(tr.dataset.id!));
      for (const b of ctx.bars.querySelectorAll<HTMLElement>('.sch-bar')) b.classList.toggle('is-marked', ctx.marked.has(b.dataset.id!));
    },
    setDay(d) {
      ctx.day = d;
      ctx.placeDay();
    },
    setEditable(on) {
      ctx.editable = on;
      ctx.root.classList.toggle('is-readonly', !on);
    },
    fit: ctx.fit,
    setCritical(on) {
      ctx.critical = on;
      ctx.root.classList.toggle('show-critical', on);
      ctx.render();
    },
  };
}
