// Span timing. It only records while measurement is on
// (`globalThis.__IFCX_PERF__ === true` or `localStorage['ifcx.perf'] === '1'`); otherwise it just calls fn.

interface Acc { ms: number; count: number }
const spans = new Map<string, Acc>(); // the Map keeps insertion order

export function perfEnabled(): boolean {
  if ((globalThis as any).__IFCX_PERF__ === true) return true;
  try {
    return (globalThis as any).localStorage?.getItem('ifcx.perf') === '1';
  } catch {
    return false;
  }
}

function add(name: string, ms: number) {
  const a = spans.get(name);
  if (a) { a.ms += ms; a.count++; } else spans.set(name, { ms, count: 1 });
}

/** Times fn and adds the time under `name` (even if it throws). */
export function perfSpan<T>(name: string, fn: () => T): T {
  if (!perfEnabled()) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    add(name, performance.now() - t0);
  }
}

/** Like perfSpan, for promises (even if it rejects). */
export async function perfSpanAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    add(name, performance.now() - t0);
  }
}

/** Adds an already measured time (the first frame, for instance), only while measurement is on. */
export function perfAdd(name: string, ms: number): void {
  if (perfEnabled()) add(name, ms);
}

export function perfReset(): void {
  spans.clear();
}

export function perfReport(): { name: string; ms: number; count: number }[] {
  return [...spans].map(([name, a]) => ({ name, ms: a.ms, count: a.count }));
}

/** Records every long task of the main thread as `longtask` (duration >= minMs). Returns the observer, or null if unsupported or measurement is off. */
export function observeLongTasks(minMs = 50, PO: typeof PerformanceObserver | undefined = (globalThis as any).PerformanceObserver): PerformanceObserver | null {
  if (!perfEnabled() || !PO) return null;
  try {
    const po = new PO((list) => {
      for (const e of list.getEntries()) if (e.duration >= minMs) perfAdd('longtask', e.duration);
    });
    po.observe({ entryTypes: ['longtask'] });
    return po;
  } catch {
    return null; // `longtask` unsupported in this WebView
  }
}
