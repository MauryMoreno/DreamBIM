// Intercambio con MS Project y Primavera P6: lee MS Project XML (MSPDI) y XER de P6, y escribe MSPDI
// (P6 also imports it). Pure: it receives and returns text.
import { parseDay } from './calendar';
import { schedule } from './plan';
import { DAY_RE, type Calendar, type Dep, type DepType, type ScheduleState, type Task } from './state';

export interface Imported {
  tasks: Task[];
  /** Calendar of the file, if it had a readable one. */
  calendar: Calendar | null;
  /** Warnings for the user (skipped tasks, lost links). */
  notes: string[];
}

const MSP_NS = 'http://schemas.microsoft.com/project';
/** Link types of MSPDI: 0 FF, 1 FS, 2 SF, 3 SS. */
const MSP_TYPES: DepType[] = ['FF', 'FS', 'SF', 'SS'];
const XER_TYPES: Record<string, DepType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

const day = (iso: string | undefined): string | null => {
  const d = iso?.slice(0, 10);
  return d && DAY_RE.test(d) && !Number.isNaN(parseDay(d)) ? d : null;
};

// --- MSPDI ---------------------------------------------------------------------------------------------

const kids = (el: Element | null | undefined, name: string): Element[] =>
  el ? [...el.children].filter((c) => c.localName === name) : [];
