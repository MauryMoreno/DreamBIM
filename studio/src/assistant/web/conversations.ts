// Conversations of the Assistant in the web demo: in the browser's IndexedDB so they survive a reload, and in
// memory if there is no IndexedDB (private window, blocked data). It is the conscious exception to "the web demo
// stores nothing between reloads" (home/safe-recents.ts): it is valid only for the conversations.
// `messages` tiene la forma que guarda AI_Manage (infrastructure/storage/conversation_store.py), porque `conv_load`
// se la entrega tal cual a BuiltBot.

export interface SavedConversation {
  id: string;
  title: string;
  /** `YYYY-MM-DD HH:MM:SS`, como conversation_store.py. */
  updated_at: string;
  messages: unknown[];
  /** Skill integrada activa (su nombre), si la hay. */
  skill?: string;
  /** stableKey of the `build` whose `review_plan` last passed. */
  approved_build?: string;
  /** The model changed since the last approved `review_model`. */
  needs_model_review?: boolean;
}

export type ConversationSummary = Pick<SavedConversation, 'id' | 'title' | 'updated_at'>;

export interface ConversationStore {
  /** The most recent first. */
  list(): Promise<ConversationSummary[]>;
  load(id: string): Promise<SavedConversation | null>;
  save(c: SavedConversation): Promise<void>;
  remove(id: string): Promise<void>;
}

export function nowStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

interface Row extends SavedConversation {
  /** Save order: it breaks ties among those that share a timestamp (the seconds one repeats). */
  seq: number;
}

let lastSeq = 0;
const nextSeq = (): number => (lastSeq = Math.max(Date.now(), lastSeq + 1));

const summary = (r: Row): ConversationSummary => ({ id: r.id, title: r.title, updated_at: r.updated_at });
const newestFirst = (a: Row, b: Row): number =>
  a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.seq - a.seq;
const copy = <T>(v: T): T => structuredClone(v);
const toConversation = (r: Row): SavedConversation => ({
  id: r.id,
  title: r.title,
  updated_at: r.updated_at,
  messages: copy(r.messages),
  ...(r.skill !== undefined ? { skill: r.skill } : {}),
  ...(r.approved_build !== undefined ? { approved_build: r.approved_build } : {}),
  ...(r.needs_model_review ? { needs_model_review: true } : {}),
});

export function memoryConversations(): ConversationStore {
  const rows = new Map<string, Row>();
  return {
    async list() {
      return [...rows.values()].sort(newestFirst).map(summary);
    },
    async load(id) {
      const r = rows.get(id);
      return r ? toConversation(r) : null;
    },
    async save(c) {
      rows.set(c.id, { ...copy(c), seq: nextSeq() });
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

const STORE = 'conversations';

const wrap = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export function idbConversations(dbName = 'ifcx-studio.assistant.v1'): ConversationStore {
  const fallback = memoryConversations();
  let db: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> =>
    (db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null); // sin IndexedDB
      }
    }));

  return {
    async list() {
      const d = await open();
      if (!d) return fallback.list();
      try {
        const rows = (await wrap(d.transaction(STORE).objectStore(STORE).getAll())) as Row[];
        return rows.sort(newestFirst).map(summary);
      } catch {
        return fallback.list();
      }
    },
    async load(id) {
      const d = await open();
      if (!d) return fallback.load(id);
      try {
        const r = (await wrap(d.transaction(STORE).objectStore(STORE).get(id))) as Row | undefined;
        return r ? toConversation(r) : null;
      } catch {
        return fallback.load(id);
      }
    },
    async save(c) {
      const d = await open();
      if (!d) return fallback.save(c);
      try {
        await wrap(d.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...copy(c), seq: nextSeq() }));
      } catch {
        await fallback.save(c);
      }
    },
    async remove(id) {
      const d = await open();
      if (!d) return fallback.remove(id);
      try {
        await wrap(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
      } catch {
        await fallback.remove(id);
      }
    },
  };
}
