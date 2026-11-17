// Date bar of the 4D (inside the view bar, next to the visual style): Play/Pause and a timeline with
// years and months that takes the rest of the width, where the date is dragged (what has passed darker and a red marker
// on the day). The date goes apart, in a label (`overlay`) placed over the model, bottom left. The
// slider by working days is still there, hidden from view but available to the keyboard: the timeline drives it.
import { displayDay, formatDay, parseDay, today, workdaysBetween } from './calendar';
import type { TaskDates } from './plan';
import type { Calendar } from './state';

export interface DateBar {
  root: HTMLElement;
  /** La fecha y el avance, para colocarlos sobre el modelo. */
  overlay: HTMLElement;
  setRange(span: TaskDates | null, cal: Calendar): void;
  setDay(day: string): void;
  setPlaying(on: boolean): void;
  setVisible(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Width assumed while it cannot be measured (not laid out). With the real one, the texts that fit in each year and month appear. */
const STRIP_FALLBACK = 640;
const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const MONTH_FULL = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Year and month (0-11) of day `n` (days since 1970-01-01). */
const ymOf = (n: number): [number, number] => {
  const d = new Date(n * 86_400_000);
  return [d.getUTCFullYear(), d.getUTCMonth()];
};
const firstOf = (y: number, m: number) => Date.UTC(y, m, 1) / 86_400_000;

export function mountDateBar(host: HTMLElement, cb: { onDay(day: string): void; onPlay(on: boolean): void }): DateBar {
  const root = el('div', 'sch-datebar');
  const play = el('button', 'sch-btn sch-play', 'Play');
  play.type = 'button';
  play.setAttribute('aria-pressed', 'false');
  const range = el('input', 'sch-range');
  range.type = 'range';
  range.min = '0';
  range.step = '1';
  range.setAttribute('aria-label', 'Schedule date');
  const label = el('span', 'sch-date', '—');
  const progress = el('span', 'sch-datebar-progress');
  const overlay = el('div', 'sch-date-overlay');
  overlay.hidden = true;
  overlay.append(label, progress);
  const strip = el('div', 'sch-tl');
  strip.setAttribute('aria-hidden', 'true'); // el deslizador es el control accesible
  const fill = el('div', 'sch-tl-fill');
  const cursor = el('div', 'sch-tl-cursor');
  strip.append(fill, cursor);
  root.append(play, strip, range);
  root.hidden = true;
  host.append(root);

  let days: string[] = [];
  let first = 0; // first day of the timeline (day 1 of the month in which the schedule starts)
  let total = 0; // days it covers
  let width = STRIP_FALLBACK; // width of the timeline in px
  let lastSpan: TaskDates | null = null;
  let current: string | null = null; // the day shown

  const pct = (n: number) => `${((n - first) / total) * 100}%`;

  /** Years (above) and months (below) of the whole range, one month per cell. */
  function drawStrip(span: TaskDates | null): void {
    lastSpan = span;
    for (const c of [...strip.querySelectorAll('.sch-tl-year, .sch-tl-month, .sch-tl-today')]) c.remove();
    if (!span) {
      total = 0;
      return;
    }
    const [y0, m0] = ymOf(parseDay(span.start));
    const [y1, m1] = ymOf(parseDay(span.end));
    first = firstOf(y0, m0);
    total = firstOf(y1, m1 + 1) - first;
    width = strip.clientWidth || STRIP_FALLBACK;
    const px = (n: number) => (n / total) * width;
    for (let y = y0; y <= y1; y++) {
      const a = Math.max(first, firstOf(y, 0));
      const b = Math.min(first + total, firstOf(y + 1, 0));
      const cell = el('div', 'sch-tl-year', px(b - a) >= 30 ? String(y) : '');
      cell.style.left = pct(a);
      cell.style.width = `${((b - a) / total) * 100}%`;
      cell.title = String(y);
      strip.append(cell);
    }
    let y = y0;
    let m = m0;
    while (y < y1 || (y === y1 && m <= m1)) {
      const a = firstOf(y, m);
      const b = firstOf(y, m + 1);
      const w = px(b - a);
      const name = MONTH_NAME.format(new Date(a * 86_400_000));
      const cell = el('div', 'sch-tl-month', w >= 24 ? name : w >= 9 ? name[0] : '');
      cell.style.left = pct(a);
      cell.style.width = `${((b - a) / total) * 100}%`;
      cell.title = MONTH_FULL.format(new Date(a * 86_400_000));
      cell.classList.toggle('is-year-start', m === 0);
      strip.append(cell);
      if (m === 11) {
        y++;
        m = 0;
      } else m++;
    }
    // today, if it falls within the range: a dotted line under the years
    const now = parseDay(today());
    if (now >= first && now < first + total) {
      const mark = el('div', 'sch-tl-today');
      mark.style.left = pct(now);
      mark.title = 'Today';
      strip.append(mark);
    }
  }

  /** The marker goes at the end of the day; what has passed is what is left of it. */
  function place(day: string | null): void {
    cursor.hidden = !total;
    const n = day && total ? Math.min(first + total - 1, Math.max(first, parseDay(day))) : first;
    const at = total ? `${((n + 1 - first) / total) * 100}%` : '0%';
    fill.style.width = day ? at : '0%';
    cursor.style.left = at;
  }

  /** Working day of the schedule under the position `clientX` of the timeline (the last one that does not exceed it). */
  function dayAt(clientX: number): string | null {
    if (!days.length || !total) return null;
    const box = strip.getBoundingClientRect();
    const n = first + Math.floor(((clientX - box.left) / (box.width || width)) * total);
    const at = formatDay(n);
    let i = 0;
    days.forEach((d, k) => {
      if (d <= at) i = k;
    });
    return days[i];
  }

  const drag = (e: PointerEvent) => {
    const d = dayAt(e.clientX);
    if (!d) return;
    range.value = String(days.indexOf(d));
    cb.onDay(d);
  };
  // on hover, the tooltip says which day each position is
  strip.addEventListener('pointermove', (e) => {
    const d = dayAt(e.clientX);
    strip.title = d ? displayDay(d) : '';
  });
  // across the whole space: when resizing, the years and months are redrawn with the new width
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const w = strip.clientWidth;
      if (!w || w === width || !lastSpan) return;
      drawStrip(lastSpan);
      place(current);
    }).observe(strip);
  }
  strip.addEventListener('pointerdown', (e) => {
    if (range.disabled) return;
    strip.setPointerCapture?.(e.pointerId);
    drag(e);
    strip.addEventListener('pointermove', drag);
    const end = () => {
      strip.removeEventListener('pointermove', drag);
      strip.removeEventListener('pointerup', end);
      strip.removeEventListener('pointercancel', end);
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
  });

  play.addEventListener('click', () => cb.onPlay(play.getAttribute('aria-pressed') !== 'true'));
  range.addEventListener('input', () => {
    const d = days[Number(range.value)];
    if (d) cb.onDay(d);
  });

  return {
    root,
    overlay,
    setRange(span, cal) {
      days = span ? workdaysBetween(span.start, span.end, cal) : [];
      range.max = String(Math.max(0, days.length - 1));
      range.disabled = days.length === 0;
      play.disabled = days.length === 0;
      if (!days.length) label.textContent = '—';
      drawStrip(span);
      strip.classList.toggle('is-disabled', days.length === 0);
      current = null;
      progress.textContent = '';
      place(null);
    },
    setDay(day) {
      let at = 0;
      days.forEach((d, i) => {
        if (d <= day) at = i;
      });
      range.value = String(at);
      label.textContent = displayDay(day);
      current = day;
      progress.textContent = days.length ? `Workday ${at + 1} of ${days.length}` : '';
      place(day);
    },
    setPlaying(on) {
      play.setAttribute('aria-pressed', String(on));
      play.textContent = on ? 'Pause' : 'Play';
    },
    setVisible(on) {
      root.hidden = !on;
      overlay.hidden = !on;
    },
  };
}
