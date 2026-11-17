import { describe, expect, it } from 'vitest';
import { EMPTY_SCHEDULE, fs, K_TASK, nextTaskId, SCHEDULE_KIND, type ScheduleState, type Task } from '../src/schedule/state';

const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: `Task ${id}`, phase: 'Structure', start: '2026-11-05', duration: 5, deps: [], rule: { storey: 'Level 1' }, elements: [], ...over,
});
const STATE: ScheduleState = {
  calendar: { workdays: [1, 2, 3, 4, 5, 6], holidays: ['2026-12-25'] },
  tasks: [T('tk-1'), T('tk-2', { deps: [fs('tk-1'), { task: 'tk-3', type: 'SS', lag: -2 }], kind: 'demolish', progress: 40, baseline: { start: '2026-11-05', end: '2026-11-11' } }), T('tk-3', { rule: null, elements: ['w1', 'w2'], phase: '' })],
};

describe('archivo del cronograma', () => {
  it('ida y vuelta conserva calendario y tareas', () => {
    expect(SCHEDULE_KIND.fromFile(SCHEDULE_KIND.toFile(STATE, 'casa'))).toEqual(STATE);
  });

  it('empty without tasks and with the default calendar; changing the calendar no longer is', () => {
    expect(SCHEDULE_KIND.isEmpty(EMPTY_SCHEDULE)).toBe(true);
    expect(SCHEDULE_KIND.isEmpty({ ...EMPTY_SCHEDULE, calendar: { workdays: [1, 2, 3, 4, 5, 6], holidays: [] } })).toBe(false);
  });

  it('it ignores invalid dates, fixes the duration and removes dependencies on tasks that do not exist', () => {
    const f = SCHEDULE_KIND.toFile({ ...STATE, tasks: [T('tk-1', { deps: [fs('tk-9'), fs('tk-1')] })] }, 'casa');
    f.data.push({ path: 'x', attributes: { [K_TASK]: { ...T('tk-2'), start: '3/11/2026' } } });
    f.data.push({ path: 'y', attributes: { [K_TASK]: { ...T('tk-4'), duration: 2.5 } } });
    const s = SCHEDULE_KIND.fromFile(f);
    expect(s.tasks.map((t) => t.id)).toEqual(['tk-1', 'tk-4']);
    expect(s.tasks[0].deps).toEqual([]);
    expect(s.tasks[1].duration).toBe(1);
  });

  it('it reads the dependencies of phase 4 (ids only) as FS+0 and the 0-day milestones', () => {
    const f = SCHEDULE_KIND.toFile({ ...STATE, tasks: [T('tk-1'), T('tk-3')] }, 'casa');
    f.data.push({ path: 'z', attributes: { [K_TASK]: { ...T('tk-2'), deps: ['tk-1', { task: 'tk-3', type: 'XX', lag: 1.6 }], duration: 0 } } });
    const t = SCHEDULE_KIND.fromFile(f).tasks.find((x) => x.id === 'tk-2')!;
    expect(t.deps).toEqual([fs('tk-1'), { task: 'tk-3', type: 'FS', lag: 2 }]);
    expect(t.duration).toBe(0);
  });

  it('construct, progress 0 and no baseline are not written', () => {
    const f = SCHEDULE_KIND.toFile({ ...STATE, tasks: [T('tk-1', { kind: 'construct', progress: 0 })] }, 'casa');
    const t = SCHEDULE_KIND.fromFile(f).tasks[0];
    expect(t.kind).toBeUndefined();
    expect(t.progress).toBeUndefined();
    expect(t.baseline).toBeUndefined();
  });

  it('nextTaskId sigue al mayor', () => {
    expect(nextTaskId({ ...EMPTY_SCHEDULE, tasks: [T('tk-2')] })).toBe('tk-3');
    expect(nextTaskId(EMPTY_SCHEDULE)).toBe('tk-1');
  });

  it('el archivo se llama <modelo>.schedule.ifcx', () => {
    expect(SCHEDULE_KIND.suffix).toBe('.schedule.ifcx');
  });
});
