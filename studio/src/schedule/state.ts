// Cronograma de un documento: calendario laboral y tareas ligadas a elementos. Se guarda en
// `<modelo>.schedule.ifcx`; las fechas efectivas se calculan (ver plan.ts), no se guardan.
import type { IfcxFile, IfcxNode } from '../ifcx/types';
import type { MaterialRule } from '../materials/catalog';
import type { SidecarKind } from '../modeling/sidecars';

export interface Calendar {
  /** Working days: 0 = Sunday … 6 = Saturday. */
  workdays: number[];
  /** Festivos 'YYYY-MM-DD'. */
  holidays: string[];
}

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export const DEP_TYPES: readonly DepType[] = ['FS', 'SS', 'FF', 'SF'];

/** Predecessor: link type and lag in working days (negative = lead). */
export interface Dep {
  task: string;
  type: DepType;
  lag: number;
}

/** As in Bexel: what is built, what is demolished and the temporary (scaffolding, formwork). */
export type TaskKind = 'construct' | 'demolish' | 'temporary';
export const TASK_KINDS: readonly TaskKind[] = ['construct', 'demolish', 'temporary'];

export interface Task {
  /** 'tk-<n>', estable. */
  id: string;
  name: string;
  /** '' = sin fase (grupo «General»). */
  phase: string;
  /** 'YYYY-MM-DD': «no antes de»; las dependencias pueden retrasarla. */
  start: string;
  /** Working days, integer ≥ 0 (0 = milestone). */
  duration: number;
  /** Predecessors (the schedules of phase 4 stored only ids: they are read as FS+0). */
  deps: Dep[];
  /** null = solo los elementos enlazados a mano. */
  rule: MaterialRule | null;
  /** Edit paths (editPath) linked with Link Selection. */
  elements: string[];
  /** Ausente = construct. */
  kind?: TaskKind;
  /** % de avance, 0–100; ausente = 0. */
  progress?: number;
  /** Fechas guardadas con Set Baseline. */
  baseline?: { start: string; end: string };
}

/** FS+0 hacia `task`: la dependencia de siempre. */
export const fs = (task: string): Dep => ({ task, type: 'FS', lag: 0 });

export interface ScheduleState {
  readonly calendar: Calendar;
  readonly tasks: readonly Task[];
}

export const DEFAULT_CALENDAR: Calendar = { workdays: [1, 2, 3, 4, 5], holidays: [] };
export const EMPTY_SCHEDULE: ScheduleState = { calendar: DEFAULT_CALENDAR, tasks: [] };

export const K_TASK = 'studio::schedule::task';
export const K_SCHEDULE_SETTINGS = 'studio::schedule::settings';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function asRule(v: unknown): MaterialRule | null {
  if (!isObject(v)) return null;
  const rule: MaterialRule = {};
  if (typeof v.cls === 'string') rule.cls = v.cls;
  if (typeof v.storey === 'string') rule.storey = v.storey;
  if (typeof v.material === 'string') rule.material = v.material;
  return rule;
}

function asDep(v: unknown): Dep | null {
  if (typeof v === 'string') return fs(v);
  if (!isObject(v) || typeof v.task !== 'string') return null;
  const type = DEP_TYPES.includes(v.type as DepType) ? (v.type as DepType) : 'FS';
  const lag = typeof v.lag === 'number' && Number.isFinite(v.lag) ? Math.round(v.lag) : 0;
  return { task: v.task, type, lag };
}

function asTask(v: unknown): Task | null {
  if (!isObject(v) || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.start !== 'string' || !DAY_RE.test(v.start)) {
    return null;
  }
  const d = typeof v.duration === 'number' && Number.isInteger(v.duration) && v.duration >= 0 ? v.duration : 1;
  const task: Task = {
    id: v.id,
    name: v.name,
    phase: typeof v.phase === 'string' ? v.phase : '',
    start: v.start,
    duration: d,
    deps: Array.isArray(v.deps) ? v.deps.map(asDep).filter((x): x is Dep => x !== null) : [],
    rule: asRule(v.rule),
    elements: strings(v.elements),
  };
  if (TASK_KINDS.includes(v.kind as TaskKind) && v.kind !== 'construct') task.kind = v.kind as TaskKind;
  if (typeof v.progress === 'number' && v.progress > 0) task.progress = Math.min(100, Math.round(v.progress));
  const b = v.baseline;
  if (isObject(b) && typeof b.start === 'string' && typeof b.end === 'string' && DAY_RE.test(b.start) && DAY_RE.test(b.end)) {
    task.baseline = { start: b.start, end: b.end };
  }
  return task;
}

function asCalendar(v: unknown): Calendar {
  if (!isObject(v)) return DEFAULT_CALENDAR;
  const workdays = Array.isArray(v.workdays)
    ? [...new Set(v.workdays.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
    : DEFAULT_CALENDAR.workdays;
  return { workdays, holidays: strings(v.holidays).filter((h) => DAY_RE.test(h)) };
}

export function nextTaskId(state: ScheduleState): string {
  let max = 0;
  for (const t of state.tasks) {
    const n = /^tk-(\d+)$/.exec(t.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `tk-${max + 1}`;
}

const sameCalendar = (a: Calendar, b: Calendar) => JSON.stringify(a) === JSON.stringify(b);

function toFile(state: ScheduleState, docName: string): IfcxFile {
  const data: IfcxNode[] = [
    { path: 'studio-schedule', attributes: { [K_SCHEDULE_SETTINGS]: { calendar: state.calendar } } },
    ...state.tasks.map((t) => ({ path: `studio-task-${t.id}`, attributes: { [K_TASK]: { ...t } } })),
  ];
  return {
    header: { id: `studio-schedule/${docName}`, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
    imports: [],
    schemas: {
      [K_SCHEDULE_SETTINGS]: { value: { dataType: 'Object' } },
      [K_TASK]: { value: { dataType: 'Object' } },
    },
    data,
  };
}

function fromFile(file: IfcxFile): ScheduleState {
  let calendar = DEFAULT_CALENDAR;
  const tasks: Task[] = [];
  for (const n of file.data ?? []) {
    const settings = n.attributes?.[K_SCHEDULE_SETTINGS];
    if (isObject(settings)) {
      calendar = asCalendar(settings.calendar);
      continue;
    }
    const t = asTask(n.attributes?.[K_TASK]);
    if (t) tasks.push(t);
  }
  const ids = new Set(tasks.map((t) => t.id));
  return { calendar, tasks: tasks.map((t) => ({ ...t, deps: t.deps.filter((d) => ids.has(d.task) && d.task !== t.id) })) };
}

export const SCHEDULE_KIND: SidecarKind<ScheduleState> = {
  suffix: '.schedule.ifcx',
  empty: EMPTY_SCHEDULE,
  isEmpty: (s) => s.tasks.length === 0 && sameCalendar(s.calendar, DEFAULT_CALENDAR),
  toFile,
  fromFile,
};
