// Tree of project folders, in the left panel of Docs, like the navigation pane of the explorer: the
// project folder on top and its nested subfolders, which collapse and expand. Choosing one opens it in the center.
import { svgIcon } from '../shell/icons';
import { baseName, dirName } from './scan';

export interface DocTreeCallbacks {
  /** Carpeta elegida ('' = la del proyecto). */
  onSelect(folder: string): void;
}

export interface DocTree {
  setFolders(folders: string[]): void;
  /** Marks the current folder and expands the ones that contain it. */
  setSelected(folder: string): void;
  /** Name of the project folder (the root). */
  setRoot(name: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountDocTree(host: HTMLElement, cb: DocTreeCallbacks): DocTree {
  const root = el('section', 'ws-panel doc-tree');
  root.setAttribute('aria-label', 'Folders');
  const header = el('header', 'ws-panel-title', 'Folders');
  const body = el('div', 'ws-panel-body doc-tree-body');
  const list = el('div', 'doc-tree-list');
  list.setAttribute('role', 'tree');
  root.append(header, body);
  body.append(list);
  host.replaceChildren(root);

  let folders: string[] = [];
  let selected = '';
  let rootName = 'Project';
  /** Expanded folders; the root is always expanded at the start. */
  const open = new Set<string>(['']);

  const row = (id: string, name: string, depth: number, hasChildren: boolean): HTMLElement => {
    const r = el('div', 'doc-tree-row');
    r.dataset.folder = id;
    r.setAttribute('role', 'treeitem');
    r.setAttribute('aria-selected', String(id === selected));
    if (hasChildren) r.setAttribute('aria-expanded', String(open.has(id)));
    r.tabIndex = 0;
    r.style.paddingLeft = `${4 + depth * 14}px`;
    r.classList.toggle('is-selected', id === selected);
    const chevron = el('button', 'doc-tree-chevron', hasChildren ? '›' : '');
    chevron.type = 'button';
    chevron.tabIndex = -1;
    chevron.setAttribute('aria-label', open.has(id) ? 'Collapse' : 'Expand');
    chevron.classList.toggle('is-open', open.has(id));
    chevron.disabled = !hasChildren;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      if (open.has(id)) open.delete(id);
      else open.add(id);
      render();
    });
    const icon = svgIcon('folder', 15);
    icon.classList.add('doc-icon', 'is-folder');
    r.append(chevron, icon, el('span', 'doc-tree-name', name));
    r.addEventListener('click', () => cb.onSelect(id));
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cb.onSelect(id);
      } else if (e.key === 'ArrowRight' && hasChildren && !open.has(id)) {
        e.preventDefault();
        open.add(id);
        render();
      } else if (e.key === 'ArrowLeft' && open.has(id)) {
        e.preventDefault();
        open.delete(id);
        render();
      }
    });
    return r;
  };

  function render(): void {
    const out: HTMLElement[] = [];
    const kids = (parent: string): string[] =>
      folders.filter((f) => dirName(f) === parent).sort((a, b) => baseName(a).localeCompare(baseName(b), undefined, { numeric: true, sensitivity: 'base' }));
    const walk = (parent: string, depth: number): void => {
      for (const f of kids(parent)) {
        const children = kids(f).length > 0;
        out.push(row(f, baseName(f), depth, children));
        if (children && open.has(f)) walk(f, depth + 1);
      }
    };
    out.push(row('', rootName, 0, kids('').length > 0));
    if (open.has('')) walk('', 1);
    list.replaceChildren(...out);
  }

  render();
  return {
    setFolders(f) { folders = f; render(); },
    setSelected(f) {
      selected = f;
      // the current folder always stays in view: the ones that contain it are expanded
      const parts = f ? f.split('/') : [];
      open.add('');
      for (let i = 1; i < parts.length; i++) open.add(parts.slice(0, i).join('/'));
      render();
    },
    setRoot(name) { rootName = name; render(); },
  };
}
