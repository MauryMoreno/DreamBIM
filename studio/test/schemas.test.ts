import { afterEach, describe, expect, it, vi } from 'vitest';
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIfcx, resolveStack } from '../src/ifcx/layers';
import { locateImport, offlineFetcher } from '../src/model/schemas';

const URIS = [
  'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
  'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx',
  'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
];

describe('esquemas empaquetados', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resuelve los tres esquemas sin red', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('sin red');
    });
    for (const uri of URIS) {
      const f = await offlineFetcher(uri);
      expect(Array.isArray(f.data)).toBe(true);
    }
  });

  it('URI desconocida va a la red', async () => {
    const stub = vi.fn(async () => new Response('{"data":[]}'));
    vi.stubGlobal('fetch', stub);
    const f = await offlineFetcher('https://x/y.ifcx');
    expect(f.data).toEqual([]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('a local path is read from disk with read_text_file', async () => {
    tauri.invoke.mockResolvedValueOnce('{"data":[]}');
    const f = await offlineFetcher('C:/p/FED/base.ifcx');
    expect(f.data).toEqual([]);
    expect(tauri.invoke).toHaveBeenCalledWith('read_text_file', { path: 'C:/p/FED/base.ifcx' });
  });

  it('un fallo de lectura llega como Error con el mensaje de Rust', async () => {
    tauri.invoke.mockRejectedValueOnce('The system cannot find the file');
    await expect(offlineFetcher('C:/p/no.ifcx')).rejects.toThrow('The system cannot find the file');
  });

  it('locateImport: relative ones against the file that declares them; remote and absolute ones as they are', () => {
    expect(locateImport('../../c/FED/base.ifcx', 'C:/p/c/EST/s.ifcx')).toBe('C:/p/c/FED/base.ifcx');
    expect(locateImport('./b.ifcx', 'C:\\p\\a.ifcx')).toBe('C:/p/b.ifcx');
    expect(locateImport(URIS[0], 'C:/p/a.ifcx')).toBe(URIS[0]);
    expect(locateImport('D:/x/b.ifcx', 'C:/p/a.ifcx')).toBe('D:/x/b.ifcx');
    expect(locateImport('./b.ifcx', undefined)).toBe('./b.ifcx');
  });

  it('hello-wall sin avisos', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('sin red');
    });
    const path = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/hello-wall.ifcx');
    const text = readFileSync(path, 'utf8');
    const st = await resolveStack(
      [{ id: '1', name: 'hw', file: parseIfcx(text), enabled: true }],
      offlineFetcher,
    );
    expect(st.imports.length).toBeGreaterThan(0);
    expect(st.imports.every((i) => i.ok)).toBe(true);
  });
});
