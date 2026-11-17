// Schedule plan: effective dates with dependencies, elements of each task, 4D state of each
// element on a date and distribution of the cost over time. Pure.
import type { QuantityRow } from '../render/viewer';
import { matchRule } from '../materials/catalog';
import { addWorkdays, formatDay, nextWorkday, parseDay, weekStart, workdaysBetween } from './calendar';
import { fs, nextTaskId, type Calendar, type Dep, type ScheduleState, type Task, type TaskKind } from './state';

export interface TaskDates {
  start: string;
  end: string;
}

const maxDay = (a: string, b: string) => (a > b ? a : b);

/** Total slack (working days) and whether the task is on the critical path. */
export interface TaskFloat {
  float: number;
  critical: boolean;
}

export interface Schedule {
  dates: Map<string, TaskDates>;
  /** Ids of the cycle found (it is broken at the edge that closes it); null without cycles. */
  cycle: string[] | null;
  cpm: Map<string, TaskFloat>;
}

/**
 * Working days numbered from `base` (0 = the first working day from `base`). It grows on demand; with a
 * calendar without working days the days run consecutively and nothing hangs.
 */
class WorkIndex {
  private readonly days: string[];
  private readonly at = new Map<string, number>();
  constructor(base: string, private readonly cal: Calendar) {
    this.days = [nextWorkday(base, cal)];
    this.at.set(this.days[0], 0);
  }
  private grow(): void {
    const last = this.days[this.days.length - 1];
    let next = addWorkdays(last, 1, this.cal);
    if (next <= last) next = formatDay(parseDay(last) + 1);
    this.at.set(next, this.days.length);
    this.days.push(next);
  }
  day(i: number): string {
    const n = Math.max(0, i);
    while (this.days.length <= n) this.grow();
    return this.days[n];
  }
  /** Índice del laborable `d` (o del siguiente si no lo es); 0 si es anterior a la base. */
  index(d: string): number {
    const w = nextWorkday(d, this.cal);
    if (w <= this.days[0]) return 0;
    while (this.days[this.days.length - 1] < w) this.grow();
    return this.at.get(w) ?? this.days.findIndex((x) => x >= w);
  }
}

/**
 * Critical path method over working days. A task occupies [es, ef) with ef = es + duration (a
 * milestone, 0 days, has es = ef). Forward, `es` is the greater of its "not before" and what each
 * predecessor demands according to its type (FS: p.ef + lag; SS: p.es + lag; FF: p.ef + lag − dur; SF: p.es + lag
 * − dur). Backward from the end of the project comes the total slack; with slack ≤ 0 it is critical.
 */
