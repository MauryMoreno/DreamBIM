import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../src/assistant/web/bus';

describe('bus de eventos del Asistente web', () => {
  it('delivers each event to the listeners of that name with the shape of the Tauri Event', async () => {
    const bus = createBus();
    const delta = vi.fn();
    const otro = vi.fn();
    await bus.listen('chat://delta', delta);
    await bus.listen('chat://end', otro);
    bus.emit('chat://delta', { id: 'a', text: 'hola' });
    expect(delta).toHaveBeenCalledWith({ event: 'chat://delta', payload: { id: 'a', text: 'hola' } });
    expect(otro).not.toHaveBeenCalled();
  });

  it('off stops delivering and does not affect the other listeners', async () => {
    const bus = createBus();
    const uno = vi.fn();
    const dos = vi.fn();
    const off = await bus.listen('x', uno);
    await bus.listen('x', dos);
    off();
    bus.emit('x', 1);
    expect(uno).not.toHaveBeenCalled();
    expect(dos).toHaveBeenCalledTimes(1);
  });

  it('un oyente que lanza no impide que el resto reciba el evento', async () => {
    const bus = createBus();
    const malo = vi.fn(() => {
      throw new Error('boom');
    });
    const bueno = vi.fn();
    await bus.listen('x', malo);
    await bus.listen('x', bueno);
    expect(() => bus.emit('x', 1)).not.toThrow();
    expect(bueno).toHaveBeenCalledTimes(1);
  });
});
