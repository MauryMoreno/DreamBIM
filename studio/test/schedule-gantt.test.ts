import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGantt, type GanttRow } from '../src/schedule/gantt';
import { DEFAULT_CALENDAR as CAL, fs, type Task } from '../src/schedule/state';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});

const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: `Task ${id}`, phase: 'Structure', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [], ...over,
});
const A: GanttRow = { task: T('A'), dates: { start: '2026-11-05', end: '2026-11-11' }, elements: 3, missing: 0 };
const B: GanttRow = {
  task: T('B', { phase: 'Finishes', duration: 3, deps: [fs('A')] }), dates: { start: '2026-11-12', end: '2026-11-16' }, elements: 1, missing: 2,
};
const SPAN = { start: '2026-11-05', end: '2026-11-16' };
const cb = () => ({ onSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onResize: vi.fn() });
const barOf = (id: string) => host.querySelector<HTMLElement>(`.sch-bar[data-id="${id}"]`)!;
const pointer = (target: EventTarget, type: string, x: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x }));
/** Arrastra de x a x + dx: pointerdown en el elemento y pointermove/up en la ventana. */
const drag = (target: HTMLElement, dx: number) => {
  pointer(target, 'pointerdown', 100);
  pointer(window, 'pointermove', 100 + dx);
  pointer(window, 'pointerup', 100 + dx);
};

