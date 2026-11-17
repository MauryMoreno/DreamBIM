import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDateBar } from '../src/schedule/datebar';
import type { GanttRow } from '../src/schedule/gantt';
import { costCurve, schedule } from '../src/schedule/plan';
import { mountTaskPanel } from '../src/schedule/taskpanel';
import { DEFAULT_CALENDAR as CAL, EMPTY_SCHEDULE, type Task } from '../src/schedule/state';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});

const task: Task = { id: 'A', name: 'Walls', phase: '', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [] };
const ROW: GanttRow = { task, dates: { start: '2026-11-05', end: '2026-11-11' }, elements: 12, missing: 0 };
const state = { ...EMPTY_SCHEDULE, tasks: [task] };
const CURVE = costCurve(state, schedule(state).dates, new Map([['A', { elements: ['/w'] }]]), () => 100);

describe('panel Task', () => {
  it('without a selection it shows the help; with a task, its dates, elements and cost', () => {
    const p = mountTaskPanel(host);
    expect(host.querySelector('.sch-info')!.textContent).toBe('Select a task or an element.');
    p.showTask(ROW, 1234.5, 'USD', ['Footings']);
    const text = host.querySelector('.sch-info')!.textContent!;
    expect(text).toContain('Thu, Nov 5, 2026');
    expect(text).toContain('Wed, Nov 11, 2026');
    expect(text).toContain('12 elements');
    expect(text).toContain('$1,234.50');
    expect(text).toContain('Footings');
    expect(text).toContain('General');
  });

  it('a task with missing linked elements warns about it', () => {
    const p = mountTaskPanel(host);
    p.showTask({ ...ROW, missing: 2 }, null, 'USD');
    expect(host.querySelector('.sch-warn')!.textContent).toBe('2 linked elements are missing');
  });

  it('con un elemento lista sus tareas', () => {
    const p = mountTaskPanel(host);
    p.showElement('/w', [ROW, { ...ROW, task: { ...task, name: 'Paint' } }]);
    expect(host.querySelectorAll('.sch-element-tasks li')).toHaveLength(2);
    p.showElement('/x', []);
    expect(host.querySelector('.sch-info')!.textContent).toContain('Not in any task.');
  });

  it('the S curve: cumulative line, a bar per week and what was spent to date', () => {
    const p = mountTaskPanel(host);
    p.setCurve(CURVE, 'USD', '2026-11-10');
    expect(host.querySelectorAll('svg.sch-curve path.sch-cum')).toHaveLength(1);
    expect(host.querySelectorAll('svg.sch-curve rect.sch-week')).toHaveLength(2);
    expect(host.querySelector('line.sch-curve-day')).toBeTruthy();
    expect(host.querySelector('.sch-curve-text')!.textContent).toBe('Spent by Tue, Nov 10, 2026: $80.00 of $100.00');
  });

  it('without costs it shows the help', () => {
    const p = mountTaskPanel(host);
    p.setCurve(null, 'USD', null);
    expect(host.querySelector('.sch-curve-box')!.textContent).toContain('Add items in Costs to see the cost curve.');
  });
});

describe('barra de fecha', () => {
  it('the slider goes by working days and notifies with the date', () => {
    const onDay = vi.fn();
    const b = mountDateBar(host, { onDay, onPlay: vi.fn() });
    b.setRange({ start: '2026-11-05', end: '2026-11-11' }, CAL);
    const range = host.querySelector<HTMLInputElement>('.sch-range')!;
    expect(range.max).toBe('4');
    range.value = '2';
    range.dispatchEvent(new Event('input'));
    expect(onDay).toHaveBeenCalledWith('2026-11-09');
    b.setDay('2026-11-10');
    expect(range.value).toBe('3');
    expect(b.overlay.querySelector('.sch-date')!.textContent).toBe('Tue, Nov 10, 2026');
    expect(b.overlay.querySelector('.sch-datebar-progress')!.textContent).toBe('Workday 4 of 5');
  });

  it('the timeline carries one year per cell and one month per cell, and the marker follows the day', () => {
    const b = mountDateBar(host, { onDay: vi.fn(), onPlay: vi.fn() });
    b.setRange({ start: '2026-11-20', end: '2027-02-10' }, CAL);
    const strip = host.querySelector<HTMLElement>('.sch-tl')!;
    const years = [...strip.querySelectorAll('.sch-tl-year')].map((y) => y.textContent);
    const months = [...strip.querySelectorAll('.sch-tl-month')].map((m) => m.textContent);
    expect(years).toEqual(['2026', '2027']);
    expect(months).toEqual(['Nov', 'Dec', 'Jan', 'Feb']); // meses enteros, aunque el cronograma empiece el 20
    const cursor = strip.querySelector<HTMLElement>('.sch-tl-cursor')!;
    b.setDay('2026-11-30'); // at the end of November: 30 of 120 days (Nov + Dec + Jan + Feb = 30+31+31+28)
    expect(parseFloat(cursor.style.left)).toBeCloseTo((30 / 120) * 100, 5);
    expect(strip.querySelector<HTMLElement>('.sch-tl-fill')!.style.width).toBe(cursor.style.left);
    b.setDay('2027-02-10'); // day 102 of 120
    expect(parseFloat(cursor.style.left)).toBeCloseTo((102 / 120) * 100, 5);
  });

  it('dragging over the timeline chooses the working day of that position', () => {
    const onDay = vi.fn();
    const b = mountDateBar(host, { onDay, onPlay: vi.fn() });
    b.setRange({ start: '2026-11-05', end: '2026-11-30' }, CAL); // the whole of November: 30 days
    const strip = host.querySelector<HTMLElement>('.sch-tl')!;
    strip.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, right: 300, bottom: 30, height: 30, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const at = (x: number) => strip.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { clientX: x, pointerId: 1 }));
    at(10 * 10 + 5); // 10 px per day: day 11 (index 10)
    expect(onDay).toHaveBeenLastCalledWith('2026-11-11');
    at(6 * 10 + 5); // Saturday 7: the last working day that does not exceed it is Friday 6
    expect(onDay).toHaveBeenLastCalledWith('2026-11-06');
    expect(host.querySelector<HTMLInputElement>('.sch-range')!.value).toBe('1');
  });

  it('Play notifies with the new state and setPlaying changes the button', () => {
    const onPlay = vi.fn();
    const b = mountDateBar(host, { onDay: vi.fn(), onPlay });
    b.setRange({ start: '2026-11-05', end: '2026-11-11' }, CAL);
    const play = host.querySelector<HTMLButtonElement>('.sch-play')!;
    play.click();
    expect(onPlay).toHaveBeenCalledWith(true);
    b.setPlaying(true);
    expect(play.getAttribute('aria-pressed')).toBe('true');
    expect(play.textContent).toBe('Pause');
  });

  it('sin rango va desactivada y arranca oculta', () => {
    const b = mountDateBar(host, { onDay: vi.fn(), onPlay: vi.fn() });
    expect(b.root.hidden).toBe(true);
    b.setRange(null, CAL);
    expect(host.querySelector<HTMLInputElement>('.sch-range')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.sch-play')!.disabled).toBe(true);
    b.setVisible(true);
    expect(b.root.hidden).toBe(false);
  });
});
