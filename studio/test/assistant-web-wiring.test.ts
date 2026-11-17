import { describe, expect, it, vi } from 'vitest';
import { connectWebAssistant } from '../src/app/assistant-web';
import { createBus } from '../src/assistant/web/bus';
import { memoryConversations } from '../src/assistant/web/conversations';
import type { StudioExecutor } from '../src/assistant/studio/executor';
import type { EventRelay } from '../src/assistant/builtbot/relay';

function setup() {
  const win = {} as Window;
  const bus = createBus();
  const setLock = vi.fn();
  const executor = { run: vi.fn(async () => ({ ok: true as const, result: {} })) } as unknown as StudioExecutor;
  connectWebAssistant({
    executor,
    setLock,
    win,
    bus,
    store: memoryConversations(),
    storage: null,
    fetchImpl: vi.fn() as unknown as typeof fetch,
  });
  const relay = (win as unknown as { __ifcxRelay: EventRelay }).__ifcxRelay;
  return { win, bus, setLock, relay };
}

describe('Asistente web conectado a Studio', () => {
  it('deja en la ventana un relevo web con invoke, que BuiltBot lee al montarse', async () => {
    const { relay } = setup();
    expect(relay.web).toBe(true);
    expect(await relay.invoke!('bridge_status')).toEqual({ running: true, error: null, log: '' });
  });

  it('A small tree: level L1 with a measured wall that hosts a door without a mesh, a curtain wall with a measured panel,', async () => {
    const { relay } = setup();
    const seen: unknown[] = [];
    await relay.listen('chat://end', (e) => void seen.push(e));
    await relay.invoke!('send_request', { payload: { id: 'p1', type: 'ping' } });
    expect(seen).toEqual([{ event: 'chat://end', payload: { id: 'p1' } }]);
  });

  it('el usuario no puede editar mientras corre un turno y vuelve a poder al terminar', () => {
    const { bus, setLock } = setup();
    bus.emit('studio://turn-start', { id: 'a' });
    expect(setLock).toHaveBeenLastCalledWith(true);
    bus.emit('studio://turn-end', { id: 'a' });
    expect(setLock).toHaveBeenLastCalledWith(false);
  });

  it('each element without a row, that hosts nothing measured, gives a row without measures at its point and with its level', () => {
    const { bus, setLock } = setup();
    bus.emit('studio://turn-start', { id: 'a' });
    bus.emit('studio://turn-start', { id: 'b' });
    bus.emit('studio://turn-end', { id: 'a' });
    expect(setLock).not.toHaveBeenCalledWith(false);
    bus.emit('studio://turn-end', { id: 'b' });
    expect(setLock).toHaveBeenLastCalledWith(false);
  });

  it('el fin de un turno que no estaba abierto no quita el bloqueo de otro', () => {
    const { bus, setLock } = setup();
    bus.emit('studio://turn-start', { id: 'a' });
    bus.emit('studio://turn-end', { id: 'zzz' });
    expect(setLock).not.toHaveBeenCalledWith(false);
  });
});
