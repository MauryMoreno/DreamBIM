import { el } from './helpers';
import { renderCard, renderErrorCard } from '../card';
import { cardKey } from '../store';
import type { CollectionContext } from './context';

export function installThumbs(ctx: CollectionContext): void {
  // --- miniaturas: se piden al entrar la carta en pantalla y se dibujan de una en una ---------
  const wanted = new Set<string>();
  ctx.wanted = wanted;

  let queue: Promise<void> = Promise.resolve();

  /** Visible: oculta, no se dibujan miniaturas ni responde a Esc. Se activa con setFolder u onShow. */
  ctx.active = false;

  const setThumb = (path: string, url: string): void => {
    const art = ctx.cards.get(path)?.querySelector('.card-art');
    if (!art || art.querySelector('img')) return;
    const img = el('img', 'card-thumb');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    art.append(img);
  };
  ctx.setThumb = setThumb;

  const requestThumb = (path: string): void => {
    if (wanted.has(path) || ctx.records.get(path)?.thumb) return;
    wanted.add(path);
    const t = ctx.ticket;
    queue = queue.then(async () => {
      const entry = ctx.entries.get(path);
      // discarded (screen hidden, another folder or the card is no longer on the page): it will be requested when it is seen again
      if (!ctx.active || t !== ctx.ticket || !entry || !ctx.cards.get(path)?.isConnected) {
        wanted.delete(path);
        return;
      }
      try {
        const url = ctx.deps.renderThumb(await ctx.indexer.load(path));
        if (!url || t !== ctx.ticket) return;
        ctx.records.set(path, { ...ctx.records.get(path), thumb: url });
        await ctx.deps.store.put(cardKey(entry), { thumb: url });
        setThumb(path, url);
      } catch {
        /* sin miniatura: la carta se queda con el hueco */
      }
    });
  };
  ctx.requestThumb = requestThumb;

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((list) => {
          for (const o of list) {
            if (!o.isIntersecting) continue;
            observer?.unobserve(o.target);
            const path = (o.target as HTMLElement).dataset.path;
            if (path) requestThumb(path);
          }
        });
  ctx.observer = observer;

  const cardFor = (path: string): HTMLElement | null => {
    const rec = ctx.records.get(path);
    const entry = ctx.entries.get(path);
    if (!rec || !entry) return null;
    let c = ctx.cards.get(path);
    if (!c) {
      c = rec.info ? renderCard(rec.info, 'small', { thumb: rec.thumb, number: ctx.numbers.get(path) }) : renderErrorCard(entry.name, rec.error ?? '');
      c.dataset.path = path;
      c.tabIndex = 0;
      c.setAttribute('role', 'button');
      ctx.cards.set(path, c);
      if (rec.info) {
        c.addEventListener('click', () => ctx.openLarge(path));
        c.addEventListener('keydown', (k) => {
          if (k.key !== 'Enter') return;
          k.preventDefault();
          ctx.openLarge(path);
        });
        if (observer) observer.observe(c);
        else requestThumb(path);
      }
    }
    return c;
  };
  ctx.cardFor = cardFor;
}
