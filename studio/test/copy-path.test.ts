import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPath } from '../src/properties/copy';

describe('copyPath', () => {
  afterEach(() => vi.unstubAllGlobals());
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('sin portapapeles avisa del error y no lanza', () => {
    vi.stubGlobal('navigator', {});
    const notify = vi.fn();
    expect(() => copyPath('C:/p/a.ifcx', notify)).not.toThrow();
    expect(notify).toHaveBeenCalledWith('Could not copy the path', 'error');
  });

  it('a node with other keys keeps the rest', () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => { throw new Error('denied'); } } });
    const notify = vi.fn();
    expect(() => copyPath('x', notify)).not.toThrow();
    expect(notify).toHaveBeenCalledWith('Could not copy the path', 'error');
  });

  it('removing deletes the inheritance and the node if it is left empty', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } });
    const notify = vi.fn();
    copyPath('x', notify);
    await flush();
    expect(notify).toHaveBeenCalledWith('Could not copy the path', 'error');
  });

  it('copia y avisa Path copied', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const notify = vi.fn();
    copyPath('C:/p/a.ifcx', notify);
    await flush();
    expect(writeText).toHaveBeenCalledWith('C:/p/a.ifcx');
    expect(notify).toHaveBeenCalledWith('Path copied', 'info');
  });
});
