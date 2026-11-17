import { el } from './helpers';
import type { StageContext } from './context';

export function installChrome(ctx: StageContext): void {
  ctx.host.replaceChildren();

  ctx.host.classList.add('stage-panel', 'pb');

  const search = el('input', 'pb-search stage-search');
  ctx.search = search;

  search.type = 'search';

  search.placeholder = 'Search…';

  search.setAttribute('aria-label', 'Search the stage');

  const tree = el('div', 'stage-tree');
  ctx.tree = tree;

  tree.setAttribute('role', 'tree');

  tree.setAttribute('aria-label', 'Stage');

  const empty = el('div', 'pb-empty', 'No model loaded');
  ctx.empty = empty;

  ctx.host.append(search, empty);
}
