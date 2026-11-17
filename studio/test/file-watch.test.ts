import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileWatcher } from '../src/model/watch';

describe('vigilar el archivo abierto en disco', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(onChange = vi.fn(async () => {})) {
    let mtime: number | null = 100;
    const w = createFileWatcher({ mtime: vi.fn(async () => mtime), onChange, every: 1000 });
    return { w, onChange, set: (m: number | null) => { mtime = m; } };
  }

  it('it notifies once when the file changes on disk', async () => {
    const { w, onChange, set } = setup();
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).not.toHaveBeenCalled();
    set(200);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledWith('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('volver a mirar el mismo archivo tras guardarlo no lo da por cambiado', async () => {
    const { w, onChange, set } = setup();
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    set(300); // lo acaba de guardar Studio
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('si recargar falla (archivo a medio escribir), lo reintenta en la siguiente vuelta', async () => {
    const onChange = vi.fn().mockRejectedValueOnce(new Error('Not a valid IFCX file')).mockResolvedValue(undefined);
    const { w, set } = setup(onChange);
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    set(400);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a file that disappears is not considered changed', async () => {
    const { w, onChange, set } = setup();
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    set(null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sin archivo (documento nuevo o cerrado) no mira nada', async () => {
    const { w, onChange, set } = setup();
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    w.watch(null);
    set(500);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop deja de mirar', async () => {
    const { w, onChange, set } = setup();
    w.watch('C:/p/a.ifcx');
    await vi.advanceTimersByTimeAsync(1000);
    w.stop();
    set(600);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
