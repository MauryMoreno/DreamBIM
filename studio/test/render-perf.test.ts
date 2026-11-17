import { afterEach, describe, expect, it } from 'vitest';
import { observeLongTasks, perfEnabled, perfReport, perfReset, perfSpan, perfSpanAsync } from '../src/render/perf';

describe('perf', () => {
  afterEach(() => {
    delete (globalThis as any).__IFCX_PERF__;
    perfReset();
  });

  it('perfSpan adds by name only with the measurement on', () => {
    (globalThis as any).__IFCX_PERF__ = true;
    perfReset();
    perfSpan('a', () => 1);
    perfSpan('a', () => 2);
    perfSpan('b', () => 3);
    const r = perfReport();
    expect(r.map((x) => [x.name, x.count])).toEqual([['a', 2], ['b', 1]]);
    expect(r.every((x) => x.ms >= 0)).toBe(true);
  });

  it('without the measurement on it records nothing and returns the value', () => {
    (globalThis as any).__IFCX_PERF__ = false;
    perfReset();
    expect(perfEnabled()).toBe(false);
    expect(perfSpan('a', () => 7)).toBe(7);
    expect(perfReport()).toEqual([]);
  });

  it('it is also enabled with localStorage ifcx.perf = 1', () => {
    const store: Record<string, string> = { 'ifcx.perf': '1' };
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null };
    try {
      expect(perfEnabled()).toBe(true);
      store['ifcx.perf'] = '0';
      expect(perfEnabled()).toBe(false);
    } finally {
      delete (globalThis as any).localStorage;
    }
  });

  it('perfSpan registra el tramo aunque fn lance y propaga el error', () => {
    (globalThis as any).__IFCX_PERF__ = true;
    perfReset();
    expect(() => perfSpan('x', () => { throw new Error('boom'); })).toThrow('boom');
    expect(perfReport().map((x) => [x.name, x.count])).toEqual([['x', 1]]);
  });

  it('perfSpanAsync mide promesas y propaga el error', async () => {
    (globalThis as any).__IFCX_PERF__ = true;
    perfReset();
    await expect(perfSpanAsync('ok', async () => 5)).resolves.toBe(5);
    await expect(perfSpanAsync('mal', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(perfReport().map((x) => [x.name, x.count])).toEqual([['ok', 1], ['mal', 1]]);
  });

  it('perfSpanAsync without measurement only calls fn', async () => {
    (globalThis as any).__IFCX_PERF__ = false;
    perfReset();
    await expect(perfSpanAsync('a', async () => 9)).resolves.toBe(9);
    expect(perfReport()).toEqual([]);
  });

  it('observeLongTasks records only the tasks >= 50 ms as longtask', () => {
    (globalThis as any).__IFCX_PERF__ = true;
    perfReset();
    let cb: (l: any) => void = () => {};
    let opts: any;
    class FakePO { constructor(c: any) { cb = c; } observe(o: any) { opts = o; } }
    const po = observeLongTasks(50, FakePO as any);
    expect(po).not.toBeNull();
    expect(opts).toEqual({ entryTypes: ['longtask'] });
    cb({ getEntries: () => [{ duration: 49 }, { duration: 50 }, { duration: 120 }] });
    expect(perfReport()).toEqual([{ name: 'longtask', ms: 170, count: 2 }]);
  });

  it('observeLongTasks returns null without support, with an error or with the measurement off', () => {
    (globalThis as any).__IFCX_PERF__ = true;
    expect(observeLongTasks(50, null as any)).toBeNull();
    class Throws { constructor(_c: any) {} observe() { throw new TypeError('longtask'); } }
    expect(observeLongTasks(50, Throws as any)).toBeNull();
    (globalThis as any).__IFCX_PERF__ = false;
    class Ok { constructor(_c: any) {} observe() {} }
    expect(observeLongTasks(50, Ok as any)).toBeNull();
  });
});
