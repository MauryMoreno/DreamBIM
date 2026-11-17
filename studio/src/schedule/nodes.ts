// The schedule as IFCx: a file with an IfcWorkSchedule node, its IfcWorkCalendar, a summary IfcTask
// per phase (the WBS, as IfcRelNests) and an IfcTask per task. The model imports it, like the
// classification tables. The attribute names follow IFC 4.3 (IfcTask, IfcTaskTime, IfcRelSequence,
// IfcRelAssignsToProcess) under `prj::ifc::`, because IFC5 alpha has no processes yet; what only
// Studio uses (the rule, the baseline, the "not before" constraint) goes in `prj::cronograma::`.
// The computed dates (effective start and end, slack, critical path) are also written, for whoever reads the
// archivo sin Studio; al leer se ignoran y se vuelven a calcular.
import type { IfcxFile, IfcxNode, IfcxSchema, IfcxValueDescription } from '../ifcx/types';
import type { MaterialRule } from '../materials/catalog';
import { workdaysBetween } from './calendar';
import { schedule as computeSchedule } from './plan';
import {
  DAY_RE, DEFAULT_CALENDAR, DEP_TYPES, type Calendar, type Dep, type DepType, type ScheduleState, type Task, type TaskKind,
} from './state';

export const K_CLASS = 'bsi::ifc::class';
export const K_NAME = 'bsi::ifc::prop::Name';
/** Marks the root of the schedule: this is how Studio finds it in the composition. */
export const K_WORK_SCHEDULE = 'prj::ifc::WorkSchedule';
export const K_WORK_CALENDAR = 'prj::ifc::WorkCalendar';
export const K_TASK = 'prj::ifc::Task';
export const K_TASK_TIME = 'prj::ifc::TaskTime';
/** Predecesoras de la tarea (IfcRelSequence en que la tarea es RelatedProcess). */
export const K_SEQUENCE = 'prj::ifc::Sequence';
/** Elements linked by hand (IfcRelAssignsToProcess.RelatedObjects), by edit path. */
export const K_PRODUCTS = 'prj::ifc::AssignedProducts';
export const K_RULE = 'prj::cronograma::regla';
export const K_BASELINE = 'prj::cronograma::lineaBase';
export const K_NOT_BEFORE = 'prj::cronograma::noAntesDe';

const IFC_CORE = 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx';
const IFC_PROP = 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx';
const ifcClass = (code: string) => ({ code, uri: `https://identifier.buildingsmart.org/uri/buildingsmart/ifc/4.3/class/${code}` });

const SEQUENCE_TYPE: Record<DepType, string> = { FS: 'FINISH_START', SS: 'START_START', FF: 'FINISH_FINISH', SF: 'START_FINISH' };
const DEP_OF = Object.fromEntries(Object.entries(SEQUENCE_TYPE).map(([k, v]) => [v, k])) as Record<string, DepType>;

// --- Esquemas ------------------------------------------------------------------------------------------

const str: IfcxValueDescription = { dataType: 'String' };
const opt = (v: IfcxValueDescription): IfcxValueDescription => ({ ...v, optional: true });
const obj = (values: Record<string, IfcxValueDescription>): IfcxValueDescription => ({ dataType: 'Object', objectRestrictions: { values } });
const arr = (value: IfcxValueDescription): IfcxValueDescription => ({ dataType: 'Array', arrayRestrictions: { value } });
const int: IfcxValueDescription = { dataType: 'Integer' };
const real: IfcxValueDescription = { dataType: 'Real' };
const bool: IfcxValueDescription = { dataType: 'Boolean' };

export const SCHEDULE_SCHEMAS: Record<string, IfcxSchema> = {
  [K_WORK_SCHEDULE]: { value: obj({ PredefinedType: str, StartTime: opt(str), FinishTime: opt(str) }) },
  [K_WORK_CALENDAR]: { value: obj({ WorkingDays: arr(int), Holidays: arr(str) }) },
  [K_TASK]: { value: obj({ Identification: opt(str), PredefinedType: str, ObjectType: opt(str), IsMilestone: bool }) },
  [K_TASK_TIME]: {
    value: obj({
      ScheduleStart: str, ScheduleFinish: str, ScheduleDuration: str,
      Completion: opt(real), TotalFloat: opt(str), IsCritical: opt(bool),
    }),
  },
  [K_SEQUENCE]: { value: arr(obj({ RelatingProcess: { dataType: 'Reference' }, SequenceType: str, TimeLag: str })) },
  [K_PRODUCTS]: { value: arr({ dataType: 'Reference' }) },
  [K_RULE]: { value: obj({ cls: opt(str), storey: opt(str), material: opt(str) }) },
  [K_BASELINE]: { value: obj({ inicio: str, fin: str }) },
  [K_NOT_BEFORE]: { value: str },
};

