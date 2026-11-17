import { afterEach, describe, expect, it } from 'vitest';
import {
  addWorkdays, displayDay, formatDay, isWorkday, nextWorkday, parseDay, weekStart, workdaysBetween,
} from '../src/schedule/calendar';
import { DEFAULT_CALENDAR as CAL, type Calendar } from '../src/schedule/state';

const TZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = TZ;
});

describe('calendario laboral', () => {
  it('5 days from a Thursday end the following Wednesday', () => {
    expect(addWorkdays('2026-11-05', 4, CAL)).toBe('2026-11-11');
  });

  it('a holiday within the task extends it by a day', () => {
    expect(addWorkdays('2026-11-05', 4, { ...CAL, holidays: ['2026-11-10'] })).toBe('2026-11-12');
  });

  it('de viernes a lunes en cualquier huso horario', () => {
    for (const tz of ['America/Panama', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      expect(addWorkdays('2026-11-06', 1, CAL)).toBe('2026-11-09');
      expect(displayDay('2026-11-03')).toBe('Tue, Nov 3, 2026');
    }
  });

  it('nextWorkday salta el fin de semana y deja igual un laborable', () => {
    expect(nextWorkday('2026-11-07', CAL)).toBe('2026-11-09');
    expect(nextWorkday('2026-11-09', CAL)).toBe('2026-11-09');
    expect(isWorkday('2026-11-08', CAL)).toBe(false);
  });

  it('addWorkdays from a Saturday starts counting on Monday', () => {
    expect(addWorkdays('2026-11-07', 0, CAL)).toBe('2026-11-09');
  });

  it('workdaysBetween cuenta solo laborables, ambos extremos incluidos', () => {
    expect(workdaysBetween('2026-11-06', '2026-11-10', CAL)).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
  });

  it('weekStart da el lunes de su semana', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
  });

  it('parseDay rechaza fechas que no existen y formatDay es su inverso', () => {
    expect(parseDay('2026-02-30')).toBeNaN();
    expect(parseDay('3/11/2026')).toBeNaN();
    expect(formatDay(parseDay('2026-11-03'))).toBe('2026-11-03');
  });

  it('un calendario sin laborables no se cuelga', () => {
    const none: Calendar = { workdays: [], holidays: [] };
    expect(nextWorkday('2026-11-05', none)).toBe('2026-11-05');
    expect(addWorkdays('2026-11-05', 3, none)).toBe('2026-11-05');
  });
});
