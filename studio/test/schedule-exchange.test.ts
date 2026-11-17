import { describe, expect, it } from 'vitest';
import { mergeImported, parseMspdi, parseScheduleFile, parseXer, toMspdi } from '../src/schedule/exchange';
import { schedule } from '../src/schedule/plan';
import { fs, type ScheduleState, type Task } from '../src/schedule/state';

const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: id, phase: '', start: '2026-11-02', duration: 5, deps: [], rule: null, elements: [], ...over,
});

const STATE: ScheduleState = {
  calendar: { workdays: [1, 2, 3, 4, 5], holidays: ['2026-11-11'] },
  tasks: [
    T('tk-1', { name: 'Excavation', phase: 'Site', progress: 50, baseline: { start: '2026-11-02', end: '2026-11-06' } }),
    T('tk-2', { name: 'Footings', phase: 'Structure', duration: 3, deps: [{ task: 'tk-1', type: 'SS', lag: 2 }] }),
    T('tk-3', { name: 'Slab done', phase: 'Structure', duration: 0, deps: [fs('tk-2')] }),
  ],
};

describe('MS Project XML', () => {
  it('round trip keeps names, phases, durations, links, progress, baseline and calendar', () => {
    const back = parseMspdi(toMspdi(STATE, 'Casa'));
    expect(back.calendar).toEqual(STATE.calendar);
    expect(back.notes).toEqual([]);
    expect(back.tasks.map((t) => [t.name, t.phase, t.duration])).toEqual([
      ['Excavation', 'Site', 5],
      ['Footings', 'Structure', 3],
      ['Slab done', 'Structure', 0],
    ]);
    const [a, b, c] = back.tasks;
    expect(a.progress).toBe(50);
    expect(a.baseline).toEqual({ start: '2026-11-02', end: '2026-11-06' });
    expect(b.deps).toEqual([{ task: a.id, type: 'SS', lag: 2 }]);
    expect(c.deps).toEqual([fs(b.id)]);
    // y las fechas calculadas coinciden
    const before = [...schedule(STATE).dates.values()];
    const after = [...schedule({ calendar: back.calendar!, tasks: back.tasks }).dates.values()];
    expect(after).toEqual(before);
  });

  it('it escapes the names and rejects what is not a project', () => {
    const xml = toMspdi({ ...STATE, tasks: [T('tk-1', { name: 'Walls <A & B>' })] }, 'x');
    expect(parseMspdi(xml).tasks[0].name).toBe('Walls <A & B>');
    expect(() => parseMspdi('<Nope/>')).toThrow('This is not a Microsoft Project XML file');
  });

  it('it reads a Project file: it skips task 0, converts hours to days and LinkLag (tenths of a minute) to days', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><MinutesPerDay>480</MinutesPerDay>
      <Tasks>
        <Task><UID>0</UID><Name>Project</Name><Summary>1</Summary><OutlineLevel>0</OutlineLevel></Task>
        <Task><UID>1</UID><Name>Shell</Name><Summary>1</Summary><OutlineLevel>1</OutlineLevel></Task>
        <Task><UID>2</UID><Name>Walls</Name><OutlineLevel>2</OutlineLevel><Start>2026-11-02T08:00:00</Start><Duration>PT24H0M0S</Duration></Task>
        <Task><UID>3</UID><Name>Roof</Name><OutlineLevel>2</OutlineLevel><Start>2026-11-05T08:00:00</Start><Duration>PT16H0M0S</Duration>
          <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag></PredecessorLink>
          <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
        <Task><UID>4</UID><Name>Paint</Name><OutlineLevel>1</OutlineLevel><Start>2026-11-10T08:00:00</Start><Duration>PT8H0M0S</Duration></Task>
      </Tasks></Project>`;
    const r = parseMspdi(xml);
    expect(r.tasks.map((t) => [t.name, t.phase, t.duration])).toEqual([['Walls', 'Shell', 3], ['Roof', 'Shell', 2], ['Paint', '', 1]]);
    expect(r.tasks[1].deps).toEqual([{ task: r.tasks[0].id, type: 'FS', lag: 2 }]);
    expect(r.notes).toEqual(['1 links to summary tasks were dropped']);
    expect(r.calendar).toBeNull();
  });
});

describe('Primavera XER', () => {
  const xer = [
    'ERMHDR\t19.12\t2026-11-05',
    '%T\tCALENDAR', '%F\tclndr_id\tday_hr_cnt', '%R\t1\t10',
    '%T\tPROJWBS', '%F\twbs_id\tparent_wbs_id\twbs_name\tproj_node_flag', '%R\t10\t\tHouse\tY', '%R\t11\t10\tFoundations\tN',
    '%T\tTASK',
    '%F\ttask_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tearly_start_date\ttarget_start_date\tphys_complete_pct\tstatus_code',
    '%R\t100\t11\t1\tA1000\tExcavate\tTT_Task\t50\t2026-11-02 08:00\t\t30\tTK_Active',
    '%R\t101\t11\t1\tA1010\tPour\tTT_Task\t20\t\t2026-11-09 08:00\t0\tTK_NotStart',
    '%R\t102\t10\t1\tM1\tDone\tTT_FinMile\t0\t2026-11-12 08:00\t\t0\tTK_NotStart',
    '%R\t103\t10\t1\tL1\tSupervision\tTT_LOE\t200\t2026-11-02 08:00\t\t0\tTK_NotStart',
    '%T\tTASKPRED', '%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt', '%R\t101\t100\tPR_SS\t16', '%R\t102\t101\tPR_FS\t0',
    '%E',
  ].join('\r\n');

  it('it reads activities, WBS as phase, hours to days with the calendar, milestones, progress and links', () => {
    const r = parseXer(xer);
    expect(r.tasks.map((t) => [t.name, t.phase, t.start, t.duration, t.progress])).toEqual([
      ['Excavate', 'Foundations', '2026-11-02', 5, 30],
      ['Pour', 'Foundations', '2026-11-09', 2, undefined],
      ['Done', '', '2026-11-12', 0, undefined],
    ]);
    expect(r.tasks[1].deps).toEqual([{ task: r.tasks[0].id, type: 'SS', lag: 2 }]);
    expect(r.tasks[2].deps).toEqual([fs(r.tasks[1].id)]);
    expect(r.notes).toEqual(['Skipped 1 level-of-effort and WBS summary activities']);
  });

  it('it chooses the reader by extension and rejects what is not XER', () => {
    expect(parseScheduleFile('plan.XER', xer).tasks).toHaveLength(3);
    expect(() => parseXer('hello')).toThrow('This is not a Primavera XER file');
  });
});

describe('merge on import', () => {
  it('tasks with the same name keep rule, elements and type; the others are replaced', () => {
    const current: ScheduleState = {
      calendar: STATE.calendar,
      tasks: [
        T('tk-1', { name: 'Footings', rule: { storey: 'Level 0' }, elements: ['w1'], kind: 'demolish' }),
        T('tk-2', { name: 'Gone' }),
      ],
    };
    const imp = { tasks: [T('tk-1', { name: 'Excavation' }), T('tk-2', { name: 'Footings', duration: 9 })], calendar: null, notes: [] };
    const m = mergeImported(current, imp);
    expect(m.calendar).toBe(STATE.calendar);
    expect(m.tasks.map((t) => t.name)).toEqual(['Excavation', 'Footings']);
    expect(m.tasks[1]).toMatchObject({ duration: 9, rule: { storey: 'Level 0' }, elements: ['w1'], kind: 'demolish' });
  });
});