export function schedule(state: ScheduleState): Schedule {
  const dates = new Map<string, TaskDates>();
  const cpm = new Map<string, TaskFloat>();
  if (!state.tasks.length) return { dates, cycle: null, cpm };
  const cal = state.calendar;
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  let base = state.tasks[0].start;
  for (const t of state.tasks) if (t.start < base) base = t.start;
  const wi = new WorkIndex(base, cal);

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const order: string[] = [];
  const broken = new Set<string>(); // aristas 'pred>succ' que cerraban un ciclo
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (t: Task): void => {
    if (es.has(t.id)) return;
    stack.push(t.id);
    let start = wi.index(t.start);
    for (const dep of t.deps) {
      const p = byId.get(dep.task);
      if (!p) continue;
      if (stack.includes(p.id)) {
        cycle ??= stack.slice(stack.indexOf(p.id));
        broken.add(`${p.id}>${t.id}`);
        continue;
      }
      visit(p);
      const pes = es.get(p.id)!;
      const pef = ef.get(p.id)!;
      const need =
        dep.type === 'FS' ? pef + dep.lag
        : dep.type === 'SS' ? pes + dep.lag
        : dep.type === 'FF' ? pef + dep.lag - t.duration
        : pes + dep.lag - t.duration;
      start = Math.max(start, need);
    }
    stack.pop();
    es.set(t.id, start);
    ef.set(t.id, start + t.duration);
    order.push(t.id);
  };
  for (const t of state.tasks) visit(t);

  for (const t of state.tasks) {
    const s = es.get(t.id)!;
    if (t.duration > 0) dates.set(t.id, { start: wi.day(s), end: wi.day(s + t.duration - 1) });
    else {
      // a milestone pushed by its predecessors falls on the day they finish (as in MS Project), not the next one
      const m = s > wi.index(t.start) ? wi.day(s - 1) : wi.day(s);
      dates.set(t.id, { start: m, end: m });
    }
  }

  // backward: successors of each task, in reverse topological order
  const succ = new Map<string, { task: Task; dep: Task['deps'][number] }[]>();
  for (const t of state.tasks) {
    for (const dep of t.deps) {
      if (!byId.has(dep.task) || broken.has(`${dep.task}>${t.id}`)) continue;
      succ.set(dep.task, [...(succ.get(dep.task) ?? []), { task: t, dep }]);
    }
  }
  const end = Math.max(...ef.values());
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const t = byId.get(id)!;
    let late = end;
    for (const { task: s, dep } of succ.get(id) ?? []) {
      const sls = ls.get(s.id)!;
      const slf = lf.get(s.id)!;
      const bound =
        dep.type === 'FS' ? sls - dep.lag
        : dep.type === 'SS' ? sls - dep.lag + t.duration
        : dep.type === 'FF' ? slf - dep.lag
        : slf - dep.lag + t.duration;
      late = Math.min(late, bound);
    }
    lf.set(id, late);
    ls.set(id, late - t.duration);
    const float = late - ef.get(id)!;
    cpm.set(id, { float, critical: float <= 0 });
  }
  return { dates, cycle, cpm };
}

/** Would giving these predecessors to the task close a cycle? */
export function wouldLoop(state: ScheduleState, taskId: string, deps: Dep[]): boolean {
  const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, deps } : t));
  return schedule({ ...state, tasks }).cycle !== null;
}

/** Elements (composed paths) of each task: those of its rule and the linked ones; `missing` = linked ones that are no longer there. */
export function taskElements(
  state: ScheduleState,
  rows: QuantityRow[],
  toComposed: (editPath: string) => string | null,
): Map<string, { elements: string[]; missing: number }> {
  const out = new Map<string, { elements: string[]; missing: number }>();
  for (const t of state.tasks) {
    const set = new Set(t.rule ? matchRule(rows, t.rule) : []);
    let missing = 0;
    for (const e of t.elements) {
      const p = toComposed(e);
      if (p) set.add(p);
      else missing++;
    }
    out.set(t.id, { elements: [...set], missing });
  }
  return out;
}

/**
 * - done: terminado (o existente antes de demolerse), con su material;
 * - active: under construction;
 * - future: does not appear yet;
 * - demolish: being demolished;
 * - temporary: obra temporal en pie;
 * - removed: ya demolido o retirado;
 * - none: fuera de toda tarea.
 */
export type ElementState = 'done' | 'active' | 'future' | 'demolish' | 'temporary' | 'removed' | 'none';

interface Span {
  start: string;
  end: string;
}
const within = (s: Span, day: string) => s.start <= day && day <= s.end;

function stateAt(spans: Record<TaskKind, Span[]>, day: string): ElementState {
  const { construct: c, demolish: d, temporary: t } = spans;
  if (d.some((s) => within(s, day))) return 'demolish';
  if (t.some((s) => within(s, day))) return 'temporary';
  if (c.some((s) => within(s, day))) return 'active';
  if (d.length && day > d.reduce((m, s) => maxDay(m, s.end), d[0].end)) return 'removed';
  if (c.length) return day < c.reduce((m, s) => (s.start < m ? s.start : m), c[0].start) ? 'future' : 'done';
  if (d.length) return 'done'; // existe hasta que lo demuelan
  return day < t.reduce((m, s) => (s.start < m ? s.start : m), t[0].start) ? 'future' : 'removed';
}

