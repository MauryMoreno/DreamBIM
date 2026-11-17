import { beforeEach, describe, expect, it } from 'vitest';
import { loadAddin, showAddinDialog } from '../src/home/addin';

const ok = { file: 'IFCx-Revit-2026-a.zip', version: 'a', sizeMB: 75, source: 'IFCx-Revit-2026-a-src.zip' };
const res = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('add-in de Revit', () => {
  it('lee el manifiesto y arma las URL sobre la base', async () => {
    expect(await loadAddin('/', res(JSON.stringify(ok)))).toEqual({
      url: '/descargas/IFCx-Revit-2026-a.zip',
      sourceUrl: '/descargas/IFCx-Revit-2026-a-src.zip',
      version: 'a',
      sizeMB: 75,
    });
  });

  it('404 da null', async () => expect(await loadAddin('/', res('', 404))).toBeNull());

  it('HTML en vez de JSON (el index de respaldo) da null', async () => expect(await loadAddin('/', res('<!doctype html>'))).toBeNull());

  it('campos que faltan o de otro tipo dan null', async () => {
    expect(await loadAddin('/', res(JSON.stringify({ ...ok, source: undefined })))).toBeNull();
    expect(await loadAddin('/', res(JSON.stringify({ ...ok, sizeMB: '75' })))).toBeNull();
  });

  it('un nombre de archivo con barra o ".." da null', async () => {
    expect(await loadAddin('/', res(JSON.stringify({ ...ok, file: '../x.zip' })))).toBeNull();
  });

  it('si fetch lanza, da null', async () => {
    expect(
      await loadAddin(
        '/',
        (async () => {
          throw new Error('offline');
        }) as unknown as typeof fetch,
      ),
    ).toBeNull();
  });

  it('the dialog links the download and the source code and closes with Close', () => {
    showAddinDialog({ url: '/descargas/a.zip', sourceUrl: '/descargas/a-src.zip', version: 'a', sizeMB: 75 });
    const links = [...document.querySelectorAll('a')];
    expect(links.find((l) => l.textContent?.includes('Download'))?.getAttribute('href')).toBe('/descargas/a.zip');
    expect(links.find((l) => l.textContent?.includes('Download'))?.textContent).toContain('75 MB');
    expect(links.find((l) => l.textContent === 'Source code')?.getAttribute('href')).toBe('/descargas/a-src.zip');
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Close')!.click();
    expect(document.querySelector('a[href="/descargas/a.zip"]')).toBeNull();
  });
});
