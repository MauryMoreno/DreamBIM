import { GanttRow } from './types';
import { CLICK_SLOP, EDGE, MAX_STEP } from './helpers';
import { formatDay, nextWorkday, parseDay, workdaysBetween } from '../calendar';
import type { GanttContext } from './context';

export function installDrag(ctx: GanttContext): void {
  ctx.scrollTo = scrollTo;
  ctx.edgeScroll = edgeScroll;
  ctx.startDrag = startDrag;
  function scrollTo(d: string): void {
    ctx.chart.scrollLeft = Math.max(0, ctx.xOf(d) - ctx.chart.clientWidth / 2);
  }

  /**
   * Automatic scrolling during a drag: if the pointer gets close to an edge of the timeline or goes out,
   * it scrolls towards that side (faster the farther it is) and notifies with `onScroll` so that what is dragged keeps following the
   * puntero. Se para al volver dentro o con `stop`.
   */
  function edgeScroll(onScroll: () => void): { track(clientX: number): void; stop(): void } {
    let x: number | null = null;
    let frame = 0;
    const tick = () => {
      frame = 0;
      if (x === null) return;
      const box = ctx.chart.getBoundingClientRect();
      if (!box.width) return; // sin maquetar
      const over = x < box.left + EDGE ? x - (box.left + EDGE) : x > box.right - EDGE ? x - (box.right - EDGE) : 0;
      if (!over) return;
      const before = ctx.chart.scrollLeft;
      ctx.chart.scrollLeft = before + Math.sign(over) * Math.min(MAX_STEP, Math.max(4, Math.abs(over) / 2));
      if (ctx.chart.scrollLeft === before) return; // reached the beginning or the end
      onScroll();
      frame = requestAnimationFrame(tick);
    };
    return {
      track(clientX) {
        x = clientX;
        if (!frame) frame = requestAnimationFrame(tick);
      },
      stop() {
        x = null;
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }

  /** Dragging a bar: move or, from the handle, change the duration. A short movement is a click. */
  function startDrag(e: MouseEvent, r: GanttRow, barEl: HTMLElement, resize: boolean): void {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const left0 = ctx.xOf(r.dates.start);
    if (resize && r.task.duration === 0) return; // a milestone has no duration to stretch
    const width0 = (parseDay(r.dates.end) - parseDay(r.dates.start) + 1) * ctx.px();
    // how much the pointer moved plus how much the timeline scrolled meanwhile
    const scroll0 = ctx.chart.scrollLeft;
    let lastX = x0;
    const dxAt = (clientX: number) => clientX - x0 + ctx.chart.scrollLeft - scroll0;
    const apply = () => {
      if (!ctx.editable) return;
      const dx = dxAt(lastX);
      if (resize) barEl.style.width = `${Math.max(ctx.px(), width0 + dx)}px`;
      else barEl.style.left = `${left0 + dx}px`;
    };
    const edge = edgeScroll(apply);
    const move = (ev: MouseEvent) => {
      lastX = ev.clientX;
      apply();
      if (ctx.editable) edge.track(lastX);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      edge.stop();
      const dx = dxAt(ev.clientX);
      if (Math.abs(dx) < CLICK_SLOP) {
        ctx.render();
        return ctx.cb.onSelect(r.task.id);
      }
      if (!ctx.editable) return ctx.render();
      const days = Math.round(dx / ctx.px());
      if (resize) {
        const end = formatDay(Math.max(parseDay(r.dates.start), parseDay(r.dates.end) + days));
        ctx.cb.onResize(r.task.id, Math.max(1, workdaysBetween(r.dates.start, end, ctx.cal).length));
      } else {
        ctx.cb.onMove(r.task.id, nextWorkday(formatDay(parseDay(r.dates.start) + days), ctx.cal));
      }
      ctx.render(); // el modo vuelve a pintar con las fechas de verdad
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}
