import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuantityRow } from '../src/render/viewer';
import { editPath } from '../src/composer/edits';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, ProvenanceSource } from '../src/ifcx/types';
import { K_COST_SYSTEM } from '../src/costs/system';
import { NO_MATERIAL } from '../src/materials/catalog';
import { loadModel, type LoadedModel } from '../src/model/load';
import { offlineFetcher } from '../src/model/schemas';
import { ACTIVE, DEMOLISH, GHOST, GHOST_OPACITY, PICKED, TEMPORARY } from '../src/schedule/colors';
import { createScheduleMode, type ScheduleActions } from '../src/schedule/mode';
import { EMPTY_SCHEDULE, fs, type ScheduleState, type Task } from '../src/schedule/state';

const HERE = dirname(fileURLToPath(import.meta.url));
let model: LoadedModel;
let p1: string;
let p2: string;
let p3: string;
beforeAll(async () => {
  const path = resolve(HERE, 'fixtures/hello-wall.ifcx');
  model = await loadModel('hello-wall', path, readFileSync(path, 'utf8'), offlineFetcher);
  [p1, p2, p3] = [...model.result.byPath.keys()].filter(Boolean);
});

const row = (element: string, storey: string, z = 0): QuantityRow => ({
  element, name: element, cls: 'IfcWall', storey, material: '', materialCode: null, box: [0, 0, z, 4, 0.2, z + 3], volume: 1, area: 1,
});
const T = (id: string, over: Partial<Task> = {}): Task => ({
  id, name: `Task ${id}`, phase: '', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [], ...over,
});
/** A (Level 0, 5 days from Thursday 5) → B (Level 1, 3 days). */
const AB = (): ScheduleState => ({
  ...EMPTY_SCHEDULE,
  tasks: [T('tk-1', { rule: { storey: 'Level 0' } }), T('tk-2', { duration: 3, deps: [fs('tk-1')], rule: { storey: 'Level 1' } })],
});

function setup(initial: ScheduleState = AB(), editable = true, extra: { model?: LoadedModel; rows?: QuantityRow[] } = {}) {
  let state = initial;
  const actions = {
    state: vi.fn(() => state),
    change: vi.fn(async (_label: string, change: (s: ScheduleState) => ScheduleState | string) => {
      const next = change(state);
      if (typeof next === 'string') return false;
      state = next;
      return true;
    }),
    materials: vi.fn(() => []),
    confirm: vi.fn(async () => true),
    importFile: vi.fn(async (): Promise<{ name: string; text: string } | null> => null),
    exportFile: vi.fn(async (name: string, _text: string): Promise<string | null> => name),
  } satisfies ScheduleActions;
  const rows = extra.rows ?? [row(p1, 'Level 0'), row(p2, 'Level 1', 3), row(p3, 'No storey')];
  const viewer = { quantities: vi.fn(() => rows), setColorOverride: vi.fn(), selectMany: vi.fn() };
  const setHidden = vi.fn();
  let tick: (() => void) | null = null;
  const cancel = vi.fn(() => (tick = null));
  const timer = { every: vi.fn((_ms: number, fn: () => void) => ((tick = fn), cancel)) };
  let selected: string | null = null;
  const toast = vi.fn();
  let many: string[] = [];
  const setPicking = vi.fn();
  const mode = createScheduleMode({
    actions, viewer, model: () => extra.model ?? model, selected: () => selected, selection: () => many, wallLength: () => null, setHidden, setPicking, timer, toast, editable,
  });
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  host.append(mode.panel(0)!, mode.panel(1)!, mode.panel(2)!, mode.dateBar);
  return {
    mode, actions, viewer, setHidden, setPicking, timer, cancel, toast, host,
    get state() { return state; },
    tick: () => tick?.(),
    select: (p: string | null) => ((many = p ? [p] : []), (selected = p)),
    /** Varios elementos seleccionados a la vez en el modelo. */
    selectMany: (ps: string[]) => ((many = ps), (selected = ps.at(-1) ?? null)),
    setDay: (i: number) => {
      const range = host.querySelector<HTMLInputElement>('.sch-range')!;
      range.value = String(i);
      range.dispatchEvent(new Event('input'));
    },
  };
}
const lastOverride = (v: { setColorOverride: ReturnType<typeof vi.fn> }) => v.setColorOverride.mock.calls.at(-1)![0];
const lastHidden = (h: ReturnType<typeof vi.fn>) => [...(h.mock.calls.at(-1)![0] as Set<string>)];
const barLeft = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`.sch-bar[data-id="${id}"]`)!.style.left;

