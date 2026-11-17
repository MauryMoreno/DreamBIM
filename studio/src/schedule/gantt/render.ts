import { GanttRow } from './types';
import { barHeight, PAD_BEFORE, PAD_AFTER, LEAD, MONTH, SVG, el, isoWeek, short, projectOf, arrowDefs, roundedPath } from './helpers';
import { formatDay, parseDay, today, workdaysBetween } from '../calendar';
import type { TaskDates } from '../plan';
import type { Dep } from '../state';
import type { GanttContext } from './context';

export function installRender(ctx: GanttContext): void {
  ctx.render = render;
  function render(): void {
    ctx.syncZoomButtons();
    ctx.empty.hidden = ctx.rows.length > 0;
    const groups = new Map<string, GanttRow[]>();
    for (const r of ctx.rows) {
      const name = r.task.phase || 'General';
      groups.set(name, [...(groups.get(name) ?? []), r]);
    }
    ctx.origin = ctx.span ? parseDay(ctx.span.start) - PAD_BEFORE : parseDay(today()) - PAD_BEFORE;
    const days = ctx.span ? parseDay(ctx.span.end) - ctx.origin + 1 + PAD_AFTER : PAD_BEFORE + PAD_AFTER;
    const width = days * ctx.px();

    // scale: one day per cell (non-working ones shaded) and the month at its start
    const cells: HTMLElement[] = [];
    for (let i = 0; ctx.px() >= 3 && i < days; i++) {
      const d = formatDay(ctx.origin + i);
      const c = el('div', 'sch-day');
      c.style.left = `${i * ctx.px()}px`;
      c.style.width = `${ctx.px()}px`;
      c.dataset.day = d;
      if (!workdaysBetween(d, d, ctx.cal).length) c.classList.add('is-off');
      if (ctx.px() >= 16) c.append(el('span', 'sch-daynum', String(Number(d.slice(8)))));
      cells.push(c);
    }
    // months: top strip, one cell per month (the first and the last, clipped to the scale)
    for (let i = 0; i < days; ) {
      const d = formatDay(ctx.origin + i);
      const [y, m] = d.split('-').map(Number);
      const len = Math.min(days - i, Date.UTC(y, m, 1) / 86_400_000 - (ctx.origin + i));
      const mo = el('div', 'sch-month');
      mo.style.left = `${i * ctx.px()}px`;
      mo.style.width = `${len * ctx.px()}px`;
      mo.dataset.day = d; // the first day of the month that is seen
      const label = MONTH.format(new Date((ctx.origin + i) * 86_400_000));
      mo.title = label;
      if (len * ctx.px() >= 28) mo.textContent = label;
      cells.push(mo);
      i += len;
    }
    // ISO weeks: they start on Monday (parseDay(1970-01-01) = 0 was a Thursday, so Monday is n % 7 === 4)
    for (let i = 0; i < days; ) {
      const n = ctx.origin + i;
      const len = Math.min(days - i, i === 0 ? ((4 - n) % 7 + 7) % 7 || 7 : 7);
      const w = el('div', 'sch-wk');
      w.style.left = `${i * ctx.px()}px`;
      w.style.width = `${len * ctx.px()}px`;
      w.dataset.day = formatDay(n); // the Monday (or the first day that is seen)
      const monday = n - ((n - 4) % 7 + 7) % 7;
      w.title = `Week ${isoWeek(n)} · from ${short(formatDay(monday))}`;
      if (len * ctx.px() >= 22) w.textContent = `W${isoWeek(n)}`;
      cells.push(w);
      i += len;
    }
    ctx.scale.replaceChildren(...cells, ctx.dayHandle);
    ctx.scale.style.width = `${width}px`;

    // row number of each task (like the MS Project ID), in the order they are seen
    const rowNo = new Map<string, number>();
    for (const list of groups.values()) for (const r of list) rowNo.set(r.task.id, rowNo.size + 1);
    const predText = (deps: Dep[]) =>
      deps
        .filter((d) => rowNo.has(d.task))
        .map((d) => `${rowNo.get(d.task)}${d.type === 'FS' && !d.lag ? '' : d.type}${d.lag ? (d.lag > 0 ? '+' : '') + d.lag : ''}`)
        .join(', ');
    const widthOf = (d: TaskDates) => (parseDay(d.end) - parseDay(d.start) + 1) * ctx.px();

    const listRows: HTMLElement[] = [];
    const barRows: HTMLElement[] = [];
    const yOf = new Map<string, number>();
    let index = 0;
    for (const [phase, list] of groups) {
      const head = el('tr', 'sch-phase');
      const th = el('th', undefined, phase);
      th.colSpan = ctx.HEADS.length;
      head.append(th);
      listRows.push(head);
      const ps = projectOf(list);
      const summary = el('div', 'sch-summary');
      summary.style.top = `${index * ctx.rowH + Math.round((ctx.rowH - 7) / 2 - 3)}px`;
      summary.style.left = `${ctx.xOf(ps.start)}px`;
      summary.style.width = `${widthOf(ps)}px`;
      summary.title = `${phase}: ${short(ps.start)} – ${short(ps.end)}`;
      barRows.push(summary);
      index++;
      for (const r of list) {
        const { task, dates } = r;
        const tr = el('tr', 'sch-row');
        tr.dataset.id = task.id;
        tr.tabIndex = 0;
        tr.setAttribute('aria-selected', String(task.id === ctx.selected));
        tr.classList.toggle('is-marked', ctx.marked.has(task.id));
        tr.classList.toggle('is-critical', !!r.cpm?.critical);
        const name = el('td', 'sch-name', task.name);
        if (r.missing > 0) {
          const warn = el('span', 'sch-missing', '⚠');
          warn.title = `${r.missing} linked elements are missing`;
          warn.setAttribute('aria-label', warn.title);
          name.append(warn);
        }
        tr.append(
          el('td', 'sch-num sch-id', String(rowNo.get(task.id))),
          name,
          el('td', 'sch-num', String(task.duration)),
          el('td', undefined, short(dates.start)),
          el('td', undefined, short(dates.end)),
          el('td', 'sch-pred', predText(task.deps)),
          el('td', 'sch-num', `${task.progress ?? 0}%`),
          el('td', 'sch-num sch-float', r.cpm ? String(r.cpm.float) : ''),
        );
        tr.addEventListener('click', () => ctx.cb.onSelect(task.id));
        tr.addEventListener('dblclick', () => ctx.cb.onEdit(task.id));
        tr.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') ctx.cb.onEdit(task.id);
          else if (e.key === 'Delete' && ctx.editable) ctx.cb.onDelete(task.id);
          else return;
          e.preventDefault();
        });
        listRows.push(tr);

        const milestone = task.duration === 0;
        const b = el('div', 'sch-bar');
        b.dataset.id = task.id;
        b.style.top = `${index * ctx.rowH + (ctx.rowH - barHeight(ctx.rowH)) / 2}px`;
        b.style.height = `${barHeight(ctx.rowH)}px`;
        b.style.left = `${ctx.xOf(dates.start)}px`;
        b.style.width = `${widthOf(dates)}px`;
        b.classList.toggle('is-selected', task.id === ctx.selected);
        b.classList.toggle('is-marked', ctx.marked.has(task.id));
        b.classList.toggle('is-critical', !!r.cpm?.critical);
        b.classList.toggle('is-milestone', milestone);
        if (task.kind && task.kind !== 'construct') b.classList.add(`is-${task.kind}`);
        const floatText = r.cpm ? ` · float ${r.cpm.float}${r.cpm.critical ? ' (critical)' : ''}` : '';
        b.title = `${task.name}: ${short(dates.start)} – ${short(dates.end)} · ${task.progress ?? 0}%${floatText}`;
        if (task.progress && !milestone) {
          const fill = el('div', 'sch-progress');
          fill.style.width = `${task.progress}%`;
          b.append(fill);
        }
        const handle = el('div', 'sch-handle');
        if (milestone) handle.hidden = true;
        b.append(handle); // unnamed: it goes in the list and in the title of the bar
        b.addEventListener('pointerdown', (e) => ctx.startDrag(e, r, b, false));
        handle.addEventListener('pointerdown', (e) => ctx.startDrag(e, r, b, true));
        b.addEventListener('dblclick', () => ctx.cb.onEdit(task.id));
        if (task.baseline) {
          const base = el('div', 'sch-baseline');
          base.style.top = `${index * ctx.rowH + ctx.rowH - 5}px`;
          base.style.left = `${ctx.xOf(task.baseline.start)}px`;
          base.style.width = `${widthOf(task.baseline)}px`;
          base.title = `Baseline: ${short(task.baseline.start)} – ${short(task.baseline.end)}`;
          barRows.push(base);
        }
        barRows.push(b);
        yOf.set(task.id, index * ctx.rowH + ctx.rowH / 2);
        index++;
      }
    }
    ctx.listBody.replaceChildren(...listRows);
    ctx.bars.replaceChildren(ctx.links, ctx.dayline, ...barRows);
    ctx.bars.style.width = `${width}px`;
    ctx.bars.style.height = `${index * ctx.rowH}px`;
    ctx.links.setAttribute('width', String(width));
    ctx.links.setAttribute('height', String(index * ctx.rowH));

    // dependencias: salen del inicio (SS, SF) o del fin (FS, FF) de la predecesora y llegan al inicio
    // (FS, SS) o al fin (FF, SF) de la sucesora
    const paths: SVGElement[] = [];
    const byId = new Map(ctx.rows.map((r) => [r.task.id, r]));
    const startX = (r: GanttRow) => ctx.xOf(r.dates.start);
    const endX = (r: GanttRow) => ctx.xOf(r.dates.end) + ctx.px();
    for (const r of ctx.rows) {
      for (const dep of r.task.deps) {
        const from = byId.get(dep.task);
        if (!from) continue;
        const fromEnd = dep.type === 'FS' || dep.type === 'FF';
        const toStart = dep.type === 'FS' || dep.type === 'SS';
        const x1 = fromEnd ? endX(from) : startX(from);
        const y1 = yOf.get(dep.task)!;
        const x2 = toStart ? startX(r) : endX(r);
        const y2 = yOf.get(r.task.id)!;
        // it leaves on the side of the predecessor and enters on that of the successor; if the elbow falls on the wrong side
        // (the successor starts before the predecessor ends) it goes around the bars through the gap between rows
        const out = fromEnd ? x1 + LEAD : x1 - LEAD;
        const into = toStart ? x2 - LEAD : x2 + LEAD;
        // FS (fin→inicio) y SF cruzan de un lado al otro: solo caben si el codo no se pasa; SS y FF salen y entran por el
        // mismo lado y siempre caben
        const crossing = fromEnd === toStart;
        const room = x2 - x1; // FS: hueco entre el fin de la predecesora y el inicio de la sucesora
        const fits = crossing ? (fromEnd ? room >= 12 : out >= into) : true;
        const elbow = crossing ? (fromEnd ? x1 + Math.min(LEAD, room / 2) : out) : fromEnd ? Math.max(out, into) : Math.min(out, into);
        const gap = y1 + (y2 > y1 ? ctx.rowH / 2 : -ctx.rowH / 2);
        const pts: [number, number][] = fits
          ? [[x1, y1], [elbow, y1], [elbow, y2], [x2, y2]]
          : [[x1, y1], [out, y1], [out, gap], [into, gap], [into, y2], [x2, y2]];
        const p = document.createElementNS(SVG, 'path');
        p.setAttribute('d', roundedPath(pts, 6));
        const hot = ctx.critical && from.cpm?.critical && r.cpm?.critical;
        p.setAttribute('marker-end', `url(#${hot ? 'sch-arrow-critical' : 'sch-arrow'})`);
        if (hot) p.setAttribute('class', 'is-critical');
        paths.push(p);
      }
    }
    ctx.links.replaceChildren(arrowDefs(), ...paths);
    ctx.placeDay();
    ctx.placeHScroll();
  }
}
