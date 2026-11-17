import { isWeb } from '../platform/env';
import { addRecent, removeRecent, RecentsStore, type RecentEntry } from './recents';

export interface RecentsLike {
  list(): RecentEntry[];
  add(e: RecentEntry): Promise<void>;
  remove(path: string): Promise<void>;
}

/** In-memory list only: used if the on-disk store is corrupt or does not open. */
class MemoryRecents implements RecentsLike {
  private items: RecentEntry[] = [];
  list() {
    return this.items;
  }
  async add(e: RecentEntry) {
    this.items = addRecent(this.items, e);
  }
  async remove(path: string) {
    this.items = removeRecent(this.items, path);
  }
}

/** Opens the recents store; if it fails, nothing is shown and the app keeps working. */
export async function openRecentsSafe(): Promise<RecentsLike> {
  if (isWeb()) return new MemoryRecents(); // la demo web no guarda nada entre recargas
  try {
    return await RecentsStore.open();
  } catch (e) {
    console.warn('No se pudo abrir la lista de recientes:', e);
    return new MemoryRecents();
  }
}
