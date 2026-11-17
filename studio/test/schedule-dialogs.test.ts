import { beforeEach, describe, expect, it } from 'vitest';
import { askCalendar } from '../src/schedule/calendardialog';
import { askTask } from '../src/schedule/taskdialog';
import { DEFAULT_CALENDAR, fs, type Task } from '../src/schedule/state';

beforeEach(() => {
  document.body.innerHTML = '';
});

const T: Task = { id: 'tk-2', name: 'New task', phase: '', start: '2026-11-05', duration: 5, deps: [], rule: null, elements: [] };
const CHOICES = {
  tasks: [{ id: 'tk-1', name: 'Footings' }],
  classes: ['IfcSlab', 'IfcWall'],
  storeys: ['Level 1', 'Level 2'],
  materials: [{ code: 'C30', name: 'Concrete C30' }],
};
const dialog = () => document.querySelector('.modal')!;
const field = (label: string) =>
  [...dialog().querySelectorAll<HTMLElement>('.sch-field')].find((f) => f.textContent?.startsWith(label))!
    .querySelector<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>('input, select, textarea')!;
const check = (label: string) =>
  [...dialog().querySelectorAll<HTMLLabelElement>('.sch-check')].find((l) => l.textContent === label)!.querySelector('input')!;
const save = () => dialog().querySelector<HTMLButtonElement>('.modal-btn-primary')!.click();
const error = () => dialog().querySelector('.sch-error')!.textContent;

describe('task dialog', () => {
  it('crea una tarea con regla de nivel y una predecesora', async () => {
    const done = askTask(T, CHOICES);
    field('Name').value = 'Walls L1';
    field('Duration').value = '3';
    check('Footings').checked = true;
    const rule = check('Use a rule');
    rule.checked = true;
    rule.dispatchEvent(new Event('change'));
    field('Level').value = 'Level 1';
    save();
    expect(await done).toEqual({ ...T, name: 'Walls L1', duration: 3, deps: [fs('tk-1')], rule: { storey: 'Level 1' } });
  });

  it('sin «Use a rule» la regla es null, los selects van desactivados y se conservan los enlazados', async () => {
    const done = askTask({ ...T, rule: { cls: 'IfcWall' }, elements: ['w1', 'w2'] }, CHOICES);
    expect(dialog().textContent).toContain('2 linked elements');
    const rule = check('Use a rule');
    rule.checked = false;
    rule.dispatchEvent(new Event('change'));
    expect(field('Class').disabled).toBe(true);
    save();
    expect(await done).toMatchObject({ rule: null, elements: ['w1', 'w2'] });
  });

  it('each error is shown without closing', async () => {
    const done = askTask(T, CHOICES);
    field('Name').value = ' ';
    save();
    expect(error()).toBe('A task needs a name');
    field('Name').value = 'X';
    field('Duration').value = '-1';
    save();
    expect(error()).toBe('Duration must be 0 days or more');
    field('Duration').value = '2.5';
    save();
    expect(error()).toBe('Duration must be 0 days or more');
    field('Duration').value = '2';
    field('% complete').value = '120';
    save();
    expect(error()).toBe('Progress goes from 0 to 100');
    field('% complete').value = '0';
    field('Duration').value = '2';
    field('Start').value = '';
    save();
    expect(error()).toBe('Enter a valid date');
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await done).toBeNull();
  });
});

describe('task dialog: Primavera and Project things', () => {
  it('task type, progress, 0-day milestone and an SS predecessor with lag', async () => {
    const done = askTask(T, CHOICES);
    field('Type').value = 'demolish';
    field('Duration').value = '0';
    field('% complete').value = '35';
    const c = check('Footings');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    const type = dialog().querySelector<HTMLSelectElement>('[aria-label="Link type to Footings"]')!;
    const lag = dialog().querySelector<HTMLInputElement>('[aria-label="Lag to Footings (days)"]')!;
    expect(type.disabled).toBe(false);
    type.value = 'SS';
    lag.value = '-2';
    save();
    expect(await done).toEqual({ ...T, duration: 0, kind: 'demolish', progress: 35, deps: [{ task: 'tk-1', type: 'SS', lag: -2 }] });
  });

  it('going back to Construct and 0 % remove the fields; the type and lag of an unchecked predecessor cannot be touched', async () => {
    const done = askTask({ ...T, kind: 'temporary', progress: 50 }, CHOICES);
    expect(dialog().querySelector<HTMLSelectElement>('[aria-label="Link type to Footings"]')!.disabled).toBe(true);
    field('Type').value = 'construct';
    field('% complete').value = '0';
    save();
    const t = await done;
    expect(t).not.toHaveProperty('kind');
    expect(t).not.toHaveProperty('progress');
  });
});

describe('calendar dialog', () => {
  it('check Saturday and write a holiday', async () => {
    const done = askCalendar(DEFAULT_CALENDAR);
    check('Sat').checked = true;
    field('Holidays').value = '2026-12-25\n\n';
    save();
    expect(await done).toEqual({ workdays: [1, 2, 3, 4, 5, 6], holidays: ['2026-12-25'] });
  });

  it('a badly written date says its line and without working days it also warns', async () => {
    const done = askCalendar(DEFAULT_CALENDAR);
    field('Holidays').value = '25/12/2026';
    save();
    expect(error()).toBe('Line 1 is not a date (YYYY-MM-DD)');
    field('Holidays').value = '';
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) check(d).checked = false;
    save();
    expect(error()).toBe('Pick at least one working day');
    dialog().querySelector<HTMLButtonElement>('.modal-btn:not(.modal-btn-primary)')!.click();
    expect(await done).toBeNull();
  });
});