beforeEach(() => vi.clearAllMocks());

describe('modo Schedule: 4D', () => {
  it('a mitad de A: lo de A en naranja, lo de B oculto y lo de fuera en gris', () => {
    const t = setup();
    t.mode.enter();
    expect(t.mode.day).toBe('2026-11-05'); // arranca en el inicio del proyecto
    t.setDay(2); // lunes 9
    const fn = lastOverride(t.viewer);
    expect(fn(p1)).toEqual({ color: ACTIVE, opacity: 1 });
    expect(fn(p3)).toEqual(NO_MATERIAL);
    expect(lastHidden(t.setHidden)).toEqual([p2]);
  });

  it('con Future → Ghost lo pendiente sale en fantasma y nada queda oculto', () => {
    const t = setup();
    t.mode.enter();
    t.mode.setFuture('ghost');
    expect(lastOverride(t.viewer)(p2)).toEqual({ color: GHOST, opacity: 0.12 });
    expect(lastHidden(t.setHidden)).toEqual([]);
  });

  it('terminada A, lo suyo vuelve a su material', () => {
    const t = setup();
    t.mode.enter();
    t.setDay(5); // jueves 12: B en curso
    expect(lastOverride(t.viewer)(p1)).toBeNull();
    expect(lastOverride(t.viewer)(p2)).toEqual({ color: ACTIVE, opacity: 1 });
  });

  it('stretching A shifts the bar of B by a day', async () => {
    const t = setup();
    t.mode.enter();
    const before = barLeft(t.host, 'tk-2');
    const handle = t.host.querySelector<HTMLElement>('.sch-bar[data-id="tk-1"] .sch-handle')!;
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 116 }));
    await Promise.resolve();
    expect(t.actions.change.mock.calls[0][0]).toBe('Resize Task');
    expect(t.state.tasks[0].duration).toBe(6);
    t.mode.refresh(); // en la app lo hace el controlador al recomponer
    expect(parseInt(barLeft(t.host, 'tk-2'))).toBe(parseInt(before) + 16);
  });
});

