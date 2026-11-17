// References panel: the linked files of the model (document, layers, imports and payloads), how many
// elements use them and which ones the selected element references. It only paints; the logic is in reflist.ts.
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode } from '../ifcx/types';
import { sameFile } from './uri';
import { referenceFiles, referencedBy, type RefFile, type RefRole } from './reflist';

export interface ReferencesCallbacks {
  /** Opens the file as a document (the app asks to confirm if there are unsaved changes). */
  open?(path: string): void;
  copy?(text: string): void;
}

export interface ReferencesPanel {
  setModel(m: { result: ComposeResult; path: string | null } | null): void;
  /** The selected element: it highlights the files it references. */
  select(node: ComposedNode | null): void;
  /** The tab became visible: it paints what was left pending while it was hidden. */
  shown(): void;
}

const ROLE: Record<RefRole, string> = { document: 'Document', layer: 'Layer', import: 'Import', payload: 'Payload' };
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // siempre texto: las rutas vienen de archivos
  return e;
}

export function mountReferencesPanel(host: HTMLElement, cb: ReferencesCallbacks): ReferencesPanel {
  host.replaceChildren();
  host.classList.add('refs-panel');
  const bar = el('div', 'refs-bar');
  const filter = el('input', 'refs-filter');
  filter.type = 'search';
  filter.placeholder = 'Filter files';
  filter.setAttribute('aria-label', 'Filter files');
  filter.spellcheck = false;
  bar.append(filter);
  const list = el('ul', 'refs-list');
  const empty = el('div', 'refs-empty');
  host.append(bar, list, empty);

  let model: { result: ComposeResult; path: string | null } | null = null;
  let selected: ComposedNode | null = null;
  let dirty = true;
  /** Rows of the current model: counting uses walks all the nodes, so it is not repeated when selecting. */
  let files: RefFile[] | null = null;

  const actions = (f: RefFile, docPath: string | null): HTMLElement | null => {
    const loc = f.location;
    if (!loc) return null;
    const box = el('span', 'refs-actions');
    const add = (label: string, run: () => void) => {
      const b = el('button', 'refs-action', label);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.addEventListener('click', () => run());
      box.append(b);
    };
    if (cb.copy) add('Copy path', () => cb.copy!(loc));
    // el documento abierto y las urls no se abren
    if (cb.open && f.role !== 'document' && !URL_RE.test(loc) && !(docPath && sameFile(loc, docPath))) add('Open', () => cb.open!(loc));
    return box.childElementCount ? box : null;
  };

  const row = (f: RefFile, docPath: string | null, active: boolean): HTMLElement => {
    const li = el('li', 'refs-row');
    li.dataset.key = f.key;
    li.title = f.title;
    li.classList.toggle('refs-active', active);
    li.append(el('span', 'refs-role', ROLE[f.role]), el('span', 'refs-name', f.name));
    const dir = f.label.slice(0, Math.max(0, f.label.length - f.name.length)).replace(/\/$/, '');
    if (dir) li.append(el('span', 'refs-dir', dir));
    if (f.usedBy) {
      const n = el('span', 'refs-count', String(f.usedBy));
      n.title = f.usedBy === 1 ? '1 element uses it' : `${f.usedBy} elements use it`;
      li.append(n);
    }
    const a = actions(f, docPath);
    if (a) li.append(a);
    return li;
  };

  const render = () => {
    dirty = false;
    list.replaceChildren();
    if (!model) {
      empty.textContent = 'No document open';
      return;
    }
    const all = (files ??= referenceFiles(model.result, model.path));
    const q = filter.value.trim().toLowerCase();
    const shown = q ? all.filter((f) => f.label.toLowerCase().includes(q)) : all;
    const active = selected ? referencedBy(model.result, selected) : new Set<string>();
    for (const f of shown) list.append(row(f, model.path, active.has(f.key)));
    empty.textContent = shown.length ? (all.length === 1 && !q ? 'This document links to no other files' : '')
      : all.length ? 'No files match' : 'No document open';
  };

  /** Paints if the tab is visible; otherwise, it stays pending until shown(). */
  const refresh = () => {
    dirty = true;
    if (!host.hidden) render();
  };

  filter.addEventListener('input', refresh);

  return {
    setModel(m) {
      // setStage repeats with the same model (e.g. when the layers change): the uses are not recounted
      if (m && model && m.result === model.result && m.path === model.path) return;
      model = m;
      files = null;
      refresh();
    },
    select(node) {
      selected = node;
      refresh();
    },
    shown() {
      if (dirty) render();
    },
  };
}
