import { load, type Store } from '@tauri-apps/plugin-store';

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: number;
  thumbnail: string | null;
}

export const MAX_RECENTS = 12;

const normalize = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

/** Windows: case-insensitive, and the backslash and the slash are the same. */
export function samePath(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

/** The most recent first; it replaces the entry of the same path and keeps its thumbnail if the new one has none. */
export function addRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const previous = list.find((r) => samePath(r.path, entry.path));
  const merged: RecentEntry = {
    ...entry,
    thumbnail: entry.thumbnail ?? previous?.thumbnail ?? null,
  };
  return [merged, ...list.filter((r) => !samePath(r.path, entry.path))].slice(0, MAX_RECENTS);
}

export function removeRecent(list: RecentEntry[], path: string): RecentEntry[] {
  return list.filter((r) => !samePath(r.path, path));
}

const FILE = 'recents.json';
const KEY = 'recents';

export class RecentsStore {
  private constructor(
    private readonly store: Store,
    private items: RecentEntry[],
  ) {}

  static async open(): Promise<RecentsStore> {
    const store = await load(FILE);
    const saved = await store.get<RecentEntry[]>(KEY);
    return new RecentsStore(store, Array.isArray(saved) ? saved : []);
  }

  list(): RecentEntry[] {
    return this.items;
  }

  async add(e: RecentEntry): Promise<void> {
    this.items = addRecent(this.items, e);
    await this.persist();
  }

  async remove(path: string): Promise<void> {
    this.items = removeRecent(this.items, path);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.store.set(KEY, this.items);
    await this.store.save();
  }
}
