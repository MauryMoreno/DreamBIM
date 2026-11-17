import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineFetcher } from '../src/model/schemas';
import { InvalidModelError, composeLayers, loadModel, parseLayer } from '../src/model/load';

describe('loadModel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carga hello-wall', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('sin red');
    });
    const path = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/hello-wall.ifcx');
    const text = readFileSync(path, 'utf8');
    const m = await loadModel('hello-wall', path, text, offlineFetcher);
    expect(m.result.byPath.size).toBeGreaterThan(0);
    expect(m.warnings).toEqual([]);
    expect(m.name).toBe('hello-wall');
    expect(m.path).toBe(path);
  });

  it('texto no JSON', async () => {
    const p = loadModel('x', 'x', 'hola');
    await expect(p).rejects.toBeInstanceOf(InvalidModelError);
    await expect(p).rejects.toThrow(/^Not a valid IFCX file:/);
  });

  it('JSON sin data', async () => {
    const p = loadModel('x', 'x', '{"a":1}');
    await expect(p).rejects.toBeInstanceOf(InvalidModelError);
    await expect(p).rejects.toThrow(/^Not a valid IFCX file:/);
  });

  it('import inaccesible no bloquea', async () => {
    const text = JSON.stringify({ imports: [{ uri: 'https://nope/x.ifcx' }], data: [{ path: 'a' }] });
    const fetcher = vi.fn(async () => {
      throw new Error('sin red');
    });
    const m = await loadModel('x', null, text, fetcher);
    expect(m.warnings[0]).toMatch(/^Import unavailable: https:\/\/nope\/x\.ifcx/);
    expect(m.result).toBeDefined();
  });
});

describe('composeLayers', () => {
  const text = (path: string) => JSON.stringify({ data: [{ path }] });

  it('it composes the active extra layers on top of the document', async () => {
    const base = (await loadModel('a', null, text('uno'))).layer!;
    const extra = parseLayer('2', 'b', text('dos'));
    const both = await composeLayers('a', null, base, [extra]);
    expect([...both.result.byPath.keys()].some((k) => k.includes('uno'))).toBe(true);
    expect([...both.result.byPath.keys()].some((k) => k.includes('dos'))).toBe(true);
    const off = await composeLayers('a', null, base, [{ ...extra, enabled: false }]);
    expect([...off.result.byPath.keys()].some((k) => k.includes('dos'))).toBe(false);
  });

  it('parseLayer rechaza lo que no es IFCx', () => {
    expect(() => parseLayer('2', 'x', 'hola')).toThrow(InvalidModelError);
  });
});
