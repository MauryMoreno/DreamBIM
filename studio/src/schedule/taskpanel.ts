// Panel Task: la tarea o el elemento elegido y, abajo, la curva S del costo con la fecha del deslizador.
import { money } from '../costs/format';
import { displayDay } from './calendar';
import type { GanttRow } from './gantt';
import type { CostCurve, ElementState } from './plan';
import type { TaskKind } from './state';

/** An element of the task: its composed path (the one the viewer draws) and what it is called. */
export interface ElementItem {
  path: string;
  label: string;
}

/** What is known about an element chosen in the model, for the panel. */
export interface ElementInfo {
  name: string;
  cls: string;
  storey: string;
  /** Materiales de sus mallas, sin repetir. */
  materials: string[];
  volume: number;
  area: number;
  /** Su estado 4D en `day` (null fuera del 4D). */
  state: ElementState | null;
  day: string | null;
  /** Su parte del costo de la BOQ (null sin costos). */
  cost: number | null;
  currency: string;
}

/** The panel only informs; the only thing it does is go to what is clicked (an element in the model, a task). */
export interface TaskPanelHandlers {
  /** Un clic en un elemento de la lista: resaltarlo en el modelo. */
  onPickElement?(path: string): void;
  /** A click on one of the tasks of an element: choose that task. */
  onPickTask?(id: string): void;
}

export interface TaskPanel {
  /** `variance`: working days by which the end is behind (+) or ahead (−) of the baseline. `elements`: those the task covers. */
  showTask(row: GanttRow | null, cost: number | null, currency: string, predecessors?: string[], variance?: number | null, elements?: ElementItem[]): void;
  /** An element chosen in 3D: what it is, its state on the date and the tasks it is part of. */
  showElement(path: string, tasks: GanttRow[], info?: ElementInfo | null): void;
  setCurve(curve: CostCurve | null, currency: string, day: string | null): void;
}