describe('Gantt', () => {
  it('it groups by phase and the bar measures the calendar days it occupies', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    expect([...host.querySelectorAll('.sch-phase')].map((r) => r.textContent)).toEqual(['Structure', 'Finishes']);
    expect(barOf('A').style.width).toBe('112px'); // 7 days (crosses a weekend) × 16
    expect(barOf('A').style.left).toBe('48px'); // 3 days of margin
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    expect(barOf('A').style.width).toBe('224px');
  });

  it('without tasks it shows the help', () => {
    const g = mountGantt(host, cb());
    g.setRows([], null, CAL);
    expect(host.querySelector<HTMLElement>('.sch-empty')!.hidden).toBe(false);
  });

  it('dragging the bar 2 days moves it to the next working day; a short movement is a click', () => {
    const c = cb();
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL);
    drag(barOf('A'), 32);
    expect(c.onMove).toHaveBeenCalledWith('A', '2026-11-09'); // Thursday + 2 = Saturday → Monday
    drag(barOf('A'), 2);
    expect(c.onSelect).toHaveBeenCalledWith('A');
    expect(c.onMove).toHaveBeenCalledTimes(1);
  });

  it('stretching the right edge by a day gives one more working day', () => {
    const c = cb();
    const g = mountGantt(host, c);
    g.setRows([A], SPAN, CAL);
    drag(barOf('A').querySelector<HTMLElement>('.sch-handle')!, 16);
    expect(c.onResize).toHaveBeenCalledWith('A', 6);
    expect(c.onMove).not.toHaveBeenCalled();
  });

  it('en solo lectura arrastrar no mueve ni estira', () => {
    const c = cb();
    const g = mountGantt(host, c);
    g.setRows([A], SPAN, CAL);
    g.setEditable(false);
    drag(barOf('A'), 32);
    drag(barOf('A').querySelector<HTMLElement>('.sch-handle')!, 16);
    expect(c.onMove).not.toHaveBeenCalled();
    expect(c.onResize).not.toHaveBeenCalled();
  });

  it('las filas: clic selecciona, doble clic edita, Supr borra', () => {
    const c = cb();
    const g = mountGantt(host, c);
    g.setRows([A], SPAN, CAL);
    const row = host.querySelector<HTMLElement>('.sch-row')!;
    row.click();
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(c.onSelect).toHaveBeenCalledWith('A');
    expect(c.onEdit).toHaveBeenCalledWith('A');
    expect(c.onDelete).toHaveBeenCalledWith('A');
  });

  it('it draws the dependency, the date line and marks the tasks', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    expect(host.querySelectorAll('svg.sch-links path')).toHaveLength(1);
    g.setDay('2026-11-09');
    const line = host.querySelector<HTMLElement>('.sch-dayline')!;
    expect(line.hidden).toBe(false);
    expect(line.style.left).toBe(`${(4 + 3) * 16 + 8}px`); // 9 Nov: 4 days after the start + 3 of margin
    g.markTasks(['B']);
    g.setSelected('A');
    expect(barOf('B').classList.contains('is-marked')).toBe(true);
    expect(host.querySelector('.sch-row[data-id="A"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('it warns of the missing linked elements', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    expect(host.querySelector<HTMLElement>('.sch-row[data-id="B"] .sch-missing')!.title).toBe('2 linked elements are missing');
    expect(host.querySelector('.sch-row[data-id="A"] .sch-missing')).toBeNull();
  });

  it('columns like MS Project: number, predecessors with type and lag, progress and slack', () => {
    const g = mountGantt(host, cb());
    const b = { ...B, task: { ...B.task, deps: [fs('A'), { task: 'A', type: 'SS' as const, lag: 2 }], progress: 40 }, cpm: { float: 3, critical: false } };
    g.setRows([{ ...A, cpm: { float: 0, critical: true } }, b], SPAN, CAL);
    expect([...host.querySelectorAll('.sch-list thead th')].map((th) => th.textContent)).toEqual(['#', 'Task', 'Dur', 'Start', 'Finish', 'Pred', '%', 'Float']);
    const cells = [...host.querySelectorAll('.sch-row[data-id="B"] td')].map((td) => td.textContent);
    expect(cells[0]).toBe('2');
    expect(cells[5]).toBe('1, 1SS+2');
    expect(cells[6]).toBe('40%');
    expect(cells[7]).toBe('3');
    expect(host.querySelector<HTMLElement>('.sch-bar[data-id="B"] .sch-progress')!.style.width).toBe('40%');
  });

  it('the critical path is always marked and is painted with setCritical', () => {
    const g = mountGantt(host, cb());
    g.setRows([{ ...A, cpm: { float: 0, critical: true } }, { ...B, cpm: { float: 0, critical: true } }], SPAN, CAL);
    expect(barOf('A').classList.contains('is-critical')).toBe(true);
    expect(host.querySelector('.sch-gantt')!.classList.contains('show-critical')).toBe(false);
    g.setCritical(true);
    expect(host.querySelector('.sch-gantt')!.classList.contains('show-critical')).toBe(true);
    expect(host.querySelector('svg.sch-links path')!.getAttribute('class')).toBe('is-critical');
  });

  it('a milestone is a diamond without a handle, the phase has a summary bar and the baseline goes below', () => {
    const c = cb();
    const g = mountGantt(host, c);
    const m: GanttRow = { ...A, task: T('M', { duration: 0 }), dates: { start: '2026-11-11', end: '2026-11-11' } };
    const withBase: GanttRow = { ...A, task: T('A', { baseline: { start: '2026-11-05', end: '2026-11-09' } }) };
    g.setRows([withBase, m], SPAN, CAL);
    expect(barOf('M').classList.contains('is-milestone')).toBe(true);
    drag(barOf('M').querySelector<HTMLElement>('.sch-handle')!, 32);
    expect(c.onResize).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.sch-summary')).toHaveLength(1);
    expect(host.querySelector<HTMLElement>('.sch-summary')!.style.width).toBe('112px');
    expect(host.querySelector<HTMLElement>('.sch-baseline')!.style.width).toBe('80px');
  });

  it('an SS link leaves from the start of the predecessor', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, { ...B, task: { ...B.task, deps: [{ task: 'A', type: 'SS', lag: 0 }] } }], SPAN, CAL);
    expect(host.querySelector('svg.sch-links path')!.getAttribute('d')!.startsWith('M 48 ')).toBe(true);
  });
});

