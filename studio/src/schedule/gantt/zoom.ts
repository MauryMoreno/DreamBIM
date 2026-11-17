import { ZOOMS, START_PX, ROWS, ROW, HEAD, SLIDE, EPS, PAD_BEFORE, PAD_AFTER } from './helpers';
import { parseDay } from '../calendar';
import type { GanttContext } from './context';

export function installZoom(ctx: GanttContext): void {
  ctx.syncZoomButtons = syncZoomButtons;
  ctx.stepPx = stepPx;
  ctx.setPx = setPx;
  ctx.stepRow = stepRow;
  ctx.setRow = setRow;
  ctx.fit = fit;
  ctx.clampToFit = clampToFit;
  ctx.rows = [];

  ctx.span = null;

  ctx.cal = { workdays: [1, 2, 3, 4, 5], holidays: [] };

  let pxDay = START_PX;
 // pixels per day
  ctx.rowH = ROW;
 // alto de fila
  ctx.autoFit = false;
 // after Fit, it keeps adjusting on resize or row changes until a manual zoom is made
  ctx.critical = false;

  ctx.selected = null;

  ctx.marked = new Set<string>();

  ctx.day = null;

  ctx.editable = true;

  ctx.origin = 0;
 // first day of the scale

  const px = () => pxDay;
  ctx.px = px;

  const xOf = (d: string) => (parseDay(d) - ctx.origin) * px();
  ctx.xOf = xOf;

  const MAX_PX = ZOOMS[ZOOMS.length - 1];

  const MAX_ROW = ROWS[ROWS.length - 1];

  /** Zoom with which the whole schedule is seen, in width and height; null while there is no size (not laid out). */
  function fitSize(): { px: number; row: number } | null {
    const w = ctx.chart.clientWidth;
    if (!w) return null;
    const days = (ctx.span ? parseDay(ctx.span.end) - parseDay(ctx.span.start) + 1 : 30) + PAD_BEFORE + PAD_AFTER;
    const px = Math.min(MAX_PX, Math.max(0.05, (w - 2) / days));
    let row = ctx.rowH;
    const h = ctx.split.clientHeight;
    if (ctx.opts.zoomY && h) {
      const lines = ctx.rows.length + new Set(ctx.rows.map((r) => r.task.phase || 'General')).size;
      row = Math.min(MAX_ROW, Math.max(4, Math.floor((h - HEAD - 2) / Math.max(1, lines))));
    }
    return { px, row };
  }

  /** Minimum zoom and row height allowed: those of the fit with minFit, and those of the scale otherwise. */
  const minPx = () => (ctx.opts.minFit ? (fitSize()?.px ?? ZOOMS[0]) : ZOOMS[0]);

  const minRow = () => (ctx.opts.minFit && ctx.opts.zoomY ? (fitSize()?.row ?? ROWS[0]) : ROWS[0]);

  /** With minFit, being at the minimum of both axes is being at the fit: it keeps adjusting on resize. */
  const atFit = () => !!ctx.opts.minFit && pxDay <= minPx() + EPS && (!ctx.opts.zoomY || ctx.rowH <= minRow() + EPS);

  // the horizontal slider is logarithmic (each step multiplies the days per pixel); the vertical one, linear
  const sliderToPx = (t: number) => minPx() * (MAX_PX / minPx()) ** t;
  ctx.sliderToPx = sliderToPx;

  const pxToSlider = () => (MAX_PX > minPx() ? Math.log(pxDay / minPx()) / Math.log(MAX_PX / minPx()) : 0);

  const sliderToRow = (t: number) => Math.round(minRow() + t * (MAX_ROW - minRow()));
  ctx.sliderToRow = sliderToRow;

  const rowToSlider = () => (MAX_ROW > minRow() ? (ctx.rowH - minRow()) / (MAX_ROW - minRow()) : 0);

  function syncZoomButtons(): void {
    const lo = minPx();
    const loRow = minRow();
    ctx.zoomOut.disabled = pxDay <= lo + EPS;
    ctx.zoomIn.disabled = pxDay >= MAX_PX - EPS;
    ctx.rowsShort.disabled = ctx.rowH <= loRow;
    ctx.rowsTall.disabled = ctx.rowH >= MAX_ROW;
    // the slider being dragged is not moved
    for (const [sl, t] of [[ctx.slidePx, pxToSlider], [ctx.slideRow, rowToSlider]] as const) {
      if (sl && document.activeElement !== sl.input) sl.input.value = String(Math.round(Math.min(1, Math.max(0, t())) * SLIDE));
    }
  }

  /** Horizontal zoom to the next step of the scale (from a Fit, the nearest one above or below). */
  function stepPx(dir: 1 | -1): void {
    const lo = minPx();
    if (dir < 0 && pxDay <= lo + EPS) return;
    const up = ZOOMS.find((z) => z > pxDay + EPS);
    const down = [...ZOOMS].reverse().find((z) => z < pxDay - EPS);
    const next = dir > 0 ? up : Math.max(down ?? lo, lo);
    if (next !== undefined) setPx(next);
  }

  function setPx(v: number): void {
    const centre = (ctx.chart.scrollLeft + ctx.chart.clientWidth / 2) / pxDay; // the day at the center stays at the center
    pxDay = Math.min(MAX_PX, Math.max(minPx(), v));
    ctx.autoFit = atFit();
    ctx.render();
    ctx.chart.scrollLeft = Math.max(0, centre * pxDay - ctx.chart.clientWidth / 2);
  }

  function stepRow(dir: 1 | -1): void {
    const lo = minRow();
    if (dir < 0 && ctx.rowH <= lo) return;
    const up = ROWS.find((r) => r > ctx.rowH);
    const down = [...ROWS].reverse().find((r) => r < ctx.rowH);
    const next = dir > 0 ? up : Math.max(down ?? lo, lo);
    if (next !== undefined) setRow(next);
  }

  function setRow(v: number): void {
    const centre = (ctx.split.scrollTop + ctx.split.clientHeight / 2) / ctx.rowH;
    ctx.rowH = Math.min(MAX_ROW, Math.max(minRow(), v));
    ctx.autoFit = atFit();
    ctx.render();
    ctx.split.scrollTop = Math.max(0, centre * ctx.rowH - ctx.split.clientHeight / 2);
  }

  function fit(): void {
    const f = fitSize();
    if (!f) return;
    pxDay = f.px;
    if (ctx.opts.zoomY) ctx.rowH = f.row;
    ctx.render();
    ctx.chart.scrollLeft = 0;
    ctx.split.scrollTop = 0;
    ctx.autoFit = true;
  }

  /** With minFit, if the fit grew (bigger window, fewer tasks) and the zoom was left below it, it raises it to the fit. */
  function clampToFit(): void {
    if (!ctx.opts.minFit) return;
    const px = Math.max(pxDay, minPx());
    const row = Math.max(ctx.rowH, minRow());
    if (px === pxDay && row === ctx.rowH) return;
    pxDay = px;
    ctx.rowH = row;
    ctx.autoFit = atFit();
    ctx.render();
  }

  // Ctrl + rueda: zoom horizontal; Alt + rueda: vertical (si hay zoom vertical)
  ctx.split.addEventListener(
    'wheel',
    (e) => {
      const vertical = e.altKey && ctx.opts.zoomY;
      if (!e.ctrlKey && !vertical) return;
      e.preventDefault();
      const dir = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
      if (vertical) stepRow(dir);
      else stepPx(dir);
    },
    { passive: false },
  );

  if (ctx.opts.zoomY && typeof ResizeObserver !== 'undefined') {
    let frame = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (ctx.autoFit ? fit() : clampToFit()));
    }).observe(ctx.split);
  }
}