describe('modo Schedule: Play', () => {
  it('it advances one working day per tick, stops at the end and cancels the timer', () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLButtonElement>('.sch-play')!.click();
    expect(t.timer.every).toHaveBeenCalledWith(200, expect.any(Function));
    t.tick();
    t.tick();
    t.tick();
    expect(t.mode.day).toBe('2026-11-10');
    for (let i = 0; i < 10; i++) t.tick();
    expect(t.mode.day).toBe('2026-11-16'); // fin de B
    expect(t.cancel).toHaveBeenCalled();
    expect(t.host.querySelector('.sch-play')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('leaving the mode stops Play, removes the color and what is hidden, and on returning it keeps the date', () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLButtonElement>('.sch-play')!.click();
    t.tick();
    t.mode.leave();
    expect(t.cancel).toHaveBeenCalled();
    expect(lastOverride(t.viewer)).toBeNull();
    expect(lastHidden(t.setHidden)).toEqual([]);
    expect(t.host.querySelector<HTMLElement>('.sch-datebar')!.hidden).toBe(true);
    t.mode.enter();
    expect(t.mode.day).toBe('2026-11-06');
  });
});

describe('modo Schedule: tareas', () => {
  it('Link Selection without a task warns; with a task and an element it links its edit path; repeating warns', async () => {
    const t = setup();
    t.mode.enter();
    t.select(p3);
    t.mode.linkSelection();
    expect(t.toast).toHaveBeenCalledWith('Select a task and an element first', 'info');
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    t.mode.linkSelection();
    await Promise.resolve();
    const key = editPath(model.result.byPath.get(p3)!, model.result);
    expect(t.actions.change.mock.calls[0][0]).toBe('Link Selection');
    expect(t.state.tasks[0].elements).toEqual([key]);
    t.mode.linkSelection();
    expect(t.toast).toHaveBeenCalledWith('Already in this task', 'info');
  });

  it('el panel Task lista los elementos de la tarea y un clic en uno lo resalta en el modelo', () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click(); // regla de Level 0: un elemento
    const panel = t.host.querySelector('.sch-task .sch-elements')!;
    expect(panel.querySelector('.sch-elements-title')!.textContent).toBe('Elements (1)');
    const items = panel.querySelectorAll<HTMLButtonElement>('.sch-element-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain(model.result.byPath.get(p1)!.name);
    items[0].click();
    expect(t.viewer.selectMany).toHaveBeenLastCalledWith([p1]);
  });

  it('choosing an element in the model changes the Task panel: what it is, its state on the date and which tasks it is part of', () => {
    const t = setup(); // tk-1 (Level 0) from Thursday 5 to Wednesday 11; tk-2 (Level 1) after
    t.mode.enter();
    t.setDay(1); // viernes 6: tk-1 en obra
    t.select(p1);
    t.mode.selectionChanged(p1);
    const panel = t.host.querySelector('.sch-task .sch-info')!;
    expect(panel.querySelector('.sch-element-title')!.textContent).toBe(p1); // el nombre de la fila de cantidades
    expect(panel.querySelector('.sch-element-cls')!.textContent).toBe('IfcWall');
    expect(panel.textContent).toContain('Level 0');
    expect(panel.textContent).toContain('Under construction on Nov 6, 2026');
    expect(panel.querySelector('.sch-elements-title')!.textContent).toBe('Tasks (1)');
    const task = panel.querySelector<HTMLButtonElement>('.sch-element-task')!;
    expect(task.textContent).toContain('Task tk-1');
    task.click(); // lleva a la tarea
    expect(t.host.querySelector('.sch-row[data-id="tk-1"]')!.getAttribute('aria-selected')).toBe('true');
    expect(t.host.querySelector('.sch-task .sch-fields')!.textContent).toContain('Task tk-1');
    // un elemento sin tarea lo dice
    t.select(p3);
    t.mode.selectionChanged(p3);
    expect(t.host.querySelector('.sch-task .sch-info')!.textContent).toContain('Not in any task.');
    expect(t.host.querySelector('.sch-task .sch-info')!.textContent).toContain('Not scheduled');
  });

  it('the Task panel is informative only: it lists the elements but has no edit buttons', () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    expect(t.host.querySelector('.sch-task .sch-elements-title')!.textContent).toBe('Elements (1)');
    expect(t.host.querySelectorAll('.sch-task .sch-btn')).toHaveLength(0);
    expect(t.host.querySelector('.sch-task .sch-task-actions')).toBeNull();
  });

  /** The task dialog open, with Select elements… pressed. */
  const picking = (t: ReturnType<typeof setup>, over: Partial<Task> = {}) => {
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    const done = t.mode.editTask();
    const scrim = document.querySelector<HTMLElement>('.modal-scrim')!;
    const dialog = scrim.querySelector('.sch-task-dialog')!;
    dialog.querySelector<HTMLButtonElement>('.sch-elements-head .sch-btn')!.click();
    return { done, scrim, dialog, ...over };
  };
  const lastPaint = (t: ReturnType<typeof setup>) => t.viewer.setColorOverride.mock.calls.at(-1)![0] as (path: string) => unknown;

  it('Select elements: the dialog is compressed, only the 3d stays active, what belongs to the task is highlighted and the rest is dimmed; Done undoes it', async () => {
    const key1 = editPath(model.result.byPath.get(p1)!, model.result);
    const key2 = editPath(model.result.byPath.get(p2)!, model.result);
    const t = setup({ ...EMPTY_SCHEDULE, tasks: [T('tk-1', { elements: [key1] })] });
    const { done, scrim, dialog } = picking(t);
    expect(scrim.classList.contains('is-collapsed')).toBe(true);
    expect(t.setPicking).toHaveBeenLastCalledWith(true); // solo el 3d activo (lo hace el espacio de trabajo)
    expect(lastPaint(t)(p1)).toEqual({ color: PICKED, opacity: 1 }); // lo que ya es de la tarea
    expect(lastPaint(t)(p2)).toEqual({ color: GHOST, opacity: GHOST_OPACITY }); // el resto, de otro color
    // a click on the model: it goes to the dialog draft (not to the task) and starts to be seen as part of the task
    t.select(p2);
    t.mode.selectionChanged(p2);
    expect(t.actions.change).not.toHaveBeenCalled();
    expect(lastPaint(t)(p2)).toEqual({ color: PICKED, opacity: 1 });
    expect(lastPaint(t)(p3)).toEqual({ color: GHOST, opacity: GHOST_OPACITY });
    const paint = lastPaint(t);
    dialog.querySelector<HTMLButtonElement>('.sch-task-strip .sch-btn')!.click(); // Done
    await new Promise((r) => setTimeout(r));
    expect(t.setPicking).toHaveBeenLastCalledWith(false);
    expect(lastPaint(t)).not.toBe(paint); // the 4D colors come back
    expect(scrim.classList.contains('is-collapsed')).toBe(false);
    expect(dialog.querySelector('.sch-elements-title')!.textContent).toBe('2 linked elements');
    dialog.querySelector<HTMLButtonElement>('.modal-btn-primary')!.click();
    await done;
    expect(t.state.tasks[0].elements).toEqual([key1, key2]);
    // ya sin elegir, un clic en el modelo no agrega nada
    t.select(p3);
    t.mode.selectionChanged(p3);
    expect(t.actions.change).toHaveBeenCalledTimes(1);
  });

  it('Select elements ends with Esc and on leaving the mode, and the dialog unfolds', async () => {
    const t = setup();
    const { scrim, done } = picking(t);
    expect(scrim.classList.contains('is-collapsed')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r));
    expect(scrim.classList.contains('is-collapsed')).toBe(false);
    expect(t.setPicking).toHaveBeenLastCalledWith(false);
    scrim.querySelector<HTMLButtonElement>('.sch-elements-head .sch-btn')!.click();
    expect(scrim.classList.contains('is-collapsed')).toBe(true);
    t.mode.leave();
    await new Promise((r) => setTimeout(r));
    expect(scrim.classList.contains('is-collapsed')).toBe(false);
    expect(t.setPicking).toHaveBeenLastCalledWith(false);
    scrim.querySelector<HTMLButtonElement>('.modal-btn:not(.modal-btn-primary)')!.click(); // Cancel: it does not leave the dialog open
    await done;
  });

  it('borrar A la quita de las dependencias de B en el mismo paso', async () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    await t.mode.deleteTask();
    expect(t.actions.confirm).toHaveBeenCalledWith('Delete task Task tk-1?', 'Delete');
    expect(t.actions.change.mock.calls[0][0]).toBe('Delete Task');
    expect(t.state.tasks.map((x) => [x.id, x.deps])).toEqual([['tk-2', []]]);
  });

  it('Tasks by Level creates one task per level, from the bottom up and chained', async () => {
    const t = setup(EMPTY_SCHEDULE);
    t.mode.enter();
    await t.mode.tasksByLevel();
    expect(t.state.tasks.map((x) => [x.name, x.deps])).toEqual([['Level 0', []], ['Level 1', [fs('tk-1')]]]);
    expect(t.toast).toHaveBeenCalledWith('Created 2 tasks', 'info');
    expect(t.actions.confirm).not.toHaveBeenCalled();
  });

  it('Tasks by Level with tasks asks before adding', async () => {
    const t = setup();
    t.actions.confirm.mockResolvedValueOnce(false);
    t.mode.enter();
    await t.mode.tasksByLevel();
    expect(t.actions.confirm).toHaveBeenCalledWith('Add 2 tasks after the existing ones?', 'Add');
    expect(t.actions.change).not.toHaveBeenCalled();
  });

  it('un ciclo creado al editar avisa y no cambia nada', async () => {
    const t = setup();
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    const done = t.mode.editTask();
    const dialog = document.querySelector('.sch-task-dialog')!;
    const check = [...dialog.querySelectorAll<HTMLLabelElement>('.sch-check')].find((l) => l.textContent === 'Task tk-2')!.querySelector('input')!;
    check.checked = true;
    dialog.querySelector<HTMLButtonElement>('.modal-btn-primary')!.click();
    await done;
    expect(t.toast).toHaveBeenCalledWith('That link would make a loop', 'info');
    expect(t.actions.change).not.toHaveBeenCalled();
  });

  it('a task with linked elements that no longer exist does not fail and the panel says so', () => {
    const t = setup({ ...EMPTY_SCHEDULE, tasks: [T('tk-1', { elements: ['gone-1', 'gone-2'] })] });
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    expect(t.host.querySelector('.sch-task .sch-warn')!.textContent).toBe('2 linked elements are missing');
  });

  it('en solo lectura no se crea, enlaza ni borra; Play sigue', async () => {
    const t = setup(AB(), false);
    t.mode.enter();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-1"]')!.click();
    t.select(p3);
    t.mode.linkSelection();
    await t.mode.deleteTask();
    await t.mode.tasksByLevel();
    expect(t.actions.change).not.toHaveBeenCalled();
    t.host.querySelector<HTMLButtonElement>('.sch-play')!.click();
    expect(t.timer.every).toHaveBeenCalled();
  });
});

