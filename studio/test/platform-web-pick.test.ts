import { describe, expect, it, vi } from 'vitest';
import { webFiles } from '../src/platform/web-files';

const file = (name: string, content: string | Uint8Array) => new File([content as BlobPart], name);

function web(picked: File[]) {
  const pickNative = vi.fn(async (_accept: string, _multiple: boolean) => picked);
  const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
  return { pickNative, fetchMock, files: webFiles({ pickNative, fetch: fetchMock as unknown as typeof fetch, base: 'https://demo.test/', save: () => {} }) };
}

describe('platform/web-files: own dialogs and files', () => {
  it('pickOpen requests the files with their extensions and returns the first one; the others stay in memory', async () => {
    const { pickNative, files } = web([file('a.ifcx', 'A'), file('b.ifcx', 'B')]);
    expect(await files.pickOpen([{ name: 'IFCx Model', extensions: ['ifcx'] }], { multiple: true })).toBe('/local/a.ifcx');
    expect(pickNative).toHaveBeenCalledWith('.ifcx', true);
    expect(await files.readText('/local/a.ifcx')).toBe('A');
    expect(await files.readText('/local/b.ifcx')).toBe('B');
  });

  it('prefiere el primer .ifcx aunque no sea el primer archivo', async () => {
    const { files } = web([file('precios.csv', 'x'), file('m.ifcx', 'M')]);
    expect(await files.pickOpen([{ name: 'x', extensions: ['ifcx', 'csv'] }], { multiple: true })).toBe('/local/m.ifcx');
  });

  it('si el visitante cancela, devuelve null', async () => {
    const { files } = web([]);
    expect(await files.pickOpen([{ name: 'IFCx Model', extensions: ['ifcx'] }])).toBeNull();
  });

  it('a relative import is resolved by name among the chosen files', async () => {
    const { files, fetchMock } = web([file('a.ifcx', 'A'), file('Z-0001.ifcx', 'Z')]);
    await files.pickOpen([{ name: 'IFCx Model', extensions: ['ifcx'] }], { multiple: true });
    expect(await files.readText('/02_COMPARTIDO/FED/Z-0001.ifcx')).toBe('Z');
    expect(await files.exists('/02_COMPARTIDO/FED/Z-0001.ifcx')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('if the companion is missing, the error says which one is missing and how to add it', async () => {
    const { files } = web([file('a.ifcx', 'A')]);
    await files.pickOpen([{ name: 'IFCx Model', extensions: ['ifcx'] }], { multiple: true });
    await expect(files.readText('/02_COMPARTIDO/FED/Z-0001.ifcx')).rejects.toThrow(
      'Missing Z-0001.ifcx. Select it together with the model, both in the same folder.',
    );
    expect(await files.exists('/02_COMPARTIDO/FED/Z-0001.ifcx')).toBe(false);
  });

  it('un PDF elegido se guarda como bytes y readBinary lo devuelve igual', async () => {
    const { files } = web([file('cotizacion.pdf', new Uint8Array([1, 2, 3]))]);
    const path = await files.pickOpen([{ name: 'Quote', extensions: ['pdf'] }]);
    expect(path).toBe('/local/cotizacion.pdf');
    expect(await files.readBinary(path!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('pickSave keeps the folder of an absolute path, so that relative imports stay valid', async () => {
    const { files } = web([]);
    const f = [{ name: 'IFCx Model', extensions: ['ifcx'] }];
    expect(await files.pickSave('/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx', f)).toBe('/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx');
    expect(await files.pickSave('/local/a.ifcx', f)).toBe('/local/a.ifcx');
    expect(await files.pickSave('Nuevo.ifcx', f)).toBe('/local/Nuevo.ifcx');
  });

  it('pickSave returns /local/<name> without a dialog and pickFolder the root of the example project', async () => {
    const { pickNative, files } = web([]);
    expect(await files.pickSave(String.raw`C:\x\Modelo.ifcx`, [{ name: 'IFCx Model', extensions: ['ifcx'] }])).toBe('/local/Modelo.ifcx');
    expect(await files.pickFolder()).toBe('/Snowdon Towers Example');
    expect(pickNative).not.toHaveBeenCalled();
  });
});
