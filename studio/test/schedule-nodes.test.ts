import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IfcxFile } from '../src/ifcx/types';
import { schemaWarnings } from '../src/model/validate';
import {
  daysOfIso, isoDays, K_NAME, K_PRODUCTS, K_SEQUENCE, K_TASK, K_TASK_TIME, K_WORK_CALENDAR, scheduleFromFile, scheduleRoot, scheduleToFile, taskPath,
} from '../src/schedule/nodes';
import { fs, type ScheduleState, type Task } from '../src/schedule/state';

const HERE = dirname(fileURLToPath(import.meta.url));
const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: id, phase: '', start: '2026-11-02', duration: 5, deps: [], rule: null, elements: [], ...over,
});
const STATE: ScheduleState = {
  calendar: { workdays: [0, 1, 2, 3, 4, 5], holidays: ['2026-12-25'] },
  tasks: [
    T('tk-1', { name: 'Pilotes', phase: 'Cimentación', elements: ['p-1', 'p-2'], progress: 40, baseline: { start: '2026-11-02', end: '2026-11-06' } }),
    T('tk-2', { name: 'Columnas N1', phase: 'Estructura', duration: 3, deps: [{ task: 'tk-1', type: 'SS', lag: 2 }], rule: { storey: 'Level 1', cls: 'IfcColumn' } }),
    T('tk-3', { name: 'Andamio', phase: 'Estructura', kind: 'temporary', deps: [fs('tk-2')] }),
    T('tk-4', { name: 'Demoler caseta', kind: 'demolish', duration: 1 }),
    T('tk-5', { name: 'Estructura terminada', duration: 0, deps: [fs('tk-3')], start: '2026-11-09' }),
  ],
};
const file = () => scheduleToFile(STATE, { root: 'ws-1', title: 'S-0001' });
const node = (f: IfcxFile, path: string) => f.data.find((n) => n.path === path)!;

describe('cronograma como IFCx', () => {
  it('ida y vuelta conserva calendario y tareas', () => {
    expect(scheduleFromFile(file())).toEqual({ state: STATE, root: 'ws-1' });
  });

  it('it is IfcWorkSchedule with its IfcWorkCalendar, a summary IfcTask per phase and an IfcTask per task', () => {
    const f = file();
    const cls = (p: string) => (node(f, p).attributes!['bsi::ifc::class'] as { code: string }).code;
    expect(scheduleRoot(f)).toBe('ws-1');
    expect(cls('ws-1')).toBe('IfcWorkSchedule');
    expect(node(f, 'ws-1').children).toEqual({
      Calendario: 'ws-1-calendario', Cimentacion: 'ws-1-fase-Cimentacion', Estructura: 'ws-1-fase-Estructura', 'tk-4': 'ws-1-tk-4', 'tk-5': 'ws-1-tk-5',
    });
    expect(cls('ws-1-calendario')).toBe('IfcWorkCalendar');
    expect(node(f, 'ws-1-calendario').attributes![K_WORK_CALENDAR]).toEqual({ WorkingDays: [1, 2, 3, 4, 5, 7], Holidays: ['2026-12-25'] });
    expect(node(f, 'ws-1-fase-Estructura').children).toEqual({ 'tk-2': 'ws-1-tk-2', 'tk-3': 'ws-1-tk-3' });
    expect(node(f, 'ws-1-fase-Estructura').attributes![K_NAME]).toBe('Estructura');
    expect(cls(taskPath('ws-1', 'tk-1'))).toBe('IfcTask');
  });

  it('escribe tiempos, secuencia, productos y tipo con los nombres de IFC 4.3', () => {
    const f = file();
    const a1 = node(f, 'ws-1-tk-1').attributes!;
    expect(a1[K_TASK]).toEqual({ Identification: 'tk-1', PredefinedType: 'CONSTRUCTION', IsMilestone: false });
    expect(a1[K_TASK_TIME]).toMatchObject({ ScheduleStart: '2026-11-02', ScheduleFinish: '2026-11-06', ScheduleDuration: 'P5D', Completion: 0.4 });
    expect(a1[K_PRODUCTS]).toEqual(['p-1', 'p-2']);
    expect(node(f, 'ws-1-tk-2').attributes![K_SEQUENCE]).toEqual([{ RelatingProcess: 'ws-1-tk-1', SequenceType: 'START_START', TimeLag: 'P2D' }]);
    expect(node(f, 'ws-1-tk-3').attributes![K_TASK]).toMatchObject({ PredefinedType: 'USERDEFINED', ObjectType: 'TEMPORARY' });
    expect(node(f, 'ws-1-tk-4').attributes![K_TASK]).toMatchObject({ PredefinedType: 'DEMOLITION' });
    expect(node(f, 'ws-1-tk-5').attributes![K_TASK]).toMatchObject({ IsMilestone: true });
    expect(node(f, 'ws-1-tk-1').attributes![K_TASK_TIME]).toMatchObject({ IsCritical: expect.any(Boolean), TotalFloat: expect.stringMatching(/^-?P\d+D$/) });
  });

  it('it meets its schemas and the standard ones it imports', () => {
    const std = ['ifc@v5a', 'prop@v5a'].map((n) => JSON.parse(readFileSync(resolve(HERE, `../src/model/schemas/${n}.ifcx`), 'utf8')) as IfcxFile);
    expect(schemaWarnings([...std, file()])).toEqual([]);
  });

  it('lee un IfcWorkSchedule de otra herramienta: sin noAntesDe ni Identification, con duraciones en horas', () => {
    const f: IfcxFile = {
      header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
      imports: [],
      schemas: {},
      data: [
        { path: 'root', children: { a: 'A', b: 'B' }, attributes: { 'prj::ifc::WorkSchedule': { PredefinedType: 'PLANNED' } } },
        { path: 'A', attributes: { 'bsi::ifc::class': { code: 'IfcTask' }, [K_NAME]: 'Excavar', [K_TASK_TIME]: { ScheduleStart: '2026-11-02T08:00:00', ScheduleDuration: 'PT24H' } } },
        {
          path: 'B',
          attributes: {
            'bsi::ifc::class': { code: 'IfcTask' }, [K_NAME]: 'Hormigonar', [K_TASK_TIME]: { ScheduleStart: '2026-11-05', ScheduleDuration: 'P1W' },
            [K_SEQUENCE]: [{ RelatingProcess: 'A', SequenceType: 'FINISH_FINISH', TimeLag: '-P1D' }],
          },
        },
      ],
    };
    const r = scheduleFromFile(f)!;
    expect(r.state.tasks.map((t) => [t.id, t.name, t.start, t.duration, t.deps])).toEqual([
      ['tk-1', 'Excavar', '2026-11-02', 3, []],
      ['tk-2', 'Hormigonar', '2026-11-05', 5, [{ task: 'tk-1', type: 'FF', lag: -1 }]],
    ]);
    expect(scheduleFromFile({ ...f, data: f.data.slice(1) })).toBeNull();
  });

  it('duraciones ISO', () => {
    expect([isoDays(5), isoDays(-2), isoDays(0)]).toEqual(['P5D', '-P2D', 'P0D']);
    expect([daysOfIso('P5D'), daysOfIso('-P2D'), daysOfIso('PT40H'), daysOfIso('P1W2D'), daysOfIso('x'), daysOfIso('P')]).toEqual([5, -2, 5, 7, null, null]);
  });
});
