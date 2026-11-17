import { SLIDE, SVG, el } from './helpers';
import { formatDay, nextWorkday, today } from '../calendar';
import type { GanttContext } from './context';

export function installLayout(ctx: GanttContext): void {
  ctx.placeHScroll = placeHScroll;
  const root = el('section', 'ws-panel sch-gantt');
  ctx.root = root;

  root.classList.toggle('no-list', ctx.opts.list === false);

  root.setAttribute('aria-label', 'Schedule');

  const body = el('div', 'ws-panel-body sch-body');

  const bar = el('div', 'sch-toolbar');

  const button = (label: string, title: string, onClick: () => void) => {
    const b = el('button', 'sch-btn', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  };

  const zoomOut = button('−', 'Zoom out', () => ctx.stepPx(-1));
  ctx.zoomOut = zoomOut;

  const zoomIn = button('+', 'Zoom in', () => ctx.stepPx(1));
  ctx.zoomIn = zoomIn;

  const todayBtn = button('Today', 'Scroll to today', () => ctx.scrollTo(today()));

  /** Zoom slider: 0 = the minimum and SLIDE = the maximum; `onInput` receives the fraction 0–1. */
  const slider = (glyph: string, title: string, onInput: (t: number) => void) => {
    const input = el('input', 'sch-slider');
    input.type = 'range';
    input.min = '0';
    input.max = String(SLIDE);
    input.step = '1';
    input.value = '0';
    input.title = title;
    input.setAttribute('aria-label', title);
    input.addEventListener('input', () => onInput(Number(input.value) / SLIDE));
    const wrap = el('label', 'sch-slide');
    wrap.append(el('span', 'sch-slide-glyph', glyph), input);
    return { wrap, input };
  };

  const slidePx = ctx.opts.sliders ? slider('↔', 'Horizontal zoom', (t) => ctx.setPx(ctx.sliderToPx(t))) : null;
  ctx.slidePx = slidePx;

  const slideRow = ctx.opts.sliders && ctx.opts.zoomY ? slider('↕', 'Vertical zoom', (t) => ctx.setRow(ctx.sliderToRow(t))) : null;
  ctx.slideRow = slideRow;

  bar.append(zoomOut, zoomIn);

  if (slidePx) bar.append(slidePx.wrap);

  const rowsShort = button('↕−', 'Shorter rows', () => ctx.stepRow(-1));
  ctx.rowsShort = rowsShort;

  const rowsTall = button('↕+', 'Taller rows', () => ctx.stepRow(1));
  ctx.rowsTall = rowsTall;

  if (ctx.opts.zoomY) bar.append(rowsShort, rowsTall);

  if (slideRow) bar.append(slideRow.wrap);

  bar.append(button('Fit', 'Fit the whole schedule in view', () => ctx.fit()), todayBtn);

  // Expand: an icon that floats at the top right over the timeline (a box with four arrows pointing outwards)
  const header = el('header', 'ws-panel-title sch-gantt-title');

  header.append(el('span', 'sch-gantt-title-text', 'Schedule'));

  if (ctx.cb.onExpand) {
    const expand = button('', 'Open the timeline in a window', () => ctx.cb.onExpand!());
    expand.classList.add('sch-expand');
    const icon = document.createElementNS(SVG, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML =
      '<rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M7 11V7h4M7 7l4 4M17 11V7h-4M17 7l-4 4M7 13v4h4M7 17l4-4M17 13v4h-4M17 17l-4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    expand.append(icon);
    body.append(expand);
  }

  const split = el('div', 'sch-split');
  ctx.split = split;

  const list = el('table', 'sch-list');

  const listHead = el('tr');

  const HEADS: [string, string][] = [
    ['#', 'Row number'], ['Task', 'Task'], ['Dur', 'Duration in working days'], ['Start', 'Start'], ['Finish', 'Finish'],
    ['Pred', 'Predecessors'], ['%', 'Percent complete'], ['Float', 'Total float in working days'],
  ];
  ctx.HEADS = HEADS;

  for (const [h, title] of HEADS) {
    const th = el('th', undefined, h);
    th.title = title;
    th.scope = 'col';
    listHead.append(th);
  }

  const listBody = el('tbody');
  ctx.listBody = listBody;

  list.append(el('thead'), listBody);

  list.tHead!.append(listHead);

  const chart = el('div', 'sch-chart');
  ctx.chart = chart;

  const scale = el('div', 'sch-scale');
  ctx.scale = scale;

  const bars = el('div', 'sch-bars');
  ctx.bars = bars;

  const links = document.createElementNS(SVG, 'svg');
  ctx.links = links;

  links.setAttribute('class', 'sch-links');

  const dayline = el('div', 'sch-dayline');
  ctx.dayline = dayline;

  bars.append(links, dayline);

  // red line indicator: it goes on the scale (which stays fixed on top) and is dragged to move the day
  const dayHandle = el('div', 'sch-dayhandle');
  ctx.dayHandle = dayHandle;

  dayHandle.hidden = true;

  chart.append(scale, bars);

  split.append(list, chart);

  // the scale stays fixed on top when scrolling down the tasks (the list header does it with sticky)
  split.addEventListener('scroll', () => {
    scale.style.transform = split.scrollTop ? `translateY(${split.scrollTop}px)` : '';
  });

  // own horizontal scroll bar, always in view under the panel (that of the timeline stays at the end
  // of the rows): it is synchronized with the timeline and aligned with it
  const hscroll = el('div', 'sch-hscroll');

  const hscrollInner = el('div', 'sch-hscroll-inner');

  hscroll.append(hscrollInner);

  let syncing = false;

  hscroll.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    chart.scrollLeft = hscroll.scrollLeft;
    syncing = false;
  });

  chart.addEventListener('scroll', () => {
    if (syncing) return;
    syncing = true;
    hscroll.scrollLeft = chart.scrollLeft;
    syncing = false;
  });

  /** The bar starts where the timeline starts and ends before the vertical scroll of the panel. */
  function placeHScroll(): void {
    hscroll.style.marginLeft = `${ctx.opts.list === false ? 0 : list.offsetWidth}px`;
    hscroll.style.marginRight = `${Math.max(0, split.offsetWidth - split.clientWidth)}px`;
    hscrollInner.style.width = `${bars.offsetWidth || parseFloat(bars.style.width) || 0}px`;
    hscroll.scrollLeft = chart.scrollLeft;
  }

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => placeHScroll()).observe(split);

  // a click on a month, a week or a day of the scale takes the red line there: to the first working day of the month or
  // week, or to the clicked day; with no cell under the pointer (far zoom, no days), to the day of that position
  scale.addEventListener('click', (e) => {
    if (!ctx.cb.onDay || e.target === dayHandle) return;
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (cell?.classList.contains('sch-day')) return ctx.cb.onDay(cell.dataset.day!);
    if (cell) return ctx.cb.onDay(nextWorkday(cell.dataset.day!, ctx.cal));
    const x = e.clientX - scale.getBoundingClientRect().left;
    ctx.cb.onDay(formatDay(ctx.origin + Math.floor(x / ctx.px())));
  });

  scale.classList.toggle('is-clickable', !!ctx.cb.onDay);

  if (ctx.opts.toolbar === false) bar.hidden = true;

  const empty = el('p', 'sch-empty', 'No tasks yet. Use New Task or Tasks by Level.');
  ctx.empty = empty;

  body.append(bar, split, hscroll, empty);

  root.append(header, body);

  ctx.host.replaceChildren(root);
}
