import { describe, expect, it, vi } from 'vitest';
import { connectStudio } from '../src/assistant/builtbot/studio-link';
import type { StudioExecutor } from '../src/assistant/studio/executor';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(run: StudioExecutor['run'] = vi.fn(async () => ({ ok: true as const, result: { name: 'A' } }))) {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  const offs: string[] = [];
  const listen = vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    handlers.set(event, cb);
    return () => void offs.push(event);
  });
  const invoke = vi.fn(async () => undefined);
  const setLock = vi.fn();
  const executor: StudioExecutor = {
    run,
    preview: vi.fn(async () => ({ ok: true as const, summary: null })),
  };
  const emit = (event: string, payload: unknown) => handlers.get(event)!({ payload });
  return { listen, invoke, setLock, executor, emit, offs };
}

const link = (s: ReturnType<typeof setup>) =>
  connectStudio({ executor: s.executor, setLock: s.setLock, listen: s.listen as never, invoke: s.invoke as never });

describe('enlace de Studio con el agente', () => {
  it('un studio_call se ejecuta y se contesta con studio_result', async () => {
    const s = setup();
    await link(s);
    s.emit('chat://studio_call', { event: 'studio_call', id: 't1', call_id: 'c1', command: 'model_info', args: { x: 1 } });
    await tick();
    expect(s.executor.run).toHaveBeenCalledWith('model_info', { x: 1 });
    expect(s.invoke).toHaveBeenCalledWith('studio_result', { payload: { call_id: 'c1', ok: true, result: { name: 'A' } } });
  });

  it('un ejecutor que falla contesta con el error en vez de dejar al agente esperando', async () => {
    const s = setup(vi.fn(async () => { throw new Error('boom'); }));
    await link(s);
    s.emit('chat://studio_call', { call_id: 'c2', command: 'x', args: {} });
    await tick();
    expect(s.invoke).toHaveBeenCalledWith('studio_result', { payload: { call_id: 'c2', ok: false, error: 'boom' } });
  });

  it('The items and the classification code are read from the composed model, with the table as one more import.', async () => {
    const s = setup(vi.fn(async () => ({ ok: false as const, error: 'No model is open' })));
    await link(s);
    s.emit('chat://studio_call', { call_id: 'c3', command: 'model_info', args: {} });
    await tick();
    expect(s.invoke).toHaveBeenCalledWith('studio_result', { payload: { call_id: 'c3', ok: false, error: 'No model is open' } });
  });

  it('an element with a class that also carries the attribute is not an item', async () => {
    const s = setup();
    await link(s);
    s.emit('studio://turn-start', { id: 't1' });
    expect(s.setLock).toHaveBeenLastCalledWith(true);
    s.emit('studio://turn-end', { id: 't1' });
    expect(s.setLock).toHaveBeenLastCalledWith(false);
  });

  it('el fin de otro turno no desbloquea', async () => {
    const s = setup();
    await link(s);
    s.emit('studio://turn-start', { id: 't1' });
    s.emit('studio://turn-end', { id: 'otro' });
    expect(s.setLock).not.toHaveBeenCalledWith(false);
  });

  it('si cae el puente se desbloquea', async () => {
    const s = setup();
    await link(s);
    s.emit('studio://turn-start', { id: 't1' });
    s.emit('bridge://error', { running: false, error: 'exited', log: '' });
    expect(s.setLock).toHaveBeenLastCalledWith(false);
  });

  it('soltar el enlace quita todas las suscripciones', async () => {
    const s = setup();
    const off = await link(s);
    off();
    expect(s.offs.sort()).toEqual(['bridge://error', 'chat://studio_call', 'studio://turn-end', 'studio://turn-start']);
  });
});
