import { Collection } from './types';
import { message } from './helpers';
import { scanLibrary } from '../scan';
import type { CollectionContext } from './context';

export function installApi(ctx: CollectionContext): void {
  ctx.placeSync = null;

  const col: Collection = {
    async setFolder(dir) {
      ctx.active = true;
      const t = ++ctx.ticket;
      ctx.indexer.cancel();
      ctx.root = dir;
      ctx.files = [];
      ctx.error = null;
      ctx.complete = false;
      ctx.page = 0;
      ctx.records.clear();
      ctx.entries.clear();
      ctx.numbers.clear();
      ctx.cards.clear();
      ctx.wanted.clear();
      ctx.progress.hidden = true;
      if (dir) {
        try {
          const r = await scanLibrary(dir, ctx.cb.list);
          if (t !== ctx.ticket) return;
          ctx.files = r.files;
          ctx.files.forEach((f, i) => {
            ctx.entries.set(f.path, f);
            ctx.numbers.set(f.path, i + 1);
          });
        } catch (e) {
          if (t !== ctx.ticket) return;
          ctx.error = message(e);
        }
      }
      ctx.render();
      if (ctx.root && !ctx.error && ctx.files.length) ctx.indexer.run(ctx.files, ctx.root);
    },
    setCanPlace(on) {
      ctx.canPlace = on;
      ctx.placeSync?.();
    },
    onShow() {
      ctx.active = true;
      // the thumbnails that were discarded when the screen was hidden are requested again
      for (const [path, c] of ctx.cards) {
        if (!ctx.records.get(path)?.info || ctx.records.get(path)?.thumb || c.querySelector('img') || ctx.wanted.has(path)) continue;
        if (ctx.observer) ctx.observer.observe(c);
        else ctx.requestThumb(path);
      }
      if (ctx.root && !ctx.error && ctx.files.length && !ctx.complete) ctx.indexer.run(ctx.files, ctx.root);
    },
    onHide() {
      ctx.active = false;
      ctx.closeLarge?.();
      ctx.indexer.cancel();
    },
  };
  ctx.col = col;
}
