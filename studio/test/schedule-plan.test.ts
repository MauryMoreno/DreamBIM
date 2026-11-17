import { describe, expect, it } from 'vitest';
import type { QuantityRow } from '../src/render/viewer';
import {
  costCurve, elementStates, projectSpan, schedule, taskElements, tasksByLevel, wouldLoop,
} from '../src/schedule/plan';
import { EMPTY_SCHEDULE, fs, type ScheduleState, type Task } from '../src/schedule/state';

const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: id, phase: '', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [], ...over,
});
const S = (...tasks: Task[]): ScheduleState => ({ ...EMPTY_SCHEDULE, tasks });
const row = (element: string, storey = 'Level 1', cls = 'IfcWall'): QuantityRow => ({
  element, name: element, cls, storey, material: '', materialCode: null, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 1,
});

describe('fechas efectivas', () => {
  it('B after A (5 days from Thursday 5) starts on Thursday 12 and lasts 3 days', () => {
    const { dates, cycle } = schedule(S(T('A'), T('B', { duration: 3, deps: [fs('A')] })));
    expect(cycle).toBeNull();
    expect(dates.get('A')).toEqual({ start: '2026-11-05', end: '2026-11-11' });
    expect(dates.get('B')).toEqual({ start: '2026-11-12', end: '2026-11-16' });
  });

  it('if A is extended by a day, B shifts on its own', () => {
    const { dates } = schedule(S(T('A', { duration: 6 }), T('B', { duration: 3, deps: [fs('A')] })));
    expect(dates.get('B')!.start).toBe('2026-11-13');
  });

  it('un start de B posterior a lo que exige A manda; uno en fin de semana pasa al lunes', () => {
    expect(schedule(S(T('A'), T('B', { deps: [fs('A')], start: '2026-11-20' }))).dates.get('B')!.start).toBe('2026-11-20');
    expect(schedule(S(T('A', { start: '2026-11-07' }))).dates.get('A')!.start).toBe('2026-11-09');
  });

  it('un ciclo se detecta sin colgarse y wouldLoop lo anticipa', () => {
    const r = schedule(S(T('A', { deps: [fs('B')] }), T('B', { deps: [fs('A')] })));
    expect(r.cycle?.sort()).toEqual(['A', 'B']);
    expect(r.dates.size).toBe(2);
    expect(wouldLoop(S(T('A'), T('B', { deps: [fs('A')] })), 'A', [fs('B')])).toBe(true);
    expect(wouldLoop(S(T('A'), T('B')), 'B', [fs('A')])).toBe(false);
  });

  it('projectSpan goes from the first start to the last end', () => {
    const { dates } = schedule(S(T('A'), T('B', { duration: 3, deps: [fs('A')] })));
    expect(projectSpan(dates)).toEqual({ start: '2026-11-05', end: '2026-11-16' });
    expect(projectSpan(new Map())).toBeNull();
  });
});

describe('elementos de cada tarea', () => {
  const rows = [row('/w1'), row('/w2', 'Level 2')];
  const toComposed = (e: string) => ({ w1: '/w1', w2: '/w2' } as Record<string, string>)[e] ?? null;

  it('it joins the rule and the linked ones without repeats and counts the linked ones that are missing', () => {
    const els = taskElements(S(T('A', { rule: { storey: 'Level 1' }, elements: ['w1', 'w2', 'gone1', 'gone2'] })), rows, toComposed);
    expect(els.get('A')!.elements.sort()).toEqual(['/w1', '/w2']);
    expect(els.get('A')!.missing).toBe(2);
  });

  it('sin regla usa solo los enlazados', () => {
    expect(taskElements(S(T('A', { elements: ['w2'] })), rows, toComposed).get('A')!.elements).toEqual(['/w2']);
  });
});