// --- ISO 8601 durations in working days -----------------------------------------------------------

/** 5 → 'P5D', −2 → '-P2D'. */
export const isoDays = (n: number): string => `${n < 0 ? '-' : ''}P${Math.abs(n)}D`;

/** 'P5D', '-P2D', 'PT40H' (8 h per day) → days; null if not understood. */
export function daysOfIso(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(-)?P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?)?$/.exec(v);
  if (!m || v === 'P' || v === '-P') return null;
  const days = Number(m[2] ?? 0) * 5 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 8 + Number(m[5] ?? 0) / 480;
  return Math.round(m[1] ? -days : days);
}

// --- Escribir -----------------------------------------------------------------------------------------

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fase';

/** Ruta de datos de la tarea dentro del cronograma `root`. */
export const taskPath = (root: string, id: string) => `${root}-${id}`;

const KIND_TYPE: Record<TaskKind, { PredefinedType: string; ObjectType?: string }> = {
  construct: { PredefinedType: 'CONSTRUCTION' },
  demolish: { PredefinedType: 'DEMOLITION' },
  temporary: { PredefinedType: 'USERDEFINED', ObjectType: 'TEMPORARY' },
};

export interface ScheduleFileOptions {
  /** Data path of the IfcWorkSchedule root (stable between saves). */
  root: string;
  /** Name of the model, for the title of the schedule. */
  title: string;
  /** El archivo de antes: se conserva su cabecera. */
  previous?: IfcxFile | null;
}

