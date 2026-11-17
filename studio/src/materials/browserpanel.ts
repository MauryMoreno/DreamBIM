// Material Browser: list of the materials of the document with a search box. The rows are dragged onto the viewer.
import type { CatalogEntry } from './catalog';

/** Tipo del arrastre (dataTransfer): lleva el `code` del material. */
export const MATERIAL_DRAG_TYPE = 'application/x-ifcx-material';

export interface MaterialBrowserCallbacks {
  onSelect(code: string): void;
  onNew(): void;
  onDuplicate(code: string): void;
  onDelete(code: string): void;
}

export interface MaterialBrowser {
  setEntries(entries: CatalogEntry[]): void;
  /** Marca la fila sin avisar a onSelect. */
  setSelected(code: string | null): void;
  setEditable(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountMaterialBrowser(host: HTMLElement, cb: MaterialBrowserCallbacks): MaterialBrowser {
  const root = el('section', 'ws-panel mat-browser');
  root.setAttribute('aria-label', 'Materials');
  const body = el('div', 'ws-panel-body mat-body');
  const search = el('input', 'mat-search');
  search.type = 'search';
  search.placeholder = 'Search materials';
  search.setAttribute('aria-label', 'Search materials');
  const bar = el('div', 'mat-bar');
  const button = (label: string, onClick: () => void) => {
    const b = el('button', 'mat-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const newBtn = button('New', () => cb.onNew());
  const dupBtn = button('Duplicate', () => selected && cb.onDuplicate(selected));
  const delBtn = button('Delete', () => selected && cb.onDelete(selected));
  bar.append(newBtn, dupBtn, delBtn);
  const list = el('div', 'mat-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Materials');
  list.tabIndex = 0;
  body.append(search, bar, list);
  root.append(el('header', 'ws-panel-title', 'Materials'), body);
  host.replaceChildren(root);

  let entries: CatalogEntry[] = [];
  let selected: string | null = null;
  let editable = true;

  const visible = (): CatalogEntry[] => {
    const q = search.value.trim().toLowerCase();
    return q ? entries.filter((e) => e.def.name.toLowerCase().includes(q) || e.def.code.toLowerCase().includes(q)) : entries;
  };

  function syncButtons(): void {
    const entry = entries.find((e) => e.def.code === selected);
    newBtn.disabled = !editable;
    dupBtn.disabled = !editable || !entry || entry.path === null; // without a node there is nothing to copy
    delBtn.disabled = !editable || !entry;
  }

  function render(): void {
    list.replaceChildren(
      ...visible().map((e) => {
        const row = el('div', 'mat-row');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(e.def.code === selected));
        row.dataset.code = e.def.code;
        row.draggable = true;
        const swatch = el('span', 'mat-swatch');
        swatch.style.background = e.def.color; // el color es un dato del usuario, no del tema
        row.append(swatch, el('span', 'mat-name', e.def.name), el('span', 'mat-code', e.def.code));
        if (e.path === null) row.append(el('span', 'mat-tag', 'from model'));
        row.append(el('span', 'mat-count', String(e.elements)));
        row.addEventListener('click', () => cb.onSelect(e.def.code));
        row.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData(MATERIAL_DRAG_TYPE, e.def.code);
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
        });
        return row;
      }),
    );
    syncButtons();
  }

  search.addEventListener('input', render);
  list.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const rows = visible();
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.def.code === selected);
    cb.onSelect(rows[Math.min(Math.max(i + step, 0), rows.length - 1)].def.code);
  });

  return {
    setEntries(e) {
      entries = e;
      render();
    },
    setSelected(code) {
      selected = code;
      for (const row of list.children) row.setAttribute('aria-selected', String((row as HTMLElement).dataset.code === code));
      syncButtons();
    },
    setEditable(on) {
      editable = on;
      syncButtons();
    },
  };
}
