// Work calendar. Dates are 'YYYY-MM-DD' strings and counting is in UTC days: the time zone of the
// machine never shifts a day.
import { DAY_RE, type Calendar } from './state';

const MS_DAY = 86_400_000;
/** Cap on the days searched forward: a calendar with no working days hangs nothing. */
const MAX_SEARCH = 370;

/** Days since 1970-01-01 (UTC); NaN if it is not a valid 'YYYY-MM-DD' date. */
export function parseDay(d: string): number {
  if (!DAY_RE.test(d)) return NaN;
  const [y, m, day] = d.split('-').map(Number);
  const t = Date.UTC(y, m - 1, day);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== day) return NaN;
  return t / MS_DAY;
}

export function formatDay(n: number): string {
  return new Date(n * MS_DAY).toISOString().slice(0, 10);
}

const weekday = (n: number): number => new Date(n * MS_DAY).getUTCDay();

function isWorkdayN(n: number, cal: Calendar): boolean {
  return cal.workdays.includes(weekday(n)) && !cal.holidays.includes(formatDay(n));
}

export function isWorkday(d: string, cal: Calendar): boolean {
  return isWorkdayN(parseDay(d), cal);
}

function nextWorkdayN(n: number, cal: Calendar): number {
  for (let i = 0; i <= MAX_SEARCH; i++) if (isWorkdayN(n + i, cal)) return n + i;
  return n;
}

/** The same day if it is a working day; otherwise, the next one that is. */
export function nextWorkday(d: string, cal: Calendar): string {
  return formatDay(nextWorkdayN(parseDay(d), cal));
}

/** `n` working days after `d` (which is first moved to the next working day). */
export function addWorkdays(d: string, n: number, cal: Calendar): string {
  let day = nextWorkdayN(parseDay(d), cal);
  for (let left = n; left > 0; left--) {
    const next = nextWorkdayN(day + 1, cal);
    if (next === day + 1 && !isWorkdayN(next, cal)) break; // calendario sin laborables
    day = next;
  }
  return formatDay(day);
}

/** Laborables de `a` a `b`, ambos incluidos. */
export function workdaysBetween(a: string, b: string, cal: Calendar): string[] {
  const out: string[] = [];
  const end = parseDay(b);
  for (let n = parseDay(a); n <= end; n++) if (isWorkdayN(n, cal)) out.push(formatDay(n));
  return out;
}

/** Lunes de la semana ISO de `d`. */
export function weekStart(d: string): string {
  const n = parseDay(d);
  return formatDay(n - ((weekday(n) + 6) % 7));
}

const DISPLAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** 'Tue, Nov 3, 2026' */
export function displayDay(d: string): string {
  return DISPLAY.format(new Date(parseDay(d) * MS_DAY));
}

/** Today on the user's clock, as 'YYYY-MM-DD'. */
export function today(): string {
  const now = new Date();
  return formatDay(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_DAY);
}