const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
const text = (el: Element | null | undefined, name: string): string | undefined => kid(el, name)?.textContent?.trim();
const num = (el: Element | null | undefined, name: string): number | undefined => {
  const t = text(el, name);
  const n = t === undefined || t === '' ? NaN : Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** 'PT40H30M0S' → horas. */
function isoHours(d: string | undefined): number {
  const m = d ? /^-?P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d) : null;
  if (!m) return 0;
  return Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const a = parseDay(from);
  const b = parseDay(to);
  for (let n = a; n <= b && out.length < 400; n++) out.push(new Date(n * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function mspCalendar(project: Element): Calendar | null {
  const uid = text(project, 'CalendarUID');
  const cals = kids(kid(project, 'Calendars'), 'Calendar');
  const cal = cals.find((c) => text(c, 'UID') === uid) ?? cals.find((c) => text(c, 'IsBaseCalendar') === '1');
  if (!cal) return null;
  const workdays: number[] = [];
  const holidays: string[] = [];
  const offPeriod = (holder: Element) => {
    const p = kid(holder, 'TimePeriod');
    const a = day(text(p, 'FromDate'));
    const b = day(text(p, 'ToDate'));
    if (a && b) holidays.push(...eachDay(a, b));
  };
  let typed = false;
  for (const w of kids(kid(cal, 'WeekDays'), 'WeekDay')) {
    const type = num(w, 'DayType');
    const working = text(w, 'DayWorking') === '1';
    if (type === 0) {
      if (!working) offPeriod(w);
    } else if (type !== undefined && type >= 1 && type <= 7) {
      typed = true;
      if (working) workdays.push(type - 1); // MSPDI: 1 = domingo
    }
  }
  for (const e of kids(kid(cal, 'Exceptions'), 'Exception')) if (text(e, 'DayWorking') !== '1') offPeriod(e);
  if (!typed) return null;
  return { workdays: [...new Set(workdays)].sort(), holidays: [...new Set(holidays)].sort() };
}

/** Lee un MS Project XML. Las tareas resumen dan las fases; la tarea 0 (el proyecto) se salta. */
export function parseMspdi(xml: string): Imported {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const project = doc.documentElement;
  if (!project || project.localName !== 'Project' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('This is not a Microsoft Project XML file');
  }
  const minutesPerDay = num(project, 'MinutesPerDay') || 480;
  const notes: string[] = [];
  const tasks: Task[] = [];
  const idOf = new Map<string, string>();
  const links: { task: Task; el: Element }[] = [];
  const summaries: string[] = []; // nombre de la tarea resumen por nivel de esquema
  for (const el of kids(kid(project, 'Tasks'), 'Task')) {
    const uid = text(el, 'UID') ?? '';
    if (uid === '0' || text(el, 'IsNull') === '1') continue;
    const name = text(el, 'Name') ?? '';
    const level = num(el, 'OutlineLevel') ?? 1;
    if (text(el, 'Summary') === '1') {
      summaries.length = Math.max(0, level - 1);
      summaries[level - 1] = name;
      continue;
    }
    summaries.length = Math.min(summaries.length, Math.max(0, level - 1));
    const start = day(text(el, 'Start'));
    if (!start) {
      notes.push(`Skipped ${name || 'a task'}: it has no start date`);
      continue;
    }
    const milestone = text(el, 'Milestone') === '1';
    const hours = isoHours(text(el, 'Duration'));
    const task: Task = {
      id: `tk-${tasks.length + 1}`,
      name: name || `Task ${tasks.length + 1}`,
      phase: summaries.filter(Boolean).at(-1) ?? '',
      start,
      duration: milestone ? 0 : Math.max(hours > 0 ? 1 : 0, Math.round((hours * 60) / minutesPerDay)),
      deps: [],
      rule: null,
      elements: [],
    };
    const pct = num(el, 'PercentComplete');
    if (pct) task.progress = Math.min(100, Math.round(pct));
    const base = kids(el, 'Baseline').find((b) => (num(b, 'Number') ?? 0) === 0);
    const bs = day(text(base, 'Start'));
    const bf = day(text(base, 'Finish'));
    if (bs && bf) task.baseline = { start: bs, end: bf };
    idOf.set(uid, task.id);
    tasks.push(task);
    links.push({ task, el });
  }
  let lost = 0;
  for (const { task, el } of links) {
    for (const l of kids(el, 'PredecessorLink')) {
      const pred = idOf.get(text(l, 'PredecessorUID') ?? '');
      if (!pred) {
        lost++;
        continue;
      }
      const fmt = num(l, 'LagFormat');
      const percent = fmt === 19 || fmt === 20;
      const lag = percent ? 0 : Math.round((num(l, 'LinkLag') ?? 0) / 10 / minutesPerDay);
      task.deps.push({ task: pred, type: MSP_TYPES[num(l, 'Type') ?? 1] ?? 'FS', lag });
    }
  }
  if (lost) notes.push(`${lost} links to summary tasks were dropped`);
  return { tasks, calendar: mspCalendar(project), notes };
}

// --- XER (Primavera P6) --------------------------------------------------------------------------------

type XerTables = Map<string, Record<string, string>[]>;

function readXer(text: string): XerTables {
  const tables: XerTables = new Map();
  let fields: string[] = [];
  let rows: Record<string, string>[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split('\t');
    if (cells[0] === '%T') {
      rows = [];
      tables.set(cells[1]?.trim() ?? '', rows);
    } else if (cells[0] === '%F') fields = cells.slice(1).map((f) => f.trim());
    else if (cells[0] === '%R' && rows) {
      const r: Record<string, string> = {};
      fields.forEach((f, i) => (r[f] = cells[i + 1] ?? ''));
      rows.push(r);
    }
  }
  return tables;
}

/** Reads a P6 XER. The phase is the name of the WBS of each activity; level-of-effort and WBS activities are skipped. */
export function parseXer(xer: string): Imported {
  if (!xer.startsWith('ERMHDR')) throw new Error('This is not a Primavera XER file');
  const t = readXer(xer);
  const wbs = new Map((t.get('PROJWBS') ?? []).map((w) => [w.wbs_id, w]));
  const hoursPerDay = new Map((t.get('CALENDAR') ?? []).map((c) => [c.clndr_id, Number(c.day_hr_cnt) || 8]));
  const notes: string[] = [];
  const tasks: Task[] = [];
  const idOf = new Map<string, string>();
  let skipped = 0;
  for (const a of t.get('TASK') ?? []) {
    if (a.task_type === 'TT_LOE' || a.task_type === 'TT_WBS') {
      skipped++;
      continue;
    }
    const start = day(a.early_start_date) ?? day(a.target_start_date) ?? day(a.act_start_date) ?? day(a.restart_date);
    const name = a.task_name || a.task_code || `Task ${tasks.length + 1}`;
    if (!start) {
      notes.push(`Skipped ${name}: it has no start date`);
      continue;
    }
    const hpd = hoursPerDay.get(a.clndr_id) ?? 8;
    const milestone = a.task_type === 'TT_Mile' || a.task_type === 'TT_FinMile';
    const hours = Number(a.target_drtn_hr_cnt) || 0;
    const w = wbs.get(a.wbs_id);
    const task: Task = {
      id: `tk-${tasks.length + 1}`,
      name,
      phase: w && w.proj_node_flag !== 'Y' ? w.wbs_name ?? '' : '',
      start,
      duration: milestone ? 0 : Math.max(hours > 0 ? 1 : 0, Math.round(hours / hpd)),
      deps: [],
      rule: null,
      elements: [],
    };
    const pct = a.status_code === 'TK_Complete' ? 100 : Number(a.phys_complete_pct) || 0;
    if (pct > 0) task.progress = Math.min(100, Math.round(pct));
    idOf.set(a.task_id, task.id);
    tasks.push(task);
  }
  const byId = new Map(tasks.map((x) => [x.id, x]));
  for (const p of t.get('TASKPRED') ?? []) {
    const succ = byId.get(idOf.get(p.task_id) ?? '');
    const pred = idOf.get(p.pred_task_id);
    if (!succ || !pred) continue;
    const hpd = 8;
    succ.deps.push({ task: pred, type: XER_TYPES[p.pred_type] ?? 'FS', lag: Math.round((Number(p.lag_hr_cnt) || 0) / hpd) });
  }
  if (skipped) notes.push(`Skipped ${skipped} level-of-effort and WBS summary activities`);
  if (!tasks.length) throw new Error('The file has no activities');
  return { tasks, calendar: null, notes };
}

/** By extension: '.xer' is P6; the rest is read as MS Project XML. */
export function parseScheduleFile(fileName: string, text: string): Imported {
  return /\.xer$/i.test(fileName) ? parseXer(text) : parseMspdi(text);
}

/**
 * Replaces the tasks with the imported ones. An imported one with the same name as one that was already
 * conserva su regla, sus elementos enlazados y su tipo: el cronograma viene de fuera y el enlace con el
 * model was made here.
 */
export function mergeImported(current: ScheduleState, imp: Imported): ScheduleState {
  const pool = new Map<string, Task[]>();
  for (const t of current.tasks) pool.set(t.name, [...(pool.get(t.name) ?? []), t]);
  const tasks = imp.tasks.map((t) => {
    const old = pool.get(t.name)?.shift();
    if (!old) return t;
    const kept: Task = { ...t, rule: old.rule, elements: old.elements };
    if (old.kind) kept.kind = old.kind;
    return kept;
  });
  return { calendar: imp.calendar ?? current.calendar, tasks };
}

// --- Exportar MSPDI ------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (name: string, value: string | number) => `<${name}>${typeof value === 'string' ? esc(value) : value}</${name}>`;
const hoursIso = (days: number) => `PT${days * 8}H0M0S`;
const MSP_TYPE: Record<DepType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

/** MS Project XML of the schedule: a summary task per phase and its tasks below; 8 h workday. */
export function toMspdi(state: ScheduleState, title: string): string {
  const { dates } = schedule(state);
  const cal = state.calendar;
  const all = [...dates.values()];
  const first = all.reduce((m, d) => (d.start < m ? d.start : m), all[0]?.start ?? '2026-01-01');
  const last = all.reduce((m, d) => (d.end > m ? d.end : m), all[0]?.end ?? first);

  const week: string[] = [];
  for (let type = 1; type <= 7; type++) {
    const on = cal.workdays.includes(type - 1);
    week.push(
      `<WeekDay>${tag('DayType', type)}${tag('DayWorking', on ? 1 : 0)}${
        on
          ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>' +
            '<WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>'
          : ''
      }</WeekDay>`,
    );
  }
  for (const h of cal.holidays) {
    week.push(`<WeekDay>${tag('DayType', 0)}${tag('DayWorking', 0)}<TimePeriod>${tag('FromDate', `${h}T00:00:00`)}${tag('ToDate', `${h}T23:59:00`)}</TimePeriod></WeekDay>`);
  }

  const uid = new Map<string, number>();
  const groups = new Map<string, Task[]>();
  for (const t of state.tasks) groups.set(t.phase || 'General', [...(groups.get(t.phase || 'General') ?? []), t]);
  let next = 1;
  for (const list of groups.values()) {
    next++; // la resumen de la fase
    for (const t of list) uid.set(t.id, next++);
  }

  const out: string[] = [];
  let n = 1;
  let phaseNo = 0;
  for (const [phase, list] of groups) {
    phaseNo++;
    const ds = list.map((t) => dates.get(t.id)!);
    const ps = ds.reduce((m, d) => (d.start < m ? d.start : m), ds[0].start);
    const pe = ds.reduce((m, d) => (d.end > m ? d.end : m), ds[0].end);
    out.push(
      `<Task>${tag('UID', n)}${tag('ID', n)}${tag('Name', phase)}${tag('Type', 1)}${tag('IsNull', 0)}${tag('OutlineNumber', String(phaseNo))}` +
        `${tag('OutlineLevel', 1)}${tag('Start', `${ps}T08:00:00`)}${tag('Finish', `${pe}T17:00:00`)}${tag('DurationFormat', 7)}` +
        `${tag('Milestone', 0)}${tag('Summary', 1)}</Task>`,
    );
    n++;
    list.forEach((t, i) => {
      const d = dates.get(t.id)!;
      const preds = t.deps
        .filter((dep: Dep) => uid.has(dep.task))
        .map((dep) => `<PredecessorLink>${tag('PredecessorUID', uid.get(dep.task)!)}${tag('Type', MSP_TYPE[dep.type])}${tag('CrossProject', 0)}${tag('LinkLag', dep.lag * 4800)}${tag('LagFormat', 7)}</PredecessorLink>`)
        .join('');
      const milestone = t.duration === 0;
      const baseline = t.baseline
        ? `<Baseline>${tag('Number', 0)}${tag('Start', `${t.baseline.start}T08:00:00`)}${tag('Finish', `${t.baseline.end}T${milestone ? '08' : '17'}:00:00`)}</Baseline>`
        : '';
      out.push(
        `<Task>${tag('UID', n)}${tag('ID', n)}${tag('Name', t.name)}${tag('Type', 1)}${tag('IsNull', 0)}${tag('OutlineNumber', `${phaseNo}.${i + 1}`)}` +
          `${tag('OutlineLevel', 2)}${tag('Start', `${d.start}T08:00:00`)}${tag('Finish', `${d.end}T${milestone ? '08' : '17'}:00:00`)}` +
          `${tag('Duration', hoursIso(t.duration))}${tag('DurationFormat', 7)}${tag('Milestone', milestone ? 1 : 0)}${tag('Summary', 0)}` +
          `${tag('PercentComplete', t.progress ?? 0)}${tag('ConstraintType', 4)}${tag('ConstraintDate', `${t.start}T08:00:00`)}${preds}${baseline}</Task>`,
      );
      n++;
    });
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<Project xmlns="${MSP_NS}">${tag('SaveVersion', 14)}${tag('Name', `${title}.xml`)}${tag('Title', title)}` +
    `${tag('ScheduleFromStart', 1)}${tag('StartDate', `${first}T08:00:00`)}${tag('FinishDate', `${last}T17:00:00`)}` +
    `${tag('CalendarUID', 1)}${tag('MinutesPerDay', 480)}${tag('MinutesPerWeek', 480 * cal.workdays.length)}${tag('DaysPerMonth', 20)}` +
    `<Calendars><Calendar>${tag('UID', 1)}${tag('Name', 'Standard')}${tag('IsBaseCalendar', 1)}<WeekDays>${week.join('')}</WeekDays></Calendar></Calendars>` +
    `<Tasks>${out.join('')}</Tasks></Project>\n`
  );
}