describe('estado 4D', () => {
  const state = S(T('A'), T('B', { duration: 3, deps: [fs('A')] }));
  const { dates } = schedule(state);
  const els = new Map([['A', { elements: ['/x', '/a'] }], ['B', { elements: ['/x'] }]]);
  const at = (day: string) => elementStates(dates, els, day, ['/x', '/a', '/out']);

  it('un elemento en A y en B: aparece con A y termina con B', () => {
    expect(at('2026-11-04').get('/x')).toBe('future');
    expect(at('2026-11-05').get('/x')).toBe('active');
    expect(at('2026-11-13').get('/x')).toBe('active');
    expect(at('2026-11-17').get('/x')).toBe('done');
  });

  it('lo de A termina antes y lo de fuera es none', () => {
    expect(at('2026-11-13').get('/a')).toBe('done');
    expect(at('2026-11-13').get('/out')).toBe('none');
  });
});

describe('tareas por nivel', () => {
  it('one per level, chained, with ids after those that exist', () => {
    const made = tasksByLevel(S(T('tk-4')), ['Level 0', 'Level 1'], '2026-11-02');
    expect(made.map((t) => [t.id, t.name, t.deps, t.rule])).toEqual([
      ['tk-5', 'Level 0', [], { storey: 'Level 0' }],
      ['tk-6', 'Level 1', [fs('tk-5')], { storey: 'Level 1' }],
    ]);
    expect(made[0]).toMatchObject({ phase: 'Construction', start: '2026-11-02', duration: 5 });
  });
});

describe('curva de costo', () => {
  it('an element of 100 in a 5-day task: 20 per day and cumulative 100', () => {
    const state = S(T('A'));
    const { dates } = schedule(state);
    const c = costCurve(state, dates, new Map([['A', { elements: ['/w'] }]]), () => 100);
    expect(c.days.map((d) => d.cost)).toEqual([20, 20, 20, 20, 20]);
    expect(c.days.at(-1)!.cumulative).toBeCloseTo(100, 6);
    expect(c.total).toBeCloseTo(100, 6);
    expect(c.weeks).toEqual([
      { week: '2026-11-02', cost: 40 },
      { week: '2026-11-09', cost: 60 },
    ]);
  });

  it('un elemento en dos tareas reparte su importe a partes iguales', () => {
    const state = S(T('A', { duration: 1 }), T('B', { duration: 1, deps: [fs('A')] }));
    const { dates } = schedule(state);
    const c = costCurve(state, dates, new Map([['A', { elements: ['/w'] }], ['B', { elements: ['/w'] }]]), () => 100);
    expect(c.days.map((d) => d.cost)).toEqual([50, 50]);
    expect(c.total).toBe(100);
  });

  it('sin tareas no hay curva', () => {
    expect(costCurve(EMPTY_SCHEDULE, new Map(), new Map(), () => 1)).toEqual({ days: [], weeks: [], total: 0 });
  });
});

