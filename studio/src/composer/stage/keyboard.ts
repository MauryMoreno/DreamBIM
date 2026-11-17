import { SEARCH_DEBOUNCE_MS } from './helpers';
import type { StageContext } from './context';

export function installKeyboard(ctx: StageContext): void {
  // --- Teclado: flechas para moverse y plegar ---------------------------------------------------
  ctx.tree.addEventListener('keydown', (e) => {
    if (!ctx.selected) return;
    const list = [...ctx.tree.querySelectorAll<HTMLElement>('.stage-row')];
    const i = list.findIndex((r) => r.dataset.path === ctx.selected);
    if (i < 0) return;
    const cur = list[i];
    const go = (r: HTMLElement | undefined) => {
      if (!r) return;
      ctx.setSelected(r.dataset.path!);
      r.focus();
      ctx.cb.onSelect(r.dataset.origin!, r.dataset.path!, false);
    };
    if (e.key === 'ArrowDown') go(list[i + 1]);
    else if (e.key === 'ArrowUp') go(list[i - 1]);
    else if (e.key === 'ArrowRight' && cur.getAttribute('aria-expanded') === 'false') ctx.toggleOpen(ctx.selected);
    else if (e.key === 'ArrowLeft' && cur.getAttribute('aria-expanded') === 'true') ctx.toggleOpen(ctx.selected);
    else if (e.key === 'Enter') ctx.cb.onFit?.(cur.dataset.origin!, cur.dataset.path!);
    else return;
    e.preventDefault();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;

  ctx.search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ctx.query = ctx.search.value.trim().toLowerCase();
      ctx.render();
    }, SEARCH_DEBOUNCE_MS);
  });
}
