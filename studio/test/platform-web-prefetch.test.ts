import { describe, expect, it, vi } from 'vitest';
import { webFiles } from '../src/platform/web-files';

const BASE = 'https://demo.test/';
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** fake fetch: index.json with `closure`, and body `body:<path>` for the files that exist (or pending forever). */
function setup(closure: Record<string, string[]>, opts: { missing?: string[]; hang?: boolean } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn((url: string) => {
    calls.push(url);
    if (url === `${BASE}Snowdon%20Towers%20Example/index.json`) return Promise.resolve(new Response(JSON.stringify({ entries: [], closure })));
    const path = decodeURI(url.slice(BASE.length - 1));
    if (opts.hang && path !== '/Snowdon Towers Example/m.ifcx') return new Promise<Response>(() => {});
    if (opts.missing?.includes(path)) return Promise.resolve(new Response('no', { status: 404 }));
    return Promise.resolve(new Response(`body:${path}`));
  });
  const files = webFiles({ fetch: fetchMock as unknown as typeof fetch, base: BASE, save: () => {} });
  const fetched = (path: string) => calls.filter((u) => decodeURI(u) === `${BASE}${path.slice(1)}`).length;
  return { files, fetched, calls };
}

describe('platform/web-files: precarga en paralelo de las importaciones de un modelo', () => {
  const closure = { '/Snowdon Towers Example/m.ifcx': ['/Snowdon Towers Example/a.ifcx', '/Snowdon Towers Example/b.ifcx', '/Snowdon Towers Example/dir/c d.ifcx'] };

  it('when reading a model with a known closure, it requests its imports and the later read does not repeat the request', async () => {
    const { files, fetched } = setup(closure);
    await files.readText('/Snowdon Towers Example/m.ifcx');
    await tick();
    await tick();
    expect(fetched('/Snowdon Towers Example/a.ifcx')).toBe(1);
    expect(fetched('/Snowdon Towers Example/b.ifcx')).toBe(1);
    expect(fetched('/Snowdon Towers Example/dir/c d.ifcx')).toBe(1);
    expect(await files.readText('/Snowdon Towers Example/a.ifcx')).toBe('body:/Snowdon Towers Example/a.ifcx');
    expect(await files.readText('/Snowdon Towers Example/dir/c d.ifcx')).toBe('body:/Snowdon Towers Example/dir/c d.ifcx');
    expect(fetched('/Snowdon Towers Example/a.ifcx')).toBe(1);
  });

  it('it does not request more than 16 at a time', async () => {
    const many = Array.from({ length: 40 }, (_, i) => `/Snowdon Towers Example/lib/f${i}.ifcx`);
    const { files, calls } = setup({ '/Snowdon Towers Example/m.ifcx': many }, { hang: true });
    await files.readText('/Snowdon Towers Example/m.ifcx');
    await tick();
    await tick();
    expect(calls.filter((u) => u.includes('/lib/'))).toHaveLength(16);
  });

  it('un modelo sin cierre conocido no precarga nada', async () => {
    const { files, calls } = setup(closure);
    await files.readText('/Snowdon Towers Example/otro.ifcx');
    await tick();
    await tick();
    expect(calls.filter((u) => !u.endsWith('index.json'))).toHaveLength(1);
  });

  it('si la precarga de un archivo falla, la lectura real da el error de ese archivo', async () => {
    const { files } = setup(closure, { missing: ['/Snowdon Towers Example/a.ifcx'] });
    await files.readText('/Snowdon Towers Example/m.ifcx');
    await tick();
    await tick();
    await expect(files.readText('/Snowdon Towers Example/a.ifcx')).rejects.toThrow('a.ifcx');
  });
});