describe('Gantt: opciones, zoom y ajuste', () => {
  /** jsdom does not lay out: the sizes that `fit` reads are fixed. */
  const sized = (w: number, h: number) => {
    const chart = host.querySelector<HTMLElement>('.sch-chart')!;
    const split = host.querySelector<HTMLElement>('.sch-split')!;
    Object.defineProperty(chart, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(split, 'clientHeight', { value: h, configurable: true });
  };

  it('without a list it marks the root and does not offer vertical zoom unless requested', () => {
    mountGantt(host, cb(), { list: false });
    expect(host.querySelector('.sch-gantt')!.classList.contains('no-list')).toBe(true);
    expect(host.querySelector('[aria-label="Taller rows"]')).toBeNull();
    document.body.innerHTML = '<div id="h"></div>';
    host = document.getElementById('h')!;
    mountGantt(host, cb());
    expect(host.querySelector('.sch-gantt')!.classList.contains('no-list')).toBe(false);
  });

  it('the horizontal zoom goes down from 16 to 0.5 px per day and back up', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    const out = host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
    for (let i = 0; i < 5; i++) out.click(); // 16 → 8 → 4 → 2 → 1 → 0,5
    expect(barOf('A').style.width).toBe('3.5px');
    expect(out.disabled).toBe(true);
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    expect(barOf('A').style.width).toBe('7px');
  });

  it('the vertical zoom changes the height of the rows, of the bars and the position of each one', () => {
    const g = mountGantt(host, cb(), { zoomY: true });
    g.setRows([A, B], SPAN, CAL);
    // fila 0 = fase Structure, fila 1 = A: con 24 px la barra de 16 empieza a 24 + 4
    expect([barOf('A').style.top, barOf('A').style.height]).toEqual(['28px', '16px']);
    host.querySelector<HTMLButtonElement>('[aria-label="Taller rows"]')!.click(); // 24 → 32
    expect([barOf('A').style.top, barOf('A').style.height]).toEqual(['40px', '16px']);
    const shorter = host.querySelector<HTMLButtonElement>('[aria-label="Shorter rows"]')!;
    for (let i = 0; i < 6; i++) shorter.click(); // 32 → 24 → 20 → 16 → 12 → 8 → 6
    expect([barOf('A').style.top, barOf('A').style.height]).toEqual(['7.5px', '3px']); // 6 de la fila + 1,5 para centrar 3 en 6
    expect(shorter.disabled).toBe(true);
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('24px'); // 4 filas de 6
  });

  it('Fit ajusta el ancho y el alto para ver todo, y lo mantiene mientras no se haga zoom a mano', () => {
    const g = mountGantt(host, cb(), { list: false, zoomY: true });
    g.setRows([A, B], SPAN, CAL);
    sized(400, 248);
    g.fit();
    // 12 days + 3 + 10 of margin = 25 days in 398 px
    expect(barOf('A').style.width).toBe(`${(398 / 25) * 7}px`);
    // 4 lines (2 phases + 2 tasks) in 248 - 48 (scale) - 2 = 198 px → rows of 49
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('196px');
    // the tasks change: it stays fitted; with one more, 5 lines → rows of 39
    const C: GanttRow = { ...B, task: { ...B.task, id: 'C', name: 'C' } };
    g.setRows([A, B, C], SPAN, CAL);
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('195px');
    // un zoom a mano suelta el ajuste
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    g.setRows([A, B], SPAN, CAL); // ya sin ajuste: las filas se quedan en 39
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('156px');
  });

  it('Ctrl + rueda hace zoom horizontal y Alt + rueda vertical', () => {
    const g = mountGantt(host, cb(), { zoomY: true });
    g.setRows([A, B], SPAN, CAL);
    const split = host.querySelector<HTMLElement>('.sch-split')!;
    const wheel = (init: WheelEventInit) => {
      const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: init.deltaY });
      // jsdom does not copy the modifier keys to the WheelEvent (the browser does)
      Object.defineProperties(e, { ctrlKey: { value: !!init.ctrlKey }, altKey: { value: !!init.altKey } });
      split.dispatchEvent(e);
      return e;
    };
    expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false); // sin tecla, la rueda desplaza
    expect(barOf('A').style.width).toBe('112px');
    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true);
    expect(barOf('A').style.width).toBe('224px');
    wheel({ deltaY: 100, ctrlKey: true });
    expect(barOf('A').style.width).toBe('112px');
    wheel({ deltaY: -100, altKey: true });
    expect(barOf('A').style.height).toBe('16px');
    expect(barOf('A').style.top).toBe('40px'); // filas de 32
  });
});

