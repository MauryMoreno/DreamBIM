// Work calendar dialog: days of the week and holidays (one per line, YYYY-MM-DD).
import { parseDay } from './calendar';
import type { Calendar } from './state';

/** From Monday to Sunday, with their day number (0 = Sunday). */
const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** null if cancelled or if a dialog is already open. */
export function askCalendar(initial: Calendar): Promise<Calendar | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal sch-calendar-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Calendar');
  box.append(el('div', 'modal-title', 'Working calendar'));
  const days = el('fieldset', 'sch-days');
  days.append(el('legend', undefined, 'Working days'));
  const checks = DAYS.map(([n, label]) => {
    const lab = el('label', 'sch-check');
    const cb = Object.assign(el('input'), { type: 'checkbox', value: String(n), checked: initial.workdays.includes(n) });
    lab.append(cb, document.createTextNode(label));
    days.append(lab);
    return cb;
  });
  const holidaysLabel = el('label', 'sch-field');
  const holidays = Object.assign(el('textarea', 'sch-holidays'), { rows: 5, value: initial.holidays.join('\n') });
  holidaysLabel.append(el('span', 'sch-field-label', 'Holidays (one per line, YYYY-MM-DD)'), holidays);
  const error = el('div', 'sch-error');
  error.setAttribute('role', 'alert');
  const row = el('div', 'modal-buttons');
  box.append(days, holidaysLabel, error, row);
  scrim.append(box);

  return new Promise((resolve) => {
    const finish = (answer: Calendar | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    const ok = el('button', 'modal-btn modal-btn-primary', 'Save');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      const workdays = checks.filter((c) => c.checked).map((c) => Number(c.value)).sort();
      if (!workdays.length) return void (error.textContent = 'Pick at least one working day');
      const list: string[] = [];
      const lines = holidays.value.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const d = lines[i].trim();
        if (!d) continue;
        if (Number.isNaN(parseDay(d))) return void (error.textContent = `Line ${i + 1} is not a date (YYYY-MM-DD)`);
        list.push(d);
      }
      finish({ workdays, holidays: [...new Set(list)].sort() });
    });
    const cancel = el('button', 'modal-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    row.append(ok, cancel);
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    });
    document.body.append(scrim);
    checks[0].focus();
  });
}
