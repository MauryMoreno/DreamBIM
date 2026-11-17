import { SEARCH_DEBOUNCE_MS, RENDER_INTERVAL_MS, fillSelect } from './helpers';
import { DISCIPLINES, disciplineLabel } from '../card';
import type { CardInfo } from '../cardinfo';
import type { CollectionContext } from './context';

export function installFilters(ctx: CollectionContext): void {
  // --- filtros y pintado -----------------------------------------------------------------------
  const infos = (): CardInfo[] => [...ctx.records.values()].flatMap((r) => (r.info ? [r.info] : []));

  /** Largest measurement of the indexed library on each axis: the bars of the big card are measured against it. */
  const statMax = (): CardInfo['dims'] => {
    const max: CardInfo['dims'] = {};
    for (const i of infos()) {
      for (const k of ['width', 'depth', 'height'] as const) {
        const v = i.dims[k];
        if (v !== undefined && v > (max[k] ?? 0)) max[k] = v;
      }
    }
    return max;
  };
  ctx.statMax = statMax;

  const matches = (i: CardInfo): boolean =>
    (!ctx.disc.value || i.discipline === ctx.disc.value) &&
    (!ctx.cls.value || i.ifcClass === ctx.cls.value) &&
    (!ctx.query || [i.name, i.reference, i.description].some((t) => t?.toLowerCase().includes(ctx.query)));

  const render = (): void => {
    const all = infos();
    const known = [...new Set(all.map((i) => i.discipline).filter(Boolean))];
    known.sort((a, b) => {
      const ia = (DISCIPLINES as readonly string[]).indexOf(a);
      const ib = (DISCIPLINES as readonly string[]).indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    fillSelect(ctx.disc, 'All disciplines', known, disciplineLabel);
    fillSelect(ctx.cls, 'All classes', [...new Set(all.map((i) => i.ifcClass).filter((c): c is string => !!c))].sort());

    const filtering = !!(ctx.disc.value || ctx.cls.value || ctx.query);
    const matched = ctx.files.filter((f) => {
      const rec = ctx.records.get(f.path);
      if (!rec) return false;
      return rec.info ? matches(rec.info) : !filtering; // las de error solo sin filtros
    });
    const pages = Math.max(1, Math.ceil(matched.length / ctx.pageSize));
    ctx.page = Math.min(ctx.page, pages - 1);
    const from = ctx.page * ctx.pageSize;
    const slice = matched.slice(from, from + ctx.pageSize);
    ctx.grid.replaceChildren(...slice.flatMap((f) => ctx.cardFor(f.path) ?? []));
    ctx.pageText.textContent = `${(from + 1).toLocaleString('en-US')}–${(from + slice.length).toLocaleString('en-US')} of ${matched.length.toLocaleString('en-US')}`;
    ctx.prev.disabled = ctx.page === 0;
    ctx.next.disabled = ctx.page >= pages - 1;
    const indexed = ctx.files.filter((f) => ctx.records.has(f.path)).length;
    ctx.count.textContent = !ctx.files.length ? '' : matched.length === indexed ? `${indexed.toLocaleString('en-US')} items` : `${matched.length.toLocaleString('en-US')} of ${indexed.toLocaleString('en-US')}`;

    const msg =
      !ctx.root ? 'Choose a folder with .ifcx files to use as the library'
      : ctx.error ? ctx.error
      : !ctx.files.length ? 'No .ifcx files in this folder'
      : !matched.length ? (filtering ? 'No results' : ctx.complete ? 'No results' : 'Indexing…')
      : null;
    ctx.emptyText.textContent = msg ?? '';
    ctx.choose.hidden = ctx.root !== null && !ctx.error;
    ctx.empty.hidden = msg === null;
    ctx.grid.hidden = msg !== null;
    ctx.pager.hidden = msg !== null || matched.length <= ctx.pageSize;
    ctx.disc.disabled = ctx.cls.disabled = ctx.search.disabled = !ctx.root || !!ctx.error;
  };
  ctx.render = render;

  let renderTimer: ReturnType<typeof setTimeout> | undefined;

  let lastRender = 0;

  const scheduleRender = (): void => {
    if (renderTimer) return; // ya hay un repintado en camino
    // the first one comes out at once; the following ones, at most one per interval
    const wait = Math.max(0, RENDER_INTERVAL_MS - (Date.now() - lastRender));
    renderTimer = setTimeout(() => {
      renderTimer = undefined;
      lastRender = Date.now();
      render();
    }, wait);
  };

  const indexer = ctx.deps.createIndexer({
    onCard(path, rec) {
      if (!ctx.entries.has(path)) return;
      const prev = ctx.records.get(path);
      ctx.records.set(path, rec);
      if (prev && prev.error === rec.error && JSON.stringify(prev.info) === JSON.stringify(rec.info)) {
        if (rec.thumb && !prev.thumb) ctx.setThumb(path, rec.thumb); // the only new thing is the thumbnail
        return;
      }
      ctx.cards.delete(path); // the data changed: the card is painted again
      scheduleRender();
    },
    onProgress(d, total) {
      ctx.complete = d >= total;
      ctx.progress.hidden = ctx.complete;
      ctx.progress.textContent = `Indexing ${d} / ${total}`;
    },
  });
  ctx.indexer = indexer;

  const firstPage = (): void => {
    ctx.page = 0;
    render();
  };
  ctx.firstPage = firstPage;

  const goPage = (delta: number): void => {
    ctx.page += delta;
    render();
    ctx.grid.scrollTop = 0;
  };

  ctx.disc.addEventListener('change', firstPage);

  ctx.cls.addEventListener('change', firstPage);

  ctx.prev.addEventListener('click', () => goPage(-1));

  ctx.next.addEventListener('click', () => goPage(1));

  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  ctx.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      ctx.query = ctx.search.value.trim().toLowerCase();
      firstPage();
    }, SEARCH_DEBOUNCE_MS);
  });
}
