

export const SEARCH_DEBOUNCE_MS = 150;

/** Cards per page: with thousands of cards, the DOM and the thumbnails are limited to what is seen. */
export const PAGE_SIZE = 60;

/** At most one repaint of the grid every so often, even if cards keep arriving. */
export const RENDER_INTERVAL_MS = 100;

export const ALL = '';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text: the names come from the disk
  return e;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Fills a <select> with "All" and `values`, keeping the choice if it still exists. */
export function fillSelect(sel: HTMLSelectElement, label: string, values: string[], text: (v: string) => string = (v) => v): void {
  const key = values.join('\n');
  if (sel.dataset.options === key) return;
  const prev = sel.value;
  sel.dataset.options = key;
  const option = (value: string, text: string) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
  };
  sel.replaceChildren(option(ALL, label), ...values.map((v) => option(v, text(v))));
  sel.value = values.includes(prev) ? prev : ALL;
}