describe('task dialog: linked elements', () => {
  const rows = () => [...dialog().querySelectorAll('.sch-element-name')].map((n) => n.textContent);
  const add = () => dialog().querySelector<HTMLButtonElement>('.sch-elements-head .sch-btn')!;

  it('it shows the linked ones by name, or by key if there is no name, and removes them on save', async () => {
    const done = askTask({ ...T, elements: ['a', 'b'] }, { ...CHOICES, elements: [{ key: 'a', label: 'Wall 1 (IfcWall)' }] });
    expect(dialog().textContent).toContain('2 linked elements');
    expect(rows()).toEqual(['Wall 1 (IfcWall)', 'b']);
    dialog().querySelector<HTMLButtonElement>('[aria-label="Remove Wall 1 (IfcWall)"]')!.click();
    expect(rows()).toEqual(['b']);
    save();
    expect((await done)!.elements).toEqual(['b']);
  });

  it('Select elements compresses the dialog into a strip, adds what is chosen without repeats and unfolds it at the end; without pickElements it is disabled', async () => {
    let pick: (items: { key: string; label: string }[]) => void = () => {};
    let finish: () => void = () => {};
    let given: string[] = [];
    const pickElements = (current: string[], onPick: typeof pick) => {
      given = current;
      pick = onPick;
      return { done: new Promise<void>((resolve) => (finish = resolve)), stop: () => finish() };
    };
    const done = askTask({ ...T, elements: ['b'] }, { ...CHOICES, pickElements });
    expect(add().disabled).toBe(false);
    expect(add().textContent).toBe('Select elements…');
    add().click();
    const scrim = document.querySelector<HTMLElement>('.modal-scrim')!;
    expect(scrim.classList.contains('is-collapsed')).toBe(true); // the dialog is compressed and lets clicks through to the model
    expect(dialog().classList.contains('is-collapsed')).toBe(true);
    expect(given).toEqual(['b']); // lo ya enlazado, para resaltarlo
    expect(dialog().querySelector('.sch-task-strip-text')!.textContent).toContain('1 linked elements');
    pick([{ key: 'b', label: 'Slab 1' }, { key: 'c', label: 'Slab 2' }]);
    pick([{ key: 'c', label: 'Slab 2' }]); // repetir no duplica
    expect(dialog().querySelector('.sch-task-strip-text')!.textContent).toContain('2 linked elements');
    dialog().querySelector<HTMLButtonElement>('.sch-task-strip .sch-btn')!.click(); // Done, en la franja
    await new Promise((r) => setTimeout(r));
    expect(scrim.classList.contains('is-collapsed')).toBe(false);
    expect(rows()).toEqual(['Slab 1', 'Slab 2']); // «b» ya estaba enlazado y adopta el nombre con que llega
    save();
    expect((await done)!.elements).toEqual(['b', 'c']);
    const none = askTask(T, CHOICES);
    expect(add().disabled).toBe(true);
    expect(dialog().textContent).toContain('No linked elements');
    dialog().querySelector<HTMLButtonElement>('.modal-btn:not(.modal-btn-primary)')!.click();
    expect(await none).toBeNull();
  });
});

describe('task dialog: many predecessors', () => {
  const MANY = { ...CHOICES, tasks: Array.from({ length: 12 }, (_, i) => ({ id: `tk-${i + 1}`, name: i < 6 ? `Walls L${i + 1}` : `Slabs L${i - 5}` })) };
  const filter = () => dialog().querySelector<HTMLInputElement>('.sch-pred-filter')!;
  const visible = () => [...dialog().querySelectorAll<HTMLElement>('.sch-pred-row')].filter((r) => !r.hidden).length;

  it('with more than 8 tasks it offers a name filter that hides rows without losing what is checked', async () => {
    const done = askTask({ ...T, deps: [fs('tk-9')] }, MANY);
    expect(filter().hidden).toBe(false);
    expect(visible()).toBe(12);
    filter().value = 'walls';
    filter().dispatchEvent(new Event('input'));
    expect(visible()).toBe(6);
    filter().value = '';
    filter().dispatchEvent(new Event('input'));
    expect(visible()).toBe(12);
    filter().value = 'walls'; // the checked predecessor (a slab) stays in the dependencies even if its row is hidden
    filter().dispatchEvent(new Event('input'));
    save();
    expect((await done)!.deps).toEqual([fs('tk-9')]);
  });

  it('with few tasks there is no filter, and the list and the buttons go in their place', async () => {
    const done = askTask(T, CHOICES);
    expect(filter().hidden).toBe(true);
    expect(dialog().querySelector('.sch-task-form .sch-pred-list')).not.toBeNull();
    expect(dialog().querySelector('.sch-task-foot .modal-buttons')).not.toBeNull(); // el pie queda fuera del scroll
    dialog().querySelector<HTMLButtonElement>('.modal-btn:not(.modal-btn-primary)')!.click();
    expect(await done).toBeNull();
  });
});