/** El archivo IFCx del cronograma. */
export function scheduleToFile(state: ScheduleState, o: ScheduleFileOptions): IfcxFile {
  const { dates, cpm } = computeSchedule(state);
  const root = o.root;
  const span = [...dates.values()];
  const first = span.reduce<string | undefined>((m, d) => (!m || d.start < m ? d.start : m), undefined);
  const last = span.reduce<string | undefined>((m, d) => (!m || d.end > m ? d.end : m), undefined);

  const calendarPath = `${root}-calendario`;
  const rootNode: IfcxNode = {
    path: root,
    children: { Calendario: calendarPath },
    attributes: {
      [K_CLASS]: ifcClass('IfcWorkSchedule'),
      [K_NAME]: `${o.title} — Cronograma`,
      [K_WORK_SCHEDULE]: { PredefinedType: 'PLANNED', ...(first ? { StartTime: first } : {}), ...(last ? { FinishTime: last } : {}) },
    },
  };
  const calendar: IfcxNode = {
    path: calendarPath,
    attributes: {
      [K_CLASS]: ifcClass('IfcWorkCalendar'),
      [K_NAME]: 'Calendario laboral',
      // IFC (IfcRecurrencePattern.WeekdayComponent): 1 = lunes … 7 = domingo
      [K_WORK_CALENDAR]: { WorkingDays: state.calendar.workdays.map((d) => (d === 0 ? 7 : d)).sort(), Holidays: [...state.calendar.holidays] },
    },
  };

  const phases = new Map<string, IfcxNode>();
  const usedSlugs = new Set<string>();
  const phaseNode = (name: string): IfcxNode => {
    let p = phases.get(name);
    if (p) return p;
    let s = slug(name);
    for (let i = 2; usedSlugs.has(s); i++) s = `${slug(name)}-${i}`;
    usedSlugs.add(s);
    p = { path: `${root}-fase-${s}`, children: {}, attributes: { [K_CLASS]: ifcClass('IfcTask'), [K_NAME]: name, [K_TASK]: { PredefinedType: 'NOTDEFINED', IsMilestone: false } } };
    phases.set(name, p);
    rootNode.children![s] = p.path;
    return p;
  };

  const taskNodes: IfcxNode[] = [];
  for (const t of state.tasks) {
    const d = dates.get(t.id)!;
    const f = cpm.get(t.id);
    const attributes: Record<string, unknown> = {
      [K_CLASS]: ifcClass('IfcTask'),
      [K_NAME]: t.name,
      [K_TASK]: { Identification: t.id, ...KIND_TYPE[t.kind ?? 'construct'], IsMilestone: t.duration === 0 },
      [K_TASK_TIME]: {
        ScheduleStart: d.start,
        ScheduleFinish: d.end,
        ScheduleDuration: isoDays(t.duration),
        ...(t.progress ? { Completion: t.progress / 100 } : {}),
        ...(f ? { TotalFloat: isoDays(f.float), IsCritical: f.critical } : {}),
      },
      [K_NOT_BEFORE]: t.start,
    };
    if (t.deps.length) {
      attributes[K_SEQUENCE] = t.deps.map((dep) => ({ RelatingProcess: taskPath(root, dep.task), SequenceType: SEQUENCE_TYPE[dep.type], TimeLag: isoDays(dep.lag) }));
    }
    if (t.elements.length) attributes[K_PRODUCTS] = [...t.elements];
    if (t.rule) attributes[K_RULE] = { ...t.rule };
    if (t.baseline) attributes[K_BASELINE] = { inicio: t.baseline.start, fin: t.baseline.end };
    const node: IfcxNode = { path: taskPath(root, t.id), attributes };
    taskNodes.push(node);
    if (t.phase) phaseNode(t.phase).children![t.id] = node.path;
    else rootNode.children![t.id] = node.path;
  }
  // el resumen de cada fase lleva el tramo de sus tareas
  for (const [name, p] of phases) {
    const ds = state.tasks.filter((t) => t.phase === name).map((t) => dates.get(t.id)!);
    const s = ds.reduce((m, d) => (d.start < m ? d.start : m), ds[0].start);
    const e = ds.reduce((m, d) => (d.end > m ? d.end : m), ds[0].end);
    p.attributes![K_TASK_TIME] = { ScheduleStart: s, ScheduleFinish: e, ScheduleDuration: isoDays(workdaysBetween(s, e, state.calendar).length) };
  }

  const prev = o.previous?.header;
  return {
    header: {
      id: prev?.id ?? `${o.title}.cronograma`,
      ifcxVersion: 'ifcx_alpha',
      dataVersion: '1.0.0',
      author: prev?.author ?? 'Dream BIM',
      timestamp: new Date().toISOString(),
    },
    imports: [{ uri: IFC_CORE }, { uri: IFC_PROP }],
    schemas: { ...SCHEDULE_SCHEMAS },
    data: [rootNode, calendar, ...phases.values(), ...taskNodes],
  };
}

