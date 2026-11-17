import { beforeEach, describe, expect, it } from 'vitest';
import { RIBBON } from '../src/ribbon/definition';
import { MODES, type ModeId } from '../src/modes/definition';
import { modeFromKey } from '../src/modes/keys';
import { loadMode, saveMode } from '../src/modes/memory';

describe('definition of modes', () => {
  it('va en el orden Model, Materials, Costs, Schedule', () => {
    expect(MODES.map((m) => m.label)).toEqual(['Model', 'Materials', 'Costs', 'Schedule']);
    expect(MODES[0].ribbon).toBe(RIBBON);
  });
  it('Schedule has its buttons: tasks, elements, Future, critical path, baseline, exchange and calendar', () => {
    const buttons = MODES[3].ribbon.flatMap((t) => t.groups.flatMap((g) => g.buttons));
    expect(buttons.map((b) => b.action)).toEqual([
      'schNew', 'schEdit', 'schDelete', 'schLink', 'schByLevel', 'schFuture', 'schCritical', 'schBaseline', 'schImport', 'schExport', 'schCalendar',
    ]);
    expect(buttons.find((b) => b.action === 'schCritical')!.toggle).toBe(true);
    expect(buttons.find((b) => b.action === 'schFuture')!.menu!.map((o) => o.value)).toEqual(['hidden', 'ghost']);
  });
  it('no markers are left: all the modes have buttons with an action', () => {
    for (const m of MODES) expect(m.ribbon.flatMap((t) => t.groups.flatMap((g) => g.buttons)).some((b) => b.action)).toBe(true);
    for (const m of MODES) expect(m.ribbon.map((t) => t.id)).toContain(m.initialTab);
  });
  it('Costs has its buttons: item, codes, assignment and Color By', () => {
    const buttons = MODES[2].ribbon.flatMap((t) => t.groups.flatMap((g) => g.buttons));
    expect(buttons.map((b) => b.action)).toEqual(['costEdit', 'costEditSystem', 'costAssign', 'costClearAssign', 'costColor']);
    expect(buttons.find((b) => b.action === 'costColor')!.menu!.map((o) => o.value)).toEqual(['off', 'item', 'cost']);
  });
  it('Materials tiene New Material, Assign to Selection, Assign by Rule y Material Colors', () => {
    const buttons = MODES[1].ribbon.flatMap((t) => t.groups.flatMap((g) => g.buttons));
    expect(buttons.map((b) => b.action)).toEqual(['matNew', 'matAssign', 'matRule', 'matColors']);
    expect(buttons[3].toggle).toBe(true);
  });
});

describe('modeFromKey', () => {
  it.each([
    [{ key: '3', ctrlKey: true }, 'model', 'costs'],
    [{ key: 'Tab', ctrlKey: true }, 'schedule', 'model'],
    [{ key: 'Tab', ctrlKey: true, shiftKey: true }, 'model', 'schedule'],
    [{ key: '3' }, 'model', null],
    [{ key: 'Tab' }, 'model', null],
    [{ key: '3', ctrlKey: true, altKey: true }, 'model', null],
    [{ key: '5', ctrlKey: true }, 'model', null],
  ])('%o desde %s → %s', (init, cur, out) => {
    expect(modeFromKey(new KeyboardEvent('keydown', init), cur as ModeId)).toBe(out);
  });
});

describe('memory of the last mode', () => {
  beforeEach(() => localStorage.clear());
  it('it remembers the mode by path, ignoring case and slashes', () => {
    saveMode('C:\\Obra\\Casa.ifcx', 'costs');
    expect(loadMode('c:/obra/casa.ifcx')).toBe('costs');
    expect(localStorage.getItem('studio.mode:c:/obra/casa.ifcx')).toBe('costs');
  });
  it('sin ruta o con basura vuelve a model y no guarda', () => {
    saveMode(null, 'costs');
    expect(localStorage.length).toBe(0);
    localStorage.setItem('studio.mode:x', 'nope');
    expect(loadMode('x')).toBe('model');
    expect(loadMode(null)).toBe('model');
  });
});