/**
 * State of each element on `day`. With several tasks: what is demolished rules, then the temporary and then
 * the construction; a built element appears with its first task and is finished with the last one.
 */
export function elementStates(
  dates: Map<string, TaskDates>,
  elements: Map<string, { elements: string[] }>,
  day: string,
  all: string[],
  kinds: Map<string, TaskKind> = new Map(),
): Map<string, ElementState> {
  const spans = new Map<string, Record<TaskKind, Span[]>>();
  for (const [id, { elements: list }] of elements) {
    const d = dates.get(id);
    if (!d) continue;
    const kind = kinds.get(id) ?? 'construct';
    for (const p of list) {
      let s = spans.get(p);
      if (!s) spans.set(p, (s = { construct: [], demolish: [], temporary: [] }));
      s[kind].push(d);
    }
  }
  const out = new Map<string, ElementState>();
  for (const p of all) {
    const s = spans.get(p);
    out.set(p, s ? stateAt(s, day) : 'none');
  }
  for (const [p, s] of spans) if (!out.has(p)) out.set(p, stateAt(s, day));
  return out;
}

/** From the first start to the last end; null without tasks. */
export function projectSpan(dates: Map<string, TaskDates>): TaskDates | null {
  let span = null as TaskDates | null;
  for (const d of dates.values()) {
    span = span ? { start: d.start < span.start ? d.start : span.start, end: maxDay(span.end, d.end) } : { ...d };
  }
  return span;
}

/** One task per level, in a finish-to-start chain, 5 days each, from `from`; ids after those that already exist. */
export function tasksByLevel(state: ScheduleState, storeys: string[], from: string): Task[] {
  const first = Number(nextTaskId(state).slice(3));
  return storeys.map((storey, i) => ({
    id: `tk-${first + i}`,
    name: storey,
    phase: 'Construction',
    start: from,
    duration: 5,
    deps: i ? [fs(`tk-${first + i - 1}`)] : [],
    rule: { storey },
    elements: [],
  }));
}

export interface CostCurve {
  days: { day: string; cost: number; cumulative: number }[];
  weeks: { week: string; cost: number }[];
  total: number;
}

/**
 * Costo en el tiempo: el importe de cada elemento se reparte a partes iguales entre sus tareas, y cada
 * task splits it in equal parts among its working days.
 */
export function costCurve(
  state: ScheduleState,
  dates: Map<string, TaskDates>,
  elements: Map<string, { elements: string[] }>,
  elementCost: (path: string) => number,
): CostCurve {
  const uses = new Map<string, number>();
  for (const { elements: list } of elements.values()) for (const p of list) uses.set(p, (uses.get(p) ?? 0) + 1);
  const perDay = new Map<string, number>();
  for (const t of state.tasks) {
    const d = dates.get(t.id);
    const list = elements.get(t.id)?.elements ?? [];
    if (!d || !list.length) continue;
    const cost = list.reduce((n, p) => n + elementCost(p) / (uses.get(p) ?? 1), 0);
    const days = workdaysBetween(d.start, d.end, state.calendar);
    for (const day of days) perDay.set(day, (perDay.get(day) ?? 0) + cost / days.length);
  }
  const span = projectSpan(dates);
  if (!span) return { days: [], weeks: [], total: 0 };
  let cumulative = 0;
  const days = workdaysBetween(span.start, span.end, state.calendar).map((day) => {
    const cost = perDay.get(day) ?? 0;
    cumulative += cost;
    return { day, cost, cumulative };
  });
  const weekly = new Map<string, number>();
  for (const d of days) weekly.set(weekStart(d.day), (weekly.get(weekStart(d.day)) ?? 0) + d.cost);
  return { days, weeks: [...weekly].map(([week, cost]) => ({ week, cost })), total: cumulative };
}