describe('Gantt: indicator of the day line', () => {
  it('without onDay there is no indicator; with onDay it shows the date on the scale', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    g.setDay('2026-11-09');
    expect(host.querySelector<HTMLElement>('.sch-dayhandle')!.hidden).toBe(true);
    document.body.innerHTML = '<div id="h"></div>';
    host = document.getElementById('h')!;
    const g2 = mountGantt(host, { ...cb(), onDay: vi.fn() });
    g2.setRows([A, B], SPAN, CAL);
    expect(host.querySelector<HTMLElement>('.sch-dayhandle')!.hidden).toBe(true); // no day yet
    g2.setDay('2026-11-09');
    const handle = host.querySelector<HTMLElement>('.sch-dayhandle')!;
    expect(handle.hidden).toBe(false);
    expect(handle.textContent).toBe('Nov 9');
    expect(handle.style.left).toBe(`${(4 + 3) * 16 + 8}px`); // on the line
    expect(handle.parentElement!.classList.contains('sch-scale')).toBe(true);
    g2.setRows([A, B], SPAN, CAL); // pintar de nuevo no pierde el indicador
    expect(host.querySelector('.sch-scale .sch-dayhandle')).not.toBeNull();
    g2.setDay(null);
    expect(host.querySelector<HTMLElement>('.sch-dayhandle')!.hidden).toBe(true);
  });

  it('dragging the indicator notifies with the day under the pointer, once per day', () => {
    const c = { ...cb(), onDay: vi.fn() };
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL);
    g.setDay('2026-11-09');
    const handle = host.querySelector<HTMLElement>('.sch-dayhandle')!;
    pointer(handle, 'pointerdown', 120);
    pointer(window, 'pointermove', (3 + 6) * 16 + 4); // 16 px per day and 3 of margin: 6 days after the start = 11 Nov
    pointer(window, 'pointermove', (3 + 6) * 16 + 9); // same day: it does not repeat
    pointer(window, 'pointermove', (3 + 8) * 16 + 1); // 13 nov
    pointer(window, 'pointerup', 0);
    pointer(window, 'pointermove', 0); // ya soltado: nada
    expect(c.onDay.mock.calls.map((x) => x[0])).toEqual(['2026-11-11', '2026-11-13']);
  });
});

