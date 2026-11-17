import { el } from './helpers';
import type { CollectionContext } from './context';

export function installChrome(ctx: CollectionContext): void {
  ctx.host.replaceChildren();

  ctx.host.classList.add('collection');

  const back = el('button', 'col-btn col-back', 'Back');

  back.title = 'Back (Esc)';

  back.type = 'button';

  back.addEventListener('click', () => ctx.cb.onBack());

  const disc = el('select', 'col-disc');
  ctx.disc = disc;

  disc.setAttribute('aria-label', 'Discipline');

  const cls = el('select', 'col-class');
  ctx.cls = cls;

  cls.setAttribute('aria-label', 'IFC class');

  const search = el('input', 'col-search');
  ctx.search = search;

  search.type = 'search';

  search.placeholder = 'Search…';

  search.setAttribute('aria-label', 'Search the collection');

  const progress = el('span', 'col-progress');
  ctx.progress = progress;

  progress.hidden = true;

  const pick = el('button', 'col-btn col-folder', 'Folder…');
  ctx.pick = pick;

  pick.type = 'button';

  pick.title = 'Choose the library folder';

  const bar = el('div', 'col-bar');

  const title = el('h1', 'col-title', 'Collection');

  const count = el('span', 'col-count');
  ctx.count = count;

  bar.append(back, title, count, disc, cls, progress, search, pick);

  const grid = el('div', 'col-grid');
  ctx.grid = grid;

  grid.setAttribute('aria-label', 'Collection');

  const empty = el('div', 'col-empty');
  ctx.empty = empty;

  const emptyText = el('span', 'col-empty-text');
  ctx.emptyText = emptyText;

  const choose = el('button', 'col-choose', 'Choose folder…');
  ctx.choose = choose;

  choose.type = 'button';

  empty.append(emptyText, choose);

  const prev = el('button', 'col-btn col-prev', 'Previous');
  ctx.prev = prev;

  prev.type = 'button';

  const next = el('button', 'col-btn col-next', 'Next');
  ctx.next = next;

  next.type = 'button';

  const pageText = el('span', 'col-page');
  ctx.pageText = pageText;

  pageText.setAttribute('aria-live', 'polite');

  const pager = el('nav', 'col-pager');
  ctx.pager = pager;

  pager.setAttribute('aria-label', 'Pages');

  pager.hidden = true;

  pager.append(prev, pageText, next);

  ctx.host.append(bar, grid, pager, empty);
}
