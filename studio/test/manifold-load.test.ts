import { describe, it, expect, vi } from 'vitest';

describe('loadManifold', () => {
  it('reintenta tras una carga fallida y comparte la promesa en llamadas concurrentes', async () => {
    vi.resetModules();
    const setup = vi.fn();
    const modulo = vi.fn()
      .mockRejectedValueOnce(new Error('fallo wasm'))
      .mockResolvedValue({ setup });
    vi.doMock('manifold-3d', () => ({ default: modulo }));
    const { loadManifold } = await import('../src/modeling/manifold');

    const [a, b] = [loadManifold(), loadManifold()];
    expect(a).toBe(b);
    await expect(a).rejects.toThrow('fallo wasm');

    const ok = await loadManifold();
    expect(ok).toEqual({ setup });
    expect(modulo).toHaveBeenCalledTimes(2);
    expect(await loadManifold()).toBe(ok);
    expect(modulo).toHaveBeenCalledTimes(2);
    vi.doUnmock('manifold-3d');
  });
});
