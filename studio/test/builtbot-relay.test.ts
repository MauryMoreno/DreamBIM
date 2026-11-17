import { describe, expect, it, vi } from 'vitest';
import { installRelay, type EventRelay } from '../src/assistant/builtbot/relay';

describe('relevo de eventos en la ventana de Studio', () => {
  it('queda en window.__ifcxRelay y delega en el listen real', async () => {
    const off = vi.fn();
    const fakeListen = vi.fn(async () => off);
    const relay = installRelay(window, fakeListen as never);
    expect((window as unknown as { __ifcxRelay: EventRelay }).__ifcxRelay).toBe(relay);
    const cb = vi.fn();
    const baja = await relay.listen('chat://delta', cb);
    expect(fakeListen).toHaveBeenCalledWith('chat://delta', cb);
    baja();
    expect(off).toHaveBeenCalled();
  });

  it('sin invoke ni web queda como siempre: solo escucha', () => {
    const relay = installRelay(window, vi.fn() as never);
    expect(relay.invoke).toBeUndefined();
    expect(relay.web).toBeUndefined();
  });

  it('it blocks editing between the start and the end of the turn', async () => {
    const fakeInvoke = vi.fn(async () => 'ok');
    const relay = installRelay(window, vi.fn() as never, fakeInvoke, true);
    expect(relay.web).toBe(true);
    expect(await relay.invoke!('conv_request', { payload: { type: 'conv_list' } })).toBe('ok');
    expect(fakeInvoke).toHaveBeenCalledWith('conv_request', { payload: { type: 'conv_list' } });
    expect((window as unknown as { __ifcxRelay: EventRelay }).__ifcxRelay).toBe(relay);
  });
});
