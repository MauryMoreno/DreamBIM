// Background indexer of the Collection: it analyzes the cards one by one (with the worker parser)
// and stores in the cache the data of each card. Those already in the cache with the same date are not read.
import type { IfcxFile } from '../ifcx/types';
import type { LibraryEntry } from '../library/librarypanel';
import { cardInfo } from './cardinfo';
import { cardKey, type CardRecord, type CardStore } from './store';

export interface Indexer {
  /** Indexa `files`, de una en una; cancela la pasada anterior. */
  run(files: LibraryEntry[], root: string): void;
  cancel(): void;
  /** Reads and analyzes a card (thumbnail or big card); it does not go through the cache. */
  load(path: string): Promise<IfcxFile>;
}

export interface IndexerDeps {
  store: CardStore;
  readText(path: string): Promise<string>;
  parse(text: string): Promise<IfcxFile>;
  /** Ready card, from the cache or just computed. */
  onCard(path: string, rec: CardRecord): void;
  onProgress(done: number, total: number): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createIndexer(deps: IndexerDeps): Indexer {
  /** Each pass invalidates the previous ones. */
  let ticket = 0;
  const load = async (path: string) => deps.parse(await deps.readText(path));

  return {
    load,
    cancel() {
      ticket++;
    },
    run(files, root) {
      const t = ++ticket;
      void (async () => {
        let done = 0;
        for (const e of files) {
          const key = cardKey(e);
          let rec = await deps.store.get(key);
          if (t !== ticket) return;
          if (!rec?.info && !rec?.error) {
            try {
              rec = { ...rec, info: cardInfo(await load(e.path), e.path, root) };
            } catch (err) {
              rec = { error: message(err) };
            }
            if (t !== ticket) return;
            await deps.store.put(key, rec);
            if (t !== ticket) return;
          }
          deps.onCard(e.path, rec);
          deps.onProgress(++done, files.length);
        }
      })();
    },
  };
}
