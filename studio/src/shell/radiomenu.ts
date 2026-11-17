// Dropdown menu of radio options (Levels ▾ of the ribbon, Visual Style of the view bar).
// It is mounted on <body> while open; only one is open at a time. Esc or a click outside close it.

export interface RadioOption {
  value: string;
  label: string;
}

export interface RadioMenu {
  setSelected(value: string): void;
  close(): void;
}

let current: { anchor: HTMLElement; menu: RadioMenu } | null = null;

/**
 * Opens the menu below (or above) `anchor`; if it was already open for that button, it closes it and returns null.
 * Choosing an option closes the menu and calls `onChoose`; `onClose` reports any closing.
 */
export function toggleRadioMenu(
  anchor: HTMLElement,
  options: RadioOption[],
  selected: string | null,
  onChoose: (value: string) => void,
  opts: { above?: boolean; onClose?: () => void } = {},
): RadioMenu | null {
  const wasOpen = current?.anchor === anchor;
  current?.menu.close();
  if (wasOpen) return null;

  const root = document.createElement('div');
  root.className = 'ribbon-menu';
  root.setAttribute('role', 'menu');
  const items = new Map<string, HTMLElement>();
  for (const o of options) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theme-radio';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(selected === o.value));
    const mark = document.createElement('span');
    mark.className = 'theme-radio-mark';
    const text = document.createElement('span');
    text.textContent = o.label;
    item.append(mark, text);
    item.addEventListener('click', () => {
      menu.close();
      onChoose(o.value);
    });
    items.set(o.value, item);
    root.append(item);
  }

  const r = anchor.getBoundingClientRect();
  root.style.left = `${r.left}px`;
  if (opts.above) root.style.bottom = `${window.innerHeight - r.top}px`;
  else root.style.top = `${r.bottom}px`;
  document.body.append(root);
  anchor.setAttribute('aria-expanded', 'true');

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') menu.close();
  };
  const onDown = (e: Event): void => {
    if (!root.contains(e.target as Node) && !anchor.contains(e.target as Node)) menu.close();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);

  const menu: RadioMenu = {
    setSelected(value) {
      for (const [v, item] of items) item.setAttribute('aria-checked', String(v === value));
    },
    close() {
      if (current?.menu !== menu) return;
      current = null;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      root.remove();
      anchor.setAttribute('aria-expanded', 'false');
      opts.onClose?.();
    },
  };
  current = { anchor, menu };
  return menu;
}
