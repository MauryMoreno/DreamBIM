import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_ROOT, webFiles } from '../src/platform/web-files';

const BASE = 'https://demo.test/app/';
const INDEX = {
  featured: ['/Snowdon Towers Example/01_WIP/Z-9.ifcx', '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx', '/Snowdon Towers Example/no-esta.ifcx'],
  entries: [
    { path: '/Snowdon Towers Example/01_WIP', isDir: true, mtime: 0 },
    { path: '/Snowdon Towers Example/01_WIP/EST', isDir: true, mtime: 0 },
    { path: '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx', isDir: false, mtime: 111 },
    { path: '/Snowdon Towers Example/01_WIP/EST/s-0002.IFCX', isDir: false, mtime: 112 },
    { path: '/Snowdon Towers Example/01_WIP/EST/a b ñ.ifcx', isDir: false, mtime: 113 },
    { path: '/Snowdon Towers Example/01_WIP/Z-9.ifcx', isDir: false, mtime: 114 },
    { path: '/Snowdon Towers Example/biblioteca', isDir: true, mtime: 0 },
    { path: '/Snowdon Towers Example/biblioteca/Mesa.ifcx', isDir: false, mtime: 115 },
  ],
};

function net(bodies: Record<string, string> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === `${BASE}Snowdon%20Towers%20Example/index.json`) return new Response(JSON.stringify(INDEX));
    const body = bodies[url];
    return body === undefined ? new Response('no', { status: 404 }) : new Response(body);
  });
  return { fetchMock, files: webFiles({ fetch: fetchMock as unknown as typeof fetch, base: BASE, save: () => {} }) };
}

describe('platform/web-files: proyecto de ejemplo y memoria', () => {
  it('it reads by fetch encoding each segment of the path', async () => {
    const { fetchMock, files } = net({ [`${BASE}Snowdon%20Towers%20Example/01_WIP/EST/a%20b%20%C3%B1.ifcx`]: 'contenido' });
    expect(await files.readText('/Snowdon Towers Example/01_WIP/EST/a b ñ.ifcx')).toBe('contenido');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}Snowdon%20Towers%20Example/01_WIP/EST/a%20b%20%C3%B1.ifcx`);
  });

  it('& and , go unencoded in the URL (valid in a path; some servers do not decode them), + is encoded', async () => {
    const { fetchMock, files } = net({ [`${BASE}Snowdon%20Towers%20Example/b/Door & Drawer, 27 in + x.ifcx`.replace(/ /g, '%20').replace('+', '%2B')]: 'ok' });
    expect(await files.readText('/Snowdon Towers Example/b/Door & Drawer, 27 in + x.ifcx')).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}Snowdon%20Towers%20Example/b/Door%20&%20Drawer,%2027%20in%20%2B%20x.ifcx`);
  });

  it('un 404 rechaza con un Error que nombra el archivo', async () => {
    const { files } = net();
    await expect(files.readText('/Snowdon Towers Example/01_WIP/falta.ifcx')).rejects.toThrow('falta.ifcx');
  });

  it('what is written stays in memory and is read without network (the edited version wins over the published one)', async () => {
    const { fetchMock, files } = net({ [`${BASE}Snowdon%20Towers%20Example/x.ifcx`]: 'publicado' });
    await files.writeText('/Snowdon Towers Example/x.ifcx', 'nuevo');
    expect(await files.readText('/Snowdon Towers Example/x.ifcx')).toBe('nuevo');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('readBinary devuelve los bytes de la red y los de memoria', async () => {
    const { files } = net();
    files.memory.set('/local/p.pdf', new Uint8Array([7, 8]));
    expect(await files.readBinary('/local/p.pdf')).toEqual(new Uint8Array([7, 8]));
  });

  it('exists and mtime: index, memory and absent', async () => {
    const { files } = net();
    expect(await files.exists('/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx')).toBe(true);
    expect(await files.mtime('/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx')).toBe(111);
    expect(await files.exists('/Snowdon Towers Example/no.ifcx')).toBe(false);
    expect(await files.mtime('/Snowdon Towers Example/no.ifcx')).toBeNull();
    await files.writeText('/local/m.ifcx', 'x');
    expect(await files.exists('/local/m.ifcx')).toBe(true);
    expect(typeof (await files.mtime('/local/m.ifcx'))).toBe('number');
  });

  it('listDir returns the direct children: folders first and by name ignoring case', async () => {
    const { files } = net();
    expect((await files.listDir('/Snowdon Towers Example/01_WIP')).map((e) => [e.name, e.isDir])).toEqual([
      ['EST', true],
      ['Z-9.ifcx', false],
    ]);
    expect((await files.listDir('/Snowdon Towers Example/01_WIP/EST')).map((e) => e.name)).toEqual(['a b ñ.ifcx', 'S-0001.ifcx', 's-0002.IFCX']);
  });

  it('search: only .ifcx whose name contains the query, those closest to the root first, cut to limit', async () => {
    const { files } = net();
    expect((await files.search('/Snowdon Towers Example', 's-000', 5)).map((e) => e.name)).toEqual(['S-0001.ifcx', 's-0002.IFCX']);
    expect((await files.search('/Snowdon Towers Example', '.ifcx', 2)).map((e) => e.name)).toEqual(['Mesa.ifcx', 'Z-9.ifcx']);
    expect(await files.search('/Snowdon Towers Example', 'EST', 5)).toEqual([]); // las carpetas no cuentan
  });

  it('the index is requested only once', async () => {
    const { fetchMock, files } = net();
    await files.listDir('/Snowdon Towers Example');
    await files.listDir('/Snowdon Towers Example/01_WIP');
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('index.json'))).toHaveLength(1);
  });

  it('the default library is the root of the example project', () => {
    expect(net().files.defaultLibraryFolder()).toBe(SAMPLE_ROOT);
    expect(SAMPLE_ROOT).toBe('/Snowdon Towers Example');
  });

  it('examples returns the featured models of the index, in their order and only those that exist', async () => {
    const { files } = net();
    expect((await files.examples!()).map((e) => [e.name, e.path])).toEqual([
      ['Z-9.ifcx', '/Snowdon Towers Example/01_WIP/Z-9.ifcx'],
      ['S-0001.ifcx', '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx'],
    ]);
  });
});