describe('Gantt: minimum at the fit, sliders and touched bars', () => {
  const sized = (w: number, h: number) => {
    Object.defineProperty(host.querySelector<HTMLElement>('.sch-chart')!, 'clientWidth', { value: w, configurable: true });
    Object.defineProperty(host.querySelector<HTMLElement>('.sch-split')!, 'clientHeight', { value: h, configurable: true });
  };
  const slide = (label: string, value: number) => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
    return input;
  };
  const OPTS = { list: false, zoomY: true, minFit: true, sliders: true };
  const fitted = () => {
    const g = mountGantt(host, cb(), OPTS);
    g.setRows([A, B], SPAN, CAL);
    sized(400, 248);
    g.fit(); // 25 days in 398 px (15.92 px per day); 4 lines in 198 px (rows of 49)
    return g;
  };
  const FIT_W = `${(398 / 25) * 7}px`;

  it('con minFit el zoom no baja de ver todo, ni a lo ancho ni a lo alto', () => {
    fitted();
    const zoomOut = host.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
    const shorter = host.querySelector<HTMLButtonElement>('[aria-label="Shorter rows"]')!;
    expect([zoomOut.disabled, shorter.disabled]).toEqual([true, true]);
    host.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(); // el siguiente paso de la escala: 16
    expect(barOf('A').style.width).toBe('112px');
    zoomOut.click(); // the step below (8) is under the fit: it goes back to the fit
    expect(barOf('A').style.width).toBe(FIT_W);
    expect(zoomOut.disabled).toBe(true);
    host.querySelector<HTMLButtonElement>('[aria-label="Taller rows"]')!.click();
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('224px'); // 4 filas de 56
    shorter.click();
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('196px'); // de vuelta a 49
    expect(shorter.disabled).toBe(true);
  });

  it('the sliders go from the fit to the maximum and do not go below the fit', () => {
    fitted();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Horizontal zoom"]')!.value).toBe('0');
    slide('Horizontal zoom', 1000);
    expect(barOf('A').style.width).toBe('448px'); // 64 px per day × 7
    slide('Vertical zoom', 1000);
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('224px');
    slide('Horizontal zoom', 0);
    slide('Vertical zoom', 0);
    expect(barOf('A').style.width).toBe(FIT_W);
    expect(host.querySelector<HTMLElement>('.sch-bars')!.style.height).toBe('196px');
  });

  it('at the fit it keeps fitting; outside it, if the fit raises the zoom it is not left below', () => {
    const g = fitted();
    sized(800, 248); // wider window while at the fit: it refits
    g.setRows([A, B], SPAN, CAL);
    expect(barOf('A').style.width).toBe(`${(798 / 25) * 7}px`);
    slide('Horizontal zoom', 500); // se aleja del ajuste
    sized(1200, 248); // now the fit demands more zoom than the current one (47.9 px per day versus about 32)
    g.setRows([A, B], SPAN, CAL);
    expect(barOf('A').style.width).toBe(`${(1198 / 25) * 7}px`);
  });

  it('the bars the day line crosses are highlighted', () => {
    const g = mountGantt(host, cb());
    g.setRows([A, B], SPAN, CAL);
    g.setDay('2026-11-12');
    expect([barOf('A'), barOf('B')].map((b) => b.classList.contains('is-live'))).toEqual([false, true]);
    g.setDay('2026-11-10');
    expect([barOf('A'), barOf('B')].map((b) => b.classList.contains('is-live'))).toEqual([true, false]);
    g.setDay(null);
    expect(host.querySelectorAll('.sch-bar.is-live')).toHaveLength(0);
  });
});

describe('Gantt: clic en la escala', () => {
  it('a click on a day, a week or a month of the scale takes the red line there', () => {
    const c = { ...cb(), onDay: vi.fn() };
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL); // the scale starts 3 days before Thursday 5 Nov: Monday 2
    host.querySelector<HTMLElement>('.sch-day[data-day="2026-11-10"]')!.click();
    expect(c.onDay).toHaveBeenLastCalledWith('2026-11-10');
    host.querySelector<HTMLElement>('.sch-wk[data-day="2026-11-09"]')!.click(); // semana del lunes 9
    expect(c.onDay).toHaveBeenLastCalledWith('2026-11-09');
    host.querySelector<HTMLElement>('.sch-month[data-day="2026-11-02"]')!.click(); // noviembre, desde donde se ve
    expect(c.onDay).toHaveBeenLastCalledWith('2026-11-02');
    expect(host.querySelector('.sch-scale')!.classList.contains('is-clickable')).toBe(true);
  });

  it('the first day of a month that falls on a weekend leads to the first working day', () => {
    const c = { ...cb(), onDay: vi.fn() };
    const g = mountGantt(host, c);
    g.setRows([{ ...A, dates: { start: '2026-11-25', end: '2026-12-03' } }], { start: '2026-11-25', end: '2026-12-08' }, CAL);
    host.querySelector<HTMLElement>('.sch-month[data-day="2026-12-01"]')!.click(); // martes 1: laborable
    expect(c.onDay).toHaveBeenLastCalledWith('2026-12-01');
    host.querySelector<HTMLElement>('.sch-day[data-day="2026-11-28"]')!.click(); // Saturday clicked: as it is (the mode adjusts it)
    expect(c.onDay).toHaveBeenLastCalledWith('2026-11-28');
  });

  it('sin onDay la escala no reacciona; con toolbar: false no hay botones', () => {
    const c = cb();
    const g = mountGantt(host, c, { toolbar: false });
    g.setRows([A, B], SPAN, CAL);
    host.querySelector<HTMLElement>('.sch-day[data-day="2026-11-10"]')!.click();
    expect(host.querySelector<HTMLElement>('.sch-toolbar')!.hidden).toBe(true);
    expect(host.querySelector('.sch-scale')!.classList.contains('is-clickable')).toBe(false);
  });
});