describe('modo Schedule: como Primavera, Project y Bexel', () => {
  it('what is demolished is standing, shows in red while it lasts and then disappears; the temporary in cyan', () => {
    // tk-1 construye Level 0 (5–11); tk-2 demuele Level 1 (12–16); tk-3 andamio en Level 0 (12–16)
    const t = setup({
      ...EMPTY_SCHEDULE,
      tasks: [
        T('tk-1', { rule: { storey: 'Level 0' } }),
        T('tk-2', { duration: 3, deps: [fs('tk-1')], rule: { storey: 'Level 1' }, kind: 'demolish' }),
        T('tk-3', { duration: 3, deps: [fs('tk-1')], elements: [], kind: 'temporary', rule: { storey: 'No storey' } }),
      ],
    });
    t.mode.enter();
    t.setDay(0); // jueves 5
    expect(lastOverride(t.viewer)(p2)).toBeNull(); // existe, con su material
    expect(lastHidden(t.setHidden)).toEqual([p3]); // the scaffolding is not there yet
    t.setDay(5); // jueves 12
    expect(lastOverride(t.viewer)(p2)).toEqual({ color: DEMOLISH, opacity: 1 });
    expect(lastOverride(t.viewer)(p3)).toEqual({ color: TEMPORARY, opacity: 1 });
    t.setDay(7); // Monday 16, last day
    t.mode.setFuture('ghost');
    t.setDay(7);
    expect(lastHidden(t.setHidden)).toEqual([]);
  });

  it('lo demolido y lo temporal ya retirados quedan ocultos aunque Future sea Ghost', () => {
    const t = setup({
      ...EMPTY_SCHEDULE,
      tasks: [
        T('tk-1', { duration: 1, rule: { storey: 'Level 1' }, kind: 'demolish' }),
        T('tk-2', { duration: 1, rule: { storey: 'No storey' }, kind: 'temporary' }),
        T('tk-3', { duration: 5, rule: { storey: 'Level 0' } }),
      ],
    });
    t.mode.enter();
    t.mode.setFuture('ghost');
    t.setDay(3); // martes 10: tk-1 y tk-2 (jueves 5) ya pasaron
    expect(lastHidden(t.setHidden).sort()).toEqual([p2, p3].sort());
  });

  it('the Gantt marks the critical path and the slack; Critical Path paints it', () => {
    const t = setup({ ...EMPTY_SCHEDULE, tasks: [T('tk-1'), T('tk-2', { duration: 2 })] });
    t.mode.enter();
    const floats = [...t.host.querySelectorAll('.sch-row .sch-float')].map((c) => c.textContent);
    expect(floats).toEqual(['0', '3']);
    t.mode.setCritical(true);
    expect(t.host.querySelector('.sch-gantt')!.classList.contains('show-critical')).toBe(true);
    expect(t.host.querySelector('.sch-bar[data-id="tk-1"]')!.classList.contains('is-critical')).toBe(true);
    expect(t.host.querySelector('.sch-bar[data-id="tk-2"]')!.classList.contains('is-critical')).toBe(false);
  });

  it('Expand opens the timeline in a modal with its own Gantt, up to date with the schedule; Esc closes it', () => {
    const t = setup();
    t.mode.enter();
    (t.host.querySelector('.sch-gantt .sch-expand') as HTMLButtonElement).click();
    const dialog = document.querySelector('.modal-scrim .sch-timeline-dialog')!;
    expect(dialog.querySelectorAll('.sch-row')).toHaveLength(2);
    expect(dialog.querySelector('.sch-expand')).toBeNull(); // sin otro Expand dentro
    t.setDay(3);
    expect(dialog.querySelector<HTMLElement>('.sch-dayline')!.hidden).toBe(false);
    dialog.querySelector<HTMLElement>('.sch-row[data-id="tk-2"]')!.click(); // choosing there also selects in the mode
    expect(t.host.querySelector('.sch-row[data-id="tk-2"]')!.getAttribute('aria-selected')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal-scrim')).toBeNull();
  });

  it('dragging the red line of the Gantt moves the 4D day to the working day that does not exceed it', () => {
    const t = setup();
    t.mode.enter();
    const handle = t.host.querySelector<HTMLElement>('.sch-dayhandle')!;
    expect(handle.hidden).toBe(false);
    // the Gantt measures 16 px per day with 3 of margin; the schedule starts on Thursday 5 Nov
    const drag = (x: number) => handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x })) && window.dispatchEvent(new MouseEvent('pointermove', { clientX: x }));
    drag(1);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: (3 + 4) * 16 + 2 })); // lunes 9
    expect(t.mode.day).toBe('2026-11-09');
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: (3 + 3) * 16 + 2 })); // Saturday 7: Friday 6
    expect(t.mode.day).toBe('2026-11-06');
    expect(t.host.querySelector<HTMLInputElement>('.sch-range')!.value).toBe('1');
    window.dispatchEvent(new MouseEvent('pointerup'));
  });

  it('the modal shows beside it the activities the day line crosses and follows the line', () => {
    const t = setup(); // A: Thu 5 – Wed 11 Nov (5 working days); B: Thu 12 – Mon 16
    t.mode.enter();
    (t.host.querySelector('.sch-gantt .sch-expand') as HTMLButtonElement).click();
    const live = document.querySelector('.sch-timeline-live')!;
    const names = () => [...live.querySelectorAll('.sch-live-name')].map((n) => n.textContent);
    t.setDay(0); // jueves 5: solo A
    expect(names()).toEqual(['Task tk-1']);
    expect(live.querySelector('.sch-live-sub')!.textContent).toBe('1 activity on this day');
    expect(live.querySelector('.sch-live-meta')!.textContent).toContain('Nov 5 – Nov 11');
    t.setDay(5); // jueves 12: solo B
    expect(names()).toEqual(['Task tk-2']);
    (live.querySelector('.sch-live-item') as HTMLButtonElement).click(); // choosing it there selects it
    expect(t.host.querySelector('.sch-row[data-id="tk-2"]')!.getAttribute('aria-selected')).toBe('true');
    expect(live.querySelector('.sch-live-item')!.getAttribute('aria-current')).toBe('true');
    // the touched bars are also highlighted in the Gantt of the modal
    expect(document.querySelector('.sch-timeline-dialog .sch-bar[data-id="tk-2"]')!.classList.contains('is-live')).toBe(true);
  });

  it('leaving the mode closes the timeline modal', () => {
    const t = setup();
    t.mode.enter();
    (t.host.querySelector('.sch-gantt .sch-expand') as HTMLButtonElement).click();
    expect(document.querySelector('.sch-timeline-dialog')).not.toBeNull();
    t.mode.leave();
    expect(document.querySelector('.sch-timeline-dialog')).toBeNull();
  });

  it('Set Baseline guarda las fechas de ahora; si A se alarga, B va con retraso en el panel', async () => {
    const t = setup();
    t.mode.enter();
    await t.mode.setBaseline();
    expect(t.actions.change.mock.calls[0][0]).toBe('Set Baseline');
    expect(t.state.tasks.map((x) => x.baseline)).toEqual([
      { start: '2026-11-05', end: '2026-11-11' },
      { start: '2026-11-12', end: '2026-11-16' },
    ]);
    expect(t.actions.confirm).not.toHaveBeenCalled();
    await t.actions.change('x', (s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === 'tk-1' ? { ...x, duration: 7 } : x)) }));
    t.mode.refresh();
    t.host.querySelector<HTMLElement>('.sch-row[data-id="tk-2"]')!.click();
    expect(t.host.querySelector('.sch-task')!.textContent).toContain('2 days late');
    // la segunda vez pregunta
    await t.mode.setBaseline();
    expect(t.actions.confirm).toHaveBeenCalledWith("Replace the current baseline with today's dates?", 'Replace');
  });

  it('importing an MS Project keeps the elements of the tasks with the same name', async () => {
    const t = setup({ ...EMPTY_SCHEDULE, tasks: [T('tk-1', { name: 'Walls', rule: { storey: 'Level 0' } })] });
    t.actions.importFile.mockResolvedValueOnce({
      name: 'plan.xml',
      text: `<Project xmlns="http://schemas.microsoft.com/project"><Tasks>
        <Task><UID>1</UID><Name>Walls</Name><Start>2026-11-09T08:00:00</Start><Duration>PT16H0M0S</Duration></Task>
        <Task><UID>2</UID><Name>Roof</Name><Start>2026-11-09T08:00:00</Start><Duration>PT8H0M0S</Duration>
          <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task></Tasks></Project>`,
    });
    t.mode.enter();
    await t.mode.importSchedule();
    expect(t.actions.confirm).toHaveBeenCalledWith(
      'Replace 1 tasks with the 2 in plan.xml? Tasks with the same name keep their linked elements.', 'Replace',
    );
    expect(t.actions.change.mock.calls[0][0]).toBe('Import Schedule');
    expect(t.state.tasks.map((x) => [x.name, x.start, x.duration, x.rule])).toEqual([
      ['Walls', '2026-11-09', 2, { storey: 'Level 0' }],
      ['Roof', '2026-11-09', 1, null],
    ]);
    expect(t.toast).toHaveBeenCalledWith('Imported 2 tasks from plan.xml', 'info');
  });

  it('un archivo ilegible avisa y no cambia nada', async () => {
    const t = setup();
    t.actions.importFile.mockResolvedValueOnce({ name: 'bad.xer', text: 'nope' });
    t.mode.enter();
    await t.mode.importSchedule();
    expect(t.toast).toHaveBeenCalledWith('Could not read bad.xer: This is not a Primavera XER file', 'error');
    expect(t.actions.change).not.toHaveBeenCalled();
  });

  it('Export escribe un MS Project XML con el nombre del modelo', async () => {
    const t = setup();
    t.mode.enter();
    await t.mode.exportSchedule();
    const [name, xml] = t.actions.exportFile.mock.calls[0];
    expect(name).toBe('hello-wall.xml');
    expect(xml).toContain('<Name>Task tk-2</Name>');
    expect(t.toast).toHaveBeenCalledWith('Exported hello-wall.xml', 'info');
  });
});

