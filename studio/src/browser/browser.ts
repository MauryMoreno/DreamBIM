// Project Browser: tree of views (double click opens the view, as in Revit). The tree
// del modelo vive en el panel Stage.
// It draws no header: the title "Project Browser" is set by the panel frame (Task 11).
import type { ComposedNode } from '../ifcx/types';
import type { LevelInfo } from '../render/levels';
import { svgIcon, type StudioIcon } from '../shell/icons';
import { buildViewsTree, type BrowserNode, type ViewRef } from './views';

export interface BrowserCallbacks {
  onOpenView(v: ViewRef): void;
  /** Clic simple en una fila con vista (sin abrirla): una planta selecciona su nivel. */
  onSelectView?(v: ViewRef): void;
}

export interface ProjectBrowser {
  setModel(root: ComposedNode | null, levels: LevelInfo[]): void;
}

const PLUS = '+';
const MINUS = '−';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text: the names come from the model
  return e;
}

function nodeIcon(n: BrowserNode, isRoot: boolean): StudioIcon {
  if (isRoot) return 'tree';
  if (n.view?.kind === '3d') return 'cube3d';
  if (n.view?.kind === 'plan') return 'plan';
  if (n.view?.kind === 'elevation') return 'elevation';
  if (n.label === '3D') return 'cube3d';
  if (n.label === 'Floor Plans') return 'plan';
  if (n.label === 'Elevations') return 'elevation';
  return 'folder';
}

export function mountProjectBrowser(host: HTMLElement, cb: BrowserCallbacks): ProjectBrowser {
  host.replaceChildren();
  host.classList.add('pb');

  const empty = el('div', 'pb-empty', 'No model loaded');
  const body = el('div', 'pb-body');
  const viewsBox = el('div', 'pb-views');
  body.append(viewsBox);
  host.append(empty); // the body is only in the DOM while there is a model

  // --- Árbol de vistas --------------------------------------------------------
  // The DOM is built once per model and updated in place: this way the rows
  // conservan identidad (foco y doble clic reales) al seleccionar o plegar.
  interface Entry {
    row: HTMLElement;
    toggle: HTMLElement;
    group: HTMLElement | null;
  }
  let viewsRoot: BrowserNode | null = null;
  const entries = new Map<string, Entry>(); // clave = ruta de etiquetas
  const collapsed = new Set<string>(); // por defecto todo expandido
  let selectedKey: string | null = null;

  const setOpen = (key: string, open: boolean) => {
    const e = entries.get(key);
    if (!e?.group) return;
    if (open) collapsed.delete(key);
    else collapsed.add(key);
    e.row.setAttribute('aria-expanded', String(open));
    e.toggle.textContent = open ? MINUS : PLUS;
    e.group.hidden = !open;
  };
  const toggleKey = (key: string) => setOpen(key, collapsed.has(key));

  const selectKey = (key: string | null) => {
    if (selectedKey) {
      const prev = entries.get(selectedKey)?.row;
      prev?.classList.remove('selected');
      prev?.setAttribute('aria-selected', 'false');
    }
    selectedKey = key;
    const cur = key ? entries.get(key)?.row : undefined;
    cur?.classList.add('selected');
    cur?.setAttribute('aria-selected', 'true');
  };

  const renderNode = (n: BrowserNode, depth: number, key: string, into: HTMLElement) => {
    const kids = n.children ?? [];
    const open = !collapsed.has(key);
    const row = el('div', 'pb-node');
    row.dataset.label = n.label;
    row.dataset.key = key;
    row.style.setProperty('--depth', String(depth));
    row.tabIndex = 0;
    if (kids.length) {
      row.classList.add('pb-branch');
      row.setAttribute('aria-expanded', String(open));
    } else if (!n.view) {
      row.classList.add('pb-inert'); // marcador como "(sin niveles)": no se puede abrir
    } else {
      row.setAttribute('aria-selected', 'false');
    }

    const toggle = el('span', 'pb-toggle', kids.length ? (open ? MINUS : PLUS) : '');
    if (kids.length) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleKey(key);
      });
    }
    row.append(toggle, svgIcon(nodeIcon(n, depth === 0), 14), el('span', 'pb-label', n.label));

    const activate = () => {
      if (n.view) cb.onOpenView(n.view);
      else if (kids.length) toggleKey(key);
    };
    row.addEventListener('click', () => {
      if (n.view || kids.length) selectKey(key);
      if (n.view) cb.onSelectView?.(n.view);
    });
    row.addEventListener('dblclick', activate);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        activate();
      } else if (kids.length && e.key === 'ArrowRight' && collapsed.has(key)) {
        e.preventDefault();
        toggleKey(key);
      } else if (kids.length && e.key === 'ArrowLeft' && !collapsed.has(key)) {
        e.preventDefault();
        toggleKey(key);
      }
    });
    into.append(row);

    let group: HTMLElement | null = null;
    if (kids.length) {
      group = el('div', 'pb-group');
      group.setAttribute('role', 'group');
      group.hidden = !open;
      kids.forEach((c) => renderNode(c, depth + 1, `${key}/${c.label}`, group!));
      into.append(group);
    }
    entries.set(key, { row, toggle, group });
  };

  /** Rebuilds the tree (only when the model changes) and gives the focus back to the same row if it exists. */
  const rebuildViews = () => {
    const focusedKey = viewsBox.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.key
      : undefined;
    const keepSelected = selectedKey;
    viewsBox.replaceChildren();
    entries.clear();
    selectedKey = null;
    if (viewsRoot) renderNode(viewsRoot, 0, viewsRoot.label, viewsBox);
    if (keepSelected && entries.has(keepSelected)) selectKey(keepSelected);
    if (focusedKey) entries.get(focusedKey)?.row.focus();
  };

  return {
    setModel(root, levels) {
      if (root === null) {
        body.remove();
        host.append(empty);
        viewsRoot = null;
        selectedKey = null;
        entries.clear();
        viewsBox.replaceChildren();
        return;
      }
      empty.remove();
      host.append(body);
      viewsRoot = buildViewsTree(levels);
      rebuildViews();
    },
  };
}
