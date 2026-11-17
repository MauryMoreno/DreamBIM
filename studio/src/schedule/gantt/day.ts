import { barHeight, short } from './helpers';
import { formatDay } from '../calendar';
import type { GanttContext } from './context';

export function installDay(ctx: GanttContext): void {
  ctx.reveal = reveal;
  ctx.placeDay = placeDay;
  /** Lleva la barra de la tarea a la vista (en horizontal y en vertical) si no se ve entera. */
  function reveal(id: string): void {
    const b = ctx.bars.querySelector<HTMLElement>(`.sch-bar[data-id="${id}"]`);
    if (!b) return;
    const left = parseFloat(b.style.left);
    const width = parseFloat(b.style.width);
    const view = ctx.chart.clientWidth;
    if (view > 0 && (left < ctx.chart.scrollLeft || left + width > ctx.chart.scrollLeft + view)) {
      ctx.chart.scrollLeft = Math.max(0, width < view ? left - (view - width) / 2 : left - 20);
    }
    // en el panel, bajo la cabecera fija (la escala mide lo mismo que su fila)
    const head = ctx.scale.offsetHeight;
    const top = head + parseFloat(b.style.top) - (ctx.rowH - barHeight(ctx.rowH)) / 2; // el principio de su fila
    if (top < ctx.split.scrollTop + head) ctx.split.scrollTop = Math.max(0, top - head);
    else if (top + ctx.rowH > ctx.split.scrollTop + ctx.split.clientHeight) ctx.split.scrollTop = top + ctx.rowH - ctx.split.clientHeight;
  }

  function placeDay(): void {
    ctx.dayline.hidden = ctx.day === null;
    ctx.dayHandle.hidden = ctx.day === null || !ctx.cb.onDay;
    // the tasks the line crosses are highlighted
    const live = new Set(ctx.day === null ? [] : ctx.rows.filter((r) => r.dates.start <= ctx.day! && ctx.day! <= r.dates.end).map((r) => r.task.id));
    for (const b of ctx.bars.querySelectorAll<HTMLElement>('.sch-bar')) b.classList.toggle('is-live', live.has(b.dataset.id!));
    if (ctx.day === null) return;
    ctx.dayline.style.left = `${ctx.xOf(ctx.day) + ctx.px() / 2}px`;
    ctx.dayHandle.style.left = `${ctx.xOf(ctx.day) + ctx.px() / 2}px`;
    ctx.dayHandle.textContent = short(ctx.day);
    ctx.dayHandle.title = `${ctx.day} · drag to move the date`;
  }

  /** Dragging the indicator: the day is the one under the pointer (within the scale), and a notice is given when it changes. */
  ctx.dayHandle.addEventListener('pointerdown', (e) => {
    if (!ctx.cb.onDay) return;
    e.preventDefault();
    e.stopPropagation();
    let last = ctx.day;
    let lastX = e.clientX;
    const at = (clientX: number) => {
      const x = clientX - ctx.chart.getBoundingClientRect().left + ctx.chart.scrollLeft;
      const d = formatDay(ctx.origin + Math.floor(x / ctx.px()));
      if (d === last) return;
      last = d;
      ctx.cb.onDay!(d);
    };
    // if the indicator is taken to an edge, the timeline scrolls and the date keeps advancing
    const edge = ctx.edgeScroll(() => at(lastX));
    const move = (ev: MouseEvent) => {
      lastX = ev.clientX;
      at(lastX);
      edge.track(lastX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      edge.stop();
      ctx.dayHandle.classList.remove('is-dragging');
    };
    ctx.dayHandle.classList.add('is-dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}
