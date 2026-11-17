import { afterEach, describe, expect, it } from 'vitest';
import { cardKey, indexedDbStore, memoryStore } from '../src/collection/store';

describe('CardStore', () => {
  it('fromFile ignores nodes without a valid diffuseColor', async () => {
    const s = memoryStore();
    await s.put('k', { error: 'x' });
    await s.put('k', { thumb: 'data:image/png;base64,AA' });
    expect(await s.get('k')).toEqual({ error: 'x', thumb: 'data:image/png;base64,AA' });
    expect(await s.get('otra')).toBeUndefined();
  });

  it('cardKey cambia con mtime', () => {
    const a = cardKey({ name: 'a', path: '/p/a.ifcx', isDir: false, mtime: 1 });
    expect(cardKey({ name: 'a', path: '/p/a.ifcx', isDir: false, mtime: 2 })).not.toBe(a);
    expect(cardKey({ name: 'a', path: '/p/a.ifcx', isDir: false })).toBe('/p/a.ifcx|0');
  });

  describe('sin IndexedDB', () => {
    const real = (globalThis as { indexedDB?: unknown }).indexedDB;
    afterEach(() => {
      (globalThis as { indexedDB?: unknown }).indexedDB = real;
    });

    it('indexedDbStore funciona en memoria', async () => {
      (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
      const s = indexedDbStore('test-db');
      await s.put('k', { error: 'e' });
      expect(await s.get('k')).toEqual({ error: 'e' });
    });
  });
});