// --- Leer ---------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const code = (n: IfcxNode) => (isObject(n.attributes?.[K_CLASS]) ? (n.attributes![K_CLASS] as { code?: unknown }).code : undefined);
const day = (v: unknown): string | null => (typeof v === 'string' && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** The IfcWorkSchedule root of the file (the first one), or null if it is not a schedule. */
export function scheduleRoot(file: IfcxFile): string | null {
  return file.data.find((n) => n.attributes?.[K_WORK_SCHEDULE] !== undefined)?.path ?? null;
}

/**
 * Reads the schedule of an IFCx file. It also accepts those of other tools: without `noAntesDe` the task
 * empieza en su ScheduleStart, y sin Identification su id sale del orden.
 */
export function scheduleFromFile(file: IfcxFile): { state: ScheduleState; root: string } | null {
  const root = scheduleRoot(file);
  if (!root) return null;
  // the last node with the same path wins, as when composing
  const byPath = new Map<string, IfcxNode>();
  for (const n of file.data) {
    const prev = byPath.get(n.path);
    byPath.set(n.path, prev ? { ...prev, ...n, attributes: { ...prev.attributes, ...n.attributes }, children: { ...prev.children, ...n.children } } : n);
  }
  const parentOf = new Map<string, string>();
  for (const n of byPath.values()) for (const c of Object.values(n.children ?? {})) if (c) parentOf.set(c, n.path);

  let calendar: Calendar = DEFAULT_CALENDAR;
  const leaves: IfcxNode[] = [];
  const seen = new Set<string>();
  for (const n of file.data) {
    if (seen.has(n.path)) continue;
    seen.add(n.path);
    const node = byPath.get(n.path)!;
    const cal = node.attributes?.[K_WORK_CALENDAR];
    if (isObject(cal)) {
      const days = Array.isArray(cal.WorkingDays) ? cal.WorkingDays.filter((x): x is number => Number.isInteger(x) && x >= 1 && x <= 7) : [];
      const holidays = Array.isArray(cal.Holidays) ? cal.Holidays.map(day).filter((x): x is string => x !== null) : [];
      calendar = { workdays: [...new Set(days.map((x) => (x === 7 ? 0 : x)))].sort(), holidays };
      continue;
    }
    if (code(node) === 'IfcTask' && node.attributes?.[K_TASK_TIME] !== undefined && !Object.keys(node.children ?? {}).length) leaves.push(node);
  }

  const idOf = new Map<string, string>();
  const used = new Set<string>();
  leaves.forEach((n, i) => {
    const want = (n.attributes?.[K_TASK] as { Identification?: unknown } | undefined)?.Identification;
    let id = typeof want === 'string' && /^tk-\d+$/.test(want) && !used.has(want) ? want : '';
    for (let k = i + 1; !id; k++) if (!used.has(`tk-${k}`)) id = `tk-${k}`;
    used.add(id);
    idOf.set(n.path, id);
  });

  const tasks: Task[] = [];
  for (const n of leaves) {
    const a = n.attributes ?? {};
    const time = isObject(a[K_TASK_TIME]) ? a[K_TASK_TIME] : {};
    const info = isObject(a[K_TASK]) ? a[K_TASK] : {};
    const start = day(a[K_NOT_BEFORE]) ?? day(time.ScheduleStart);
    if (!start) continue;
    const dur = daysOfIso(time.ScheduleDuration);
    const parent = byPath.get(parentOf.get(n.path) ?? '');
    const task: Task = {
      id: idOf.get(n.path)!,
      name: typeof a[K_NAME] === 'string' ? (a[K_NAME] as string) : idOf.get(n.path)!,
      phase: parent && parent.path !== root && typeof parent.attributes?.[K_NAME] === 'string' ? (parent.attributes[K_NAME] as string) : '',
      start,
      duration: info.IsMilestone === true ? 0 : Math.max(0, dur ?? 1),
      deps: [],
      rule: null,
      elements: [],
    };
    const seq = a[K_SEQUENCE];
    if (Array.isArray(seq)) {
      for (const s of seq) {
        if (!isObject(s)) continue;
        const pred = idOf.get(String(s.RelatingProcess));
        if (!pred || pred === task.id) continue;
        const type = DEP_OF[String(s.SequenceType)] ?? 'FS';
        const dep: Dep = { task: pred, type: DEP_TYPES.includes(type) ? type : 'FS', lag: daysOfIso(s.TimeLag) ?? 0 };
        task.deps.push(dep);
      }
    }
    if (Array.isArray(a[K_PRODUCTS])) task.elements = (a[K_PRODUCTS] as unknown[]).filter((x): x is string => typeof x === 'string');
    if (isObject(a[K_RULE])) {
      const r = a[K_RULE];
      const rule: MaterialRule = {};
      if (typeof r.cls === 'string') rule.cls = r.cls;
      if (typeof r.storey === 'string') rule.storey = r.storey;
      if (typeof r.material === 'string') rule.material = r.material;
      task.rule = rule;
    }
    if (info.PredefinedType === 'DEMOLITION') task.kind = 'demolish';
    else if (info.PredefinedType === 'USERDEFINED' && info.ObjectType === 'TEMPORARY') task.kind = 'temporary';
    if (typeof time.Completion === 'number' && time.Completion > 0) task.progress = Math.min(100, Math.round(time.Completion * 100));
    const b = a[K_BASELINE];
    if (isObject(b) && day(b.inicio) && day(b.fin)) task.baseline = { start: day(b.inicio)!, end: day(b.fin)! };
    tasks.push(task);
  }
  return { state: { calendar, tasks }, root };
}
