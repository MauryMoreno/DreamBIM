import { describe, expect, it, vi } from 'vitest';
import type { IfcxFile } from '../src/ifcx/types';
import type { LibraryEntry } from '../src/library/librarypanel';
import { createIndexer } from '../src/collection/indexer';
import { cardKey, memoryStore, type CardRecord } from '../src/collection/store';

const entry = (n: string, mtime = 1): LibraryEntry => ({ name: `${n}.ifcx`, path: `/lib/hvac/${n}.ifcx`, isDir: false, mtime });
const fileOf = (name: string): IfcxFile => ({
  header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' },
  imports: [],
  schemas: {},
  data: [{ path: 'r', attributes: { 'bsi::ifc::class': { code: 'IfcAirTerminal' }, 'bsi::ifc::prop::Name': name } }],
});

function setup(opts: { broken?: string } = {}) {
  const store = memoryStore();
  const cards = new Map<string, CardRecord>();
  const progress: [number, number][] = [];
  const readText = vi.fn(async (p: string) => p);
  const parse = vi.fn(async (text: string) => {
    if (opts.broken && text.includes(opts.broken)) throw new Error('Not a valid IFCX file: boom');
    return fileOf(text.split('/').at(-1)!.replace('.ifcx', ''));
  });
  const indexer = createIndexer({
    store,
    readText,
    parse,
    onCard: (p, rec) => cards.set(p, rec),
    onProgress: (d, t) => progress.push([d, t]),
  });
  return { store, cards, progress, readText, parse, indexer };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('createIndexer', () => {
  it('Collection: grid', async () => {
    const s = setup();
    const e = entry('a');
    await s.store.put(cardKey(e), { info: { name: 'guardada' } as never });
    s.indexer.run([e], '/lib');
    await settle();
    expect(s.readText).not.toHaveBeenCalled();
    expect((s.cards.get(e.path)!.info as { name: string }).name).toBe('guardada');
  });

  it('con otro mtime recalcula y guarda bajo la clave nueva', async () => {
    const s = setup();
    await s.store.put(cardKey(entry('a', 1)), { info: { name: 'vieja' } as never });
    const nueva = entry('a', 2);
    s.indexer.run([nueva], '/lib');
    await settle();
    expect(s.readText).toHaveBeenCalledWith(nueva.path);
    expect((await s.store.get(cardKey(nueva)))!.info!.name).toBe('a');
  });

  it('un archivo roto no para la pasada', async () => {
    const s = setup({ broken: 'b.ifcx' });
    const files = [entry('a'), entry('b'), entry('c')];
    s.indexer.run(files, '/lib');
    await settle();
    expect(s.cards.get(files[1].path)!.error).toBe('Not a valid IFCX file: boom');
    expect(s.cards.get(files[0].path)!.info).toBeDefined();
    expect(s.cards.get(files[2].path)!.info).toBeDefined();
    expect(s.progress.at(-1)).toEqual([3, 3]);
    expect((await s.store.get(cardKey(files[1])))!.error).toBeDefined();
  });

  it('cancel corta la pasada', async () => {
    const s = setup();
    s.indexer.run([entry('a'), entry('b'), entry('c')], '/lib');
    s.indexer.cancel();
    await settle();
    expect(s.cards.size).toBe(0);
  });

  it('un run nuevo cancela el anterior', async () => {
    const s = setup();
    s.indexer.run([entry('a'), entry('b')], '/lib');
    s.indexer.run([entry('z')], '/lib');
    await settle();
    expect([...s.cards.keys()]).toEqual(['/lib/hvac/z.ifcx']);
  });
});
