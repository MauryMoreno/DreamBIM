import { parseDay } from '../calendar';
import type { TaskDates } from '../plan';
import { GanttRow } from './types';

/** Pixels per day: from seeing whole years (0.5) to days with a number (16, the starting one) and more. */
export const ZOOMS = [0.5, 1, 2, 4, 8, 16, 32, 64];

export const START_PX = 16;

/** Alto de fila en px: 24 es el del listado. */
export const ROWS = [6, 8, 12, 16, 20, 24, 32, 40, 56];

export const ROW = 24;

/** Height of the scale (month, week and day). */
export const HEAD = 48;

/** Pasos de un deslizable de zoom. */
export const SLIDE = 1000;

export const EPS = 1e-6;

/** Height of a bar in a row of `h` px: 16 with the usual height and thinner if the row is low. */
export const barHeight = (h: number) => Math.max(3, Math.min(16, h - 8));

/** Days of margin before the start and after the end of the project. */
export const PAD_BEFORE = 3;

export const PAD_AFTER = 10;

export const CLICK_SLOP = 4;

/** When dragging, within these px of an edge of the timeline (or outside) it scrolls on its own; at most MAX_STEP px per frame. */
export const EDGE = 36;

export const MAX_STEP = 32;

/** Tramo recto que sale de la barra y que llega a ella antes de torcer, en px. */
export const LEAD = 10;

export const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const SVG = 'http://www.w3.org/2000/svg';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** ISO 8601 week number of day `n` (days since 1970-01-01). */
export function isoWeek(n: number): number {
  const thursday = n - ((n - 4) % 7 + 7) % 7 + 3; // the Thursday of its week decides the year
  const year = new Date(thursday * 86_400_000).getUTCFullYear();
  return Math.floor((thursday - Date.UTC(year, 0, 1) / 86_400_000) / 7) + 1;
}

export const short = (d: string) => SHORT.format(new Date(parseDay(d) * 86_400_000));

/** From the first start to the last end of some rows. */
export function projectOf(list: GanttRow[]): TaskDates {
  let s = list[0].dates.start;
  let e = list[0].dates.end;
  for (const r of list) {
    if (r.dates.start < s) s = r.dates.start;
    if (r.dates.end > e) e = r.dates.end;
  }
  return { start: s, end: e };
}

/** Arrowheads of the dependencies, normal and critical (polygons: the tests count the <path> of the links). */
export function arrowDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG, 'defs');
  for (const [id, cls] of [['sch-arrow', ''], ['sch-arrow-critical', 'is-critical']]) {
    const m = document.createElementNS(SVG, 'marker');
    const attrs = { id, viewBox: '0 0 8 8', refX: '8', refY: '4', markerWidth: '8', markerHeight: '8', orient: 'auto', markerUnits: 'userSpaceOnUse' };
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
    const tip = document.createElementNS(SVG, 'polygon');
    tip.setAttribute('points', '0 0, 8 4, 0 8');
    if (cls) tip.setAttribute('class', cls);
    m.append(tip);
    defs.append(m);
  }
  return defs;
}

/** Bends of a dependency with rounded corners (radius `r`, smaller if the stretch is short). */
export function roundedPath(pts: [number, number][], r: number): string {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const a = Math.hypot(cx - px, cy - py);
    const b = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, a / 2, b / 2);
    if (rr <= 0) {
      d += ` L ${cx} ${cy}`;
      continue;
    }
    d += ` L ${cx + ((px - cx) / a) * rr} ${cy + ((py - cy) / a) * rr} Q ${cx} ${cy} ${cx + ((nx - cx) / b) * rr} ${cy + ((ny - cy) / b) * rr}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L ${lx} ${ly}`;
}
