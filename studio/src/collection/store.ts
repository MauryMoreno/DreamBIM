// Cache of the cards: data of the file (CardInfo) and thumbnail, by path + modification date.
// In IndexedDB so it survives between sessions; without it (or if it fails) it stays in memory.
import type { LibraryEntry } from '../library/librarypanel';
import type { CardInfo } from './cardinfo';

export interface CardRecord {
  info?: CardInfo;
  /** Mensaje de un archivo que no se pudo leer o analizar. */
  error?: string;
  /** Miniatura como data URL. */
  thumb?: string;
}

export interface CardStore {
  get(key: string): Promise<CardRecord | undefined>;
  /** Fusiona con lo que ya hubiera bajo la clave. */
  put(key: string, rec: CardRecord): Promise<void>;
}

/** Cambia si el archivo cambia en disco. */
export const cardKey = (e: LibraryEntry): string => `${e.path}|${e.mtime ?? 0}`;

export function memoryStore(): CardStore {
  const m = new Map<string, CardRecord>();
  return {
    async get(key) {
      return m.get(key);
    },
    async put(key, rec) {
      m.set(key, { ...m.get(key), ...rec });
    },
  };
}

const STORE = 'cards';

const wrap = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function indexedDbStore(dbName = 'ifcx-studio.collection.v2'): CardStore {
  const fallback = memoryStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> =>
    (db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null); // sin IndexedDB
      }
    }));
  return {
    async get(key) {
      const d = await open();
      if (!d) return fallback.get(key);
      try {
        return (await wrap(d.transaction(STORE).objectStore(STORE).get(key))) as CardRecord | undefined;
      } catch {
        return fallback.get(key);
      }
    },
    async put(key, rec) {
      const d = await open();
      if (!d) return fallback.put(key, rec);
      try {
        const prev = (await wrap(d.transaction(STORE).objectStore(STORE).get(key))) as CardRecord | undefined;
        await wrap(d.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...prev, ...rec }, key));
      } catch {
        await fallback.put(key, rec);
      }
    },
  };
}