describe('critical path and link types', () => {
  // semana del lunes 2 de noviembre de 2026
  const D = (over: Partial<Task> = {}) => ({ start: '2026-11-02', ...over });

  it('SS+2: B starts two days after the start of A', () => {
    const { dates } = schedule(S(T('A', D()), T('B', D({ duration: 2, deps: [{ task: 'A', type: 'SS', lag: 2 }] }))));
    expect(dates.get('B')).toEqual({ start: '2026-11-04', end: '2026-11-05' });
  });

  it('FF: B (2 days) ends with A', () => {
    const { dates } = schedule(S(T('A', D()), T('B', D({ duration: 2, deps: [{ task: 'A', type: 'FF', lag: 0 }] }))));
    expect(dates.get('B')).toEqual({ start: '2026-11-05', end: '2026-11-06' });
  });

  it('SF: B (2 days) ends the day before A starts', () => {
    const { dates } = schedule(S(T('A', D({ start: '2026-11-09' })), T('B', D({ duration: 2, deps: [{ task: 'A', type: 'SF', lag: 0 }] }))));
    expect(dates.get('B')).toEqual({ start: '2026-11-05', end: '2026-11-06' });
  });

  it('FS con desfase salta el fin de semana y un adelanto lo solapa', () => {
    const r = schedule(S(T('A', D()), T('B', D({ duration: 1, deps: [{ task: 'A', type: 'FS', lag: 1 }] }))));
    expect(r.dates.get('B')!.start).toBe('2026-11-10');
    const lead = schedule(S(T('A', D()), T('B', D({ duration: 1, deps: [{ task: 'A', type: 'FS', lag: -2 }] }))));
    expect(lead.dates.get('B')!.start).toBe('2026-11-05');
  });

  it('a 0-day milestone falls on the day its predecessor ends and occupies no days', () => {
    const { dates } = schedule(S(T('A', D()), T('M', D({ duration: 0, deps: [fs('A')] })), T('B', D({ duration: 1, deps: [fs('M')] }))));
    expect(dates.get('M')).toEqual({ start: '2026-11-06', end: '2026-11-06' });
    expect(dates.get('B')!.start).toBe('2026-11-09');
  });

  it('the long chain is critical and the short parallel one has slack', () => {
    // A(5) → C(2); B(3) → C. B has 2 days of slack.
    const { cpm } = schedule(S(T('A', D()), T('B', D({ duration: 3 })), T('C', D({ duration: 2, deps: [fs('A'), fs('B')] }))));
    expect(cpm.get('A')).toEqual({ float: 0, critical: true });
    expect(cpm.get('C')).toEqual({ float: 0, critical: true });
    expect(cpm.get('B')).toEqual({ float: 2, critical: false });
  });

  it('a lone task shorter than the project has the difference as slack', () => {
    const { cpm } = schedule(S(T('A', D()), T('B', D({ duration: 1 }))));
    expect(cpm.get('B')!.float).toBe(4);
  });

  it('con un ciclo sigue dando holguras sin colgarse', () => {
    const { cpm } = schedule(S(T('A', { deps: [fs('B')] }), T('B', { deps: [fs('A')] })));
    expect(cpm.size).toBe(2);
  });
});

describe('estado 4D por tipo de tarea', () => {
  const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
  // construye 2–6, demuele 9–13; temporal 16–20
  const state = S(
    T('C', { start: day(2) }),
    T('X', { start: day(9), kind: 'demolish' }),
    T('Y', { start: day(16), kind: 'temporary' }),
  );
  const { dates } = schedule(state);
  const kinds = new Map(state.tasks.map((t) => [t.id, t.kind ?? 'construct'] as const));
  const at = (els: [string, string[]][], d: number, p: string) =>
    elementStates(dates, new Map(els.map(([id, e]) => [id, { elements: e }])), day(d), [p], kinds).get(p);

  it('what is only demolished is standing, is seen under demolition and then disappears', () => {
    expect(at([['X', ['/e']]], 3, '/e')).toBe('done');
    expect(at([['X', ['/e']]], 10, '/e')).toBe('demolish');
    expect(at([['X', ['/e']]], 16, '/e')).toBe('removed');
  });

  it('what is built and then demolished: future, in progress, finished, demolition, removed', () => {
    const els: [string, string[]][] = [['C', ['/e']], ['X', ['/e']]];
    expect(at(els, 1, '/e')).toBe('future');
    expect(at(els, 4, '/e')).toBe('active');
    expect(at(els, 7, '/e')).toBe('done');
    expect(at(els, 11, '/e')).toBe('demolish');
    expect(at(els, 14, '/e')).toBe('removed');
  });

  it('lo temporal aparece con su tarea y se retira al acabar', () => {
    expect(at([['Y', ['/s']]], 13, '/s')).toBe('future');
    expect(at([['Y', ['/s']]], 18, '/s')).toBe('temporary');
    expect(at([['Y', ['/s']]], 23, '/s')).toBe('removed');
  });
});