describe('modo Schedule: 5D con el sistema de costos', () => {
  const ATTR = 'prj::costos::codigo';
  const file = (id: string, data: IfcxFile['data']): IfcxFile => ({ header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data });
  const src = (name: string): ProvenanceSource => ({ role: 'import', name, uri: name, location: `C:/t/${name}` });
  const docSrc: ProvenanceSource = { role: 'layer', name: 'doc', uri: null, layerId: 'document' };
  const costs = file('costos', [
    { path: 'root', attributes: { [K_COST_SYSTEM]: { id: 'c', name: 'C', attribute: ATTR, currency: 'EUR' } } },
    { path: 'code-A', attributes: { [ATTR]: { code: 'A', name: 'Slabs' }, 'prj::medicion': { unit: 'm³', measure: 'volume' }, 'prj::precio': 100 } },
  ]);
  const els = file('m', [
    { path: 'E1', inherits: { costos: 'code-A' }, attributes: { 'bsi::ifc::class': { code: 'IfcSlab' } } },
    { path: 'E2', inherits: { costos: 'code-A' }, attributes: { 'bsi::ifc::class': { code: 'IfcSlab' } } },
  ]);
  const costModel = (): LoadedModel => ({ name: 'm', path: null, result: compose([costs, els], { sources: [src('costos.ifcx'), docSrc] }), warnings: [] });
  const slab = (m: LoadedModel, o: string, volume: number): QuantityRow => ({
    element: m.result.byOrigin.get(o)![0].path, name: o, cls: 'IfcSlab', storey: 'L1', material: '', materialCode: null, box: [0, 0, 0, 1, 1, volume], volume, area: 1,
  });

  it('the cost curve adds what the elements of the tasks cost, in the currency of the system', () => {
    const m = costModel();
    const t = setup({ ...EMPTY_SCHEDULE, tasks: [T('tk-1', { rule: { cls: 'IfcSlab' } })] }, true, { model: m, rows: [slab(m, 'E1', 2), slab(m, 'E2', 3)] });
    t.mode.enter();
    const box = t.host.querySelector('.sch-curve-box')!;
    expect(box.querySelector('svg.sch-curve')).toBeTruthy();
    expect(box.textContent).toContain('€500.00');
  });

  it('sin sistema de costos no hay curva', () => {
    const t = setup(AB());
    t.mode.enter();
    expect(t.host.querySelector('.sch-curve-box svg.sch-curve')).toBeNull();
    expect(t.host.querySelector('.sch-curve-box')!.textContent).toContain('Add items in Costs');
  });
});