const SVG = 'http://www.w3.org/2000/svg';
const KIND_NAMES: Record<TaskKind, string> = { construct: 'Construct', demolish: 'Demolish', temporary: 'Temporary' };
const STATE_NAMES: Record<ElementState, string> = {
  done: 'Built',
  active: 'Under construction',
  future: 'Not started',
  demolish: 'Being demolished',
  temporary: 'Temporary works standing',
  removed: 'Removed',
  none: 'Not scheduled',
};
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDay = (d: string) => SHORT.format(new Date(`${d}T00:00:00Z`));
const qty = (n: number, unit: string) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unit}`;
const W = 300;
const H = 120;
/** The elements painted in the list of the panel: the rest is summarized in one line. */
const MAX_ITEMS = 300;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function mountTaskPanel(host: HTMLElement, handlers: TaskPanelHandlers = {}): TaskPanel {
  const root = el('section', 'ws-panel sch-task');
  root.setAttribute('aria-label', 'Task');
  const body = el('div', 'ws-panel-body sch-task-body');
  const info = el('div', 'sch-info');
  const curveBox = el('div', 'sch-curve-box');
  body.append(info, curveBox);
  root.append(el('header', 'ws-panel-title', 'Task'), body);
  host.replaceChildren(root);

  const message = (box: HTMLElement, text: string) => box.replaceChildren(el('p', 'sch-empty', text));
  message(info, 'Select a task or an element.');
  message(curveBox, 'Add items in Costs to see the cost curve.');

  /** The list of elements of the task (to look at only: it is edited from the task dialog). */
  function elementsSection(items: ElementItem[]): HTMLElement {
    const sec = el('div', 'sch-elements');
    sec.append(el('div', 'sch-elements-head sch-elements-title', `Elements (${items.length})`));
    if (!items.length) {
      sec.append(el('p', 'sch-empty', 'No elements yet. Add them from Edit Task.'));
      return sec;
    }
    const list = el('ul', 'sch-element-list');
    for (const item of items.slice(0, MAX_ITEMS)) {
      const li = el('li');
      const pick = el('button', 'sch-element-item', item.label);
      pick.type = 'button';
      pick.title = item.label;
      pick.addEventListener('click', () => handlers.onPickElement?.(item.path));
      li.append(pick);
      list.append(li);
    }
    if (items.length > MAX_ITEMS) list.append(el('li', 'sch-empty', `and ${items.length - MAX_ITEMS} more`));
    sec.append(list);
    return sec;
  }

  return {
    showTask(row, cost, currency, predecessors = [], variance = null, elements = []) {
      if (!row) return message(info, 'Select a task or an element.');
      const dl = el('dl', 'sch-fields');
      const add = (label: string, value: string) => dl.append(el('dt', undefined, label), el('dd', undefined, value));
      add('Name', row.task.name);
      add('Phase', row.task.phase || 'General');
      add('Start', displayDay(row.dates.start));
      add('End', displayDay(row.dates.end));
      add('Type', KIND_NAMES[row.task.kind ?? 'construct']);
      add('Days', row.task.duration ? String(row.task.duration) : '0 (milestone)');
      add('Complete', `${row.task.progress ?? 0}%`);
      if (row.cpm) add('Float', row.cpm.critical ? `${row.cpm.float} days · critical` : `${row.cpm.float} days`);
      if (row.task.baseline) {
        add('Baseline', `${displayDay(row.task.baseline.start)} – ${displayDay(row.task.baseline.end)}`);
        if (variance !== null) add('Variance', variance === 0 ? 'On baseline' : variance > 0 ? `${variance} days late` : `${-variance} days early`);
      }
      add('Elements', `${row.elements} elements`);
      add('Cost', cost === null ? '—' : money(currency, cost));
      add('Predecessors', predecessors.length ? predecessors.join(', ') : '—');
      info.replaceChildren(dl, ...(row.missing ? [el('p', 'sch-warn', `${row.missing} linked elements are missing`)] : []), elementsSection(elements));
    },
    showElement(path, tasks, data = null) {
      const parts: HTMLElement[] = [];
      // what it is: name and class on top, and its data
      const head = el('div', 'sch-element-head');
      head.append(el('div', 'sch-element-title', data?.name || path));
      if (data?.cls) head.append(el('div', 'sch-element-cls', data.cls));
      parts.push(head);
      if (data) {
        const dl = el('dl', 'sch-fields');
        const add = (label: string, value: string) => dl.append(el('dt', undefined, label), el('dd', undefined, value));
        add('Level', data.storey || '—');
        add('Material', data.materials.length ? data.materials.join(', ') : '—');
        if (data.volume > 0) add('Volume', qty(data.volume, 'm³'));
        if (data.area > 0) add('Area', qty(data.area, 'm²'));
        if (data.state && data.day) add('Status', `${STATE_NAMES[data.state]} on ${shortDay(data.day)}`);
        if (data.cost !== null) add('Cost', money(data.currency, data.cost));
        parts.push(dl);
      } else parts.push(el('div', 'sch-path', path));
      // which tasks it is part of; a click goes to the task
      parts.push(el('div', 'sch-elements-head sch-elements-title', `Tasks (${tasks.length})`));
      if (!tasks.length) parts.push(el('p', 'sch-empty', 'Not in any task.'));
      else {
        const list = el('ul', 'sch-element-tasks');
        for (const r of tasks) {
          const li = el('li');
          const go = el('button', 'sch-element-task');
          go.type = 'button';
          go.classList.toggle('is-critical', !!r.cpm?.critical);
          go.append(
            el('span', 'sch-live-name', r.task.name),
            el('span', 'sch-live-meta', `${r.task.phase || 'General'} · ${displayDay(r.dates.start)} – ${displayDay(r.dates.end)} · ${r.task.progress ?? 0}%`),
          );
          go.title = `Go to ${r.task.name}`;
          go.addEventListener('click', () => handlers.onPickTask?.(r.task.id));
          li.append(go);
          list.append(li);
        }
        parts.push(list);
      }
      info.replaceChildren(...parts);
    },
    setCurve(curve, currency, day) {
      if (!curve || curve.total <= 0 || !curve.days.length) {
        curveBox.replaceChildren(el('p', 'sch-empty', 'Add items in Costs to see the cost curve.'));
        return;
      }
      const chart = svg('svg', { class: 'sch-curve', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Cost curve' });
      const n = curve.days.length;
      const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
      // weekly bars in the bottom third, scaled to the most expensive week
      const maxWeek = Math.max(...curve.weeks.map((w) => w.cost), 0) || 1;
      const weekW = W / curve.weeks.length;
      curve.weeks.forEach((w, i) => {
        const h = (w.cost / maxWeek) * (H / 3);
        chart.append(svg('rect', { class: 'sch-week', x: i * weekW + 1, y: H - h, width: Math.max(1, weekW - 2), height: h }));
      });
      const d = curve.days.map((p, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${(H - (p.cumulative / curve.total) * H).toFixed(1)}`).join(' ');
      chart.append(svg('path', { class: 'sch-cum', d }));
      let spent = 0;
      if (day) {
        let at = -1;
        curve.days.forEach((p, i) => {
          if (p.day <= day) at = i;
        });
        spent = at >= 0 ? curve.days[at].cumulative : 0;
        const lx = at >= 0 ? x(at) : 0;
        chart.append(svg('line', { class: 'sch-curve-day', x1: lx, x2: lx, y1: 0, y2: H }));
      }
      const caption = el(
        'p',
        'sch-curve-text',
        day ? `Spent by ${displayDay(day)}: ${money(currency, spent)} of ${money(currency, curve.total)}` : `Total: ${money(currency, curve.total)}`,
      );
      curveBox.replaceChildren(chart, caption);
    },
  };
}