describe('Gantt: desplazamiento al arrastrar hasta un borde', () => {
  /** jsdom does not lay out: the timeline measures 300 px from x = 0 and its scrollLeft is kept (up to 2000). */
  const layout = () => {
    const chart = host.querySelector<HTMLElement>('.sch-chart')!;
    chart.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300, top: 0, bottom: 200, height: 200, x: 0, y: 0, toJSON() {} }) as DOMRect;
    let left = 0;
    Object.defineProperty(chart, 'scrollLeft', { get: () => left, set: (v: number) => (left = Math.max(0, Math.min(2000, v))), configurable: true });
    return chart;
  };
  const frames = () => new Promise((r) => setTimeout(r, 120));

  it('taking the red line indicator past the right edge scrolls the timeline and the date keeps advancing', async () => {
    const c = { ...cb(), onDay: vi.fn() };
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL);
    g.setDay('2026-11-09');
    const chart = layout();
    pointer(host.querySelector('.sch-dayhandle')!, 'pointerdown', 120);
    pointer(window, 'pointermove', 340); // fuera, a la derecha
    await frames();
    expect(chart.scrollLeft).toBeGreaterThan(0);
    const days = c.onDay.mock.calls.map((x) => x[0] as string);
    expect(days.length).toBeGreaterThan(1);
    expect(days.at(-1)! > days[0]).toBe(true); // avanza con el desplazamiento
    pointer(window, 'pointerup', 340);
    const stopped = chart.scrollLeft;
    await frames();
    expect(chart.scrollLeft).toBe(stopped); // al soltar se para
  });

  it('inside the timeline, far from the edges, it does not scroll', async () => {
    const c = { ...cb(), onDay: vi.fn() };
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL);
    g.setDay('2026-11-09');
    const chart = layout();
    pointer(host.querySelector('.sch-dayhandle')!, 'pointerdown', 120);
    pointer(window, 'pointermove', 150);
    await frames();
    expect(chart.scrollLeft).toBe(0);
    pointer(window, 'pointerup', 150);
  });

  it('when moving a bar to the edge, the timeline scrolls and the scroll counts in the days moved', async () => {
    const c = cb();
    const g = mountGantt(host, c);
    g.setRows([A, B], SPAN, CAL);
    const chart = layout();
    pointer(barOf('A'), 'pointerdown', 100);
    pointer(window, 'pointermove', 340);
    await frames();
    const scrolled = chart.scrollLeft;
    expect(scrolled).toBeGreaterThan(0);
    pointer(window, 'pointerup', 340);
    // 240 px of the pointer plus what scrolled, at 16 px per day
    const moved = Math.round((240 + scrolled) / 16);
    const expected = new Date(Date.UTC(2026, 10, 5 + moved)).toISOString().slice(0, 10);
    const [id, start] = c.onMove.mock.calls[0];
    expect(id).toBe('A');
    expect(start >= expected).toBe(true); // el inicio nuevo (o el laborable siguiente)
  });
});
