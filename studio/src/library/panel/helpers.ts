

export const SEARCH_DEBOUNCE_MS = 150;

/** Width of the cards (px) and limits of the zoom control. */
export const TILE_MIN = 64;

export const TILE_MAX = 140;

export const TILE_DEFAULT = 84;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text: the names come from the disk
  return e;
}

export function button(cls: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Name without the .ifcx extension. */
export const stem = (name: string) => name.replace(/\.ifcx$/i, '');

/** Separa una ruta de Windows o POSIX en sus componentes. */
export const parts = (p: string) => p.split(/[\\/]/).filter(Boolean);

export const sep = (p: string) => (p.includes('\\') ? '\\' : '/');
