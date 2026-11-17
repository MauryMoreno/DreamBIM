import { SHORT_DAY } from './helpers';
import { displayDay, parseDay } from '../calendar';
import { mountGantt } from '../gantt';
import type { ScheduleModeContext } from './context';

export function installTimeline(ctx: ScheduleModeContext): void {
  ctx.openTimeline = openTimeline;
  /** Opens the enlarged timeline of the tasks in a modal (Esc, the X or a click outside close it). */
  function openTimeline(): void {
    if (ctx.timeline) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrim = document.createElement('div');
    scrim.className = 'modal-scrim sch-timeline-scrim';
    const box = document.createElement('div');
    box.className = 'modal sch-timeline-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Schedule timeline');
    const head = document.createElement('div');
    head.className = 'modal-title sch-timeline-title';
    const title = document.createElement('span');
    title.textContent = 'Schedule timeline';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sch-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.setAttribute('aria-label', 'Close');
    head.append(title, closeBtn);
    const host = document.createElement('div');
    host.className = 'sch-host sch-timeline-host';
    const foot = document.createElement('div');
    foot.className = 'sch-timeline-foot';
    const tasks = ctx.ganttRows.length;
    const range = ctx.span ? `${displayDay(ctx.span.start)} – ${displayDay(ctx.span.end)}` : 'No dates';
    for (const text of [`${tasks} ${tasks === 1 ? 'task' : 'tasks'}`, range, 'Ctrl + wheel: zoom ↔ · Alt + wheel: zoom ↕ · Drag the corner to resize']) {
      const part = document.createElement('span');
      part.textContent = text;
      foot.append(part);
    }
    const body = document.createElement('div');
    body.className = 'sch-timeline-body';
    const live = document.createElement('aside');
    live.className = 'sch-timeline-live';
    live.setAttribute('aria-label', 'Activities on the selected date');
    body.append(host, live);
    box.append(head, body, foot);
    scrim.append(box);
    document.body.append(scrim);

    // only the timeline (no list), with zoom on both axes that does not go below seeing everything, and sliders
    const g = mountGantt(host, ctx.ganttCallbacks, { list: false, zoomY: true, minFit: true, sliders: true });

    /** The activities the red line crosses on the chosen day, next to the timeline. */
    const renderLive = () => {
      live.replaceChildren();
      const title = document.createElement('div');
      title.className = 'sch-live-title';
      const sub = document.createElement('div');
      sub.className = 'sch-live-sub';
      live.append(title, sub);
      if (!ctx.day) {
        title.textContent = 'Date';
        sub.textContent = 'Drag the red line over the timeline.';
        return;
      }
      const active = ctx.ganttRows.filter((r) => r.dates.start <= ctx.day! && ctx.day! <= r.dates.end);
      title.textContent = displayDay(ctx.day);
      sub.textContent = `${active.length} ${active.length === 1 ? 'activity' : 'activities'} on this day`;
      const list = document.createElement('div');
      list.className = 'sch-live-list';
      for (const r of active) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'sch-live-item';
        item.dataset.id = r.task.id;
        item.classList.toggle('is-critical', ctx.critical && !!r.cpm?.critical);
        item.setAttribute('aria-current', String(r.task.id === ctx.selectedTask));
        const name = document.createElement('span');
        name.className = 'sch-live-name';
        name.textContent = r.task.name;
        const meta = document.createElement('span');
        meta.className = 'sch-live-meta';
        const phase = r.task.phase ? `${r.task.phase} · ` : '';
        meta.textContent = `${phase}${SHORT_DAY.format(new Date(parseDay(r.dates.start) * 86_400_000))} – ${SHORT_DAY.format(new Date(parseDay(r.dates.end) * 86_400_000))} · ${r.task.progress ?? 0}%`;
        item.append(name, meta);
        item.addEventListener('click', () => ctx.selectTask(r.task.id));
        list.append(item);
      }
      live.append(list);
    };
    const onKey = (e: KeyboardEvent) => {
      // with a dialog on top (editing a task from here) the key is its own
      if (e.key !== 'Escape' || [...document.querySelectorAll('.modal-scrim')].at(-1) !== scrim) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    function close(): void {
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      ctx.timeline = null;
      previous?.focus();
    }
    closeBtn.addEventListener('click', close);
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) close();
    });
    document.addEventListener('keydown', onKey, true);
    ctx.timeline = { gantt: g, close, renderLive };

    g.setEditable(ctx.editable);
    g.setCritical(ctx.critical);
    g.setRows(ctx.ganttRows, ctx.span, ctx.state().calendar);
    g.markTasks(ctx.marked);
    g.setSelected(ctx.selectedTask);
    if (ctx.day) g.setDay(ctx.day);
    renderLive();
    g.fit(); // it starts by seeing everything, and keeps doing so when the window is resized until a zoom is made
    closeBtn.focus();
  }
}
