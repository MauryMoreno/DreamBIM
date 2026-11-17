import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../src/home/recents', async (orig) => {
  const real = await orig<typeof import('../src/home/recents')>();
  return { ...real, RecentsStore: { open: store.open } };
});

import { openRecentsSafe } from '../src/home/safe-recents';

describe('openRecentsSafe', () => {
  it('if the store fails, it returns an empty in-memory list that works', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.open.mockRejectedValue(new Error('corrupto'));
    const r = await openRecentsSafe();
    expect(r.list()).toEqual([]);
    await r.add({ path: 'C:\\a.ifcx', name: 'a.ifcx', openedAt: 1, thumbnail: null });
    expect(r.list().length).toBe(1);
    await r.remove('c:/A.ifcx');
    expect(r.list()).toEqual([]);
  });

  it('if it opens well, it returns the store', async () => {
    const fake = { list: () => [], add: vi.fn(), remove: vi.fn() };
    store.open.mockResolvedValue(fake);
    expect(await openRecentsSafe()).toBe(fake);
  });
});
