// Library panel (at the bottom, like the Omniverse Content): bar with navigation, path and search; tree
// of folders on the left, cards in the center (the subfolders and the .ifcx of the current folder,
// which are dragged to the Stage or to the view to link them) and details of the chosen card on the right.
// It only paints and notifies; reading the disk and linking are done by the commands it receives.
import { svgIcon } from '../shell/icons';
import { LibraryEntry, LibraryCallbacks, LibraryPanel } from './panel/types';
import { SEARCH_DEBOUNCE_MS, TILE_MIN, TILE_MAX, TILE_DEFAULT, el, button, stem, parts, sep } from './panel/helpers';
export type { LibraryEntry, LibraryCallbacks, LibraryPanel } from './panel/types';
export { stem, parts, sep } from './panel/helpers';

/** DataTransfer type when dragging a card (its value is the file path). */
export const LIBRARY_MIME = 'application/x-ifcx-library';

/**
 * Path of the file being dragged from the library, or null. WebView2 does not allow reading the
 * DataTransfer during dragover, so the targets query it here.
 */
let dragging: string | null = null;
export const draggedAsset = (): string | null => dragging;

export function mountLibraryPanel(host: HTMLElement, cb: LibraryCallbacks): LibraryPanel {
  host.replaceChildren();
  host.classList.add('lib-panel');
  const bar = el('div', 'lib-bar');
  const pick = button('lib-btn lib-pick', '+ Folder…', 'Choose the library folder', () => void choose());
  const back = button('lib-btn lib-back', '‹', 'Back', () => void step(-1));
  back.setAttribute('aria-label', 'Back');
  const forward = button('lib-btn lib-forward', '›', 'Forward', () => void step(1));
  forward.setAttribute('aria-label', 'Forward');
  const up = button('lib-btn lib-up', '↑', 'Up one folder', () => {
    if (cwd && root && cwd !== root) void go(parentOf(cwd));
  });
  up.setAttribute('aria-label', 'Up one folder');
  const crumbs = el('nav', 'lib-crumbs');
  crumbs.setAttribute('aria-label', 'Folder');
  const searchBox = el('label', 'lib-searchbox');
  const search = el('input', 'pb-search lib-search');
  search.type = 'search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', 'Search the library');
  searchBox.append(svgIcon('search', 13), search);
  const reload = button('lib-btn', '⟳', 'Refresh', () => void load());
  reload.setAttribute('aria-label', 'Refresh');
  bar.append(pick, back, forward, up, crumbs, searchBox, reload);
  if (cb.onOpenCollection) {
    const open = cb.onOpenCollection;
    bar.append(button('lib-btn lib-cards', 'Cards', 'Show the library as cards', () => open()));
  }

  const tree = el('div', 'lib-tree');
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Folders');
  const grid = el('ul', 'lib-grid');
  grid.setAttribute('aria-label', 'Library');
  const empty = el('div', 'pb-empty lib-empty');
  const main = el('div', 'lib-main');
  const zoom = el('input', 'lib-zoom');
  zoom.type = 'range';
  zoom.min = String(TILE_MIN);
  zoom.max = String(TILE_MAX);
  zoom.value = String(TILE_DEFAULT);
  zoom.title = 'Icon size';
  zoom.setAttribute('aria-label', 'Icon size');
  zoom.addEventListener('input', () => main.style.setProperty('--lib-tile', `${zoom.value}px`));
  const zoomBar = el('div', 'lib-zoombar');
  zoomBar.append(zoom);
  main.append(grid, empty, zoomBar);
  const details = el('aside', 'lib-details');
  details.setAttribute('aria-label', 'Details');
  const body = el('div', 'lib-body');
  body.append(tree, main, details);
  host.append(bar, body);

  let root: string | null = null;
  let cwd: string | null = null;
  let entries: LibraryEntry[] = [];
  let error: string | null = null;
  let enabled = false;
  let query = '';
  /** Ficha elegida (ruta); sus datos salen en el panel de detalles. */
  let selected: string | null = null;
  /** Visited folders (the last one is the current) and position in them, for Back and Forward. */
  let trail: string[] = [];
  let at = -1;
  /** Subfolders already read of each folder, and open folders of the tree. */
  const subdirs = new Map<string, LibraryEntry[]>();
  const expanded = new Set<string>();
  /** Each read invalidates the previous ones (a slow folder does not override the next one). */
  let ticket = 0;

  const parentOf = (p: string): string => {
    const s = sep(p);
    const i = p.replace(/[\\/]+$/, '').lastIndexOf(s);
    return i > 0 ? p.slice(0, i) : p;
  };

  /** Folders from the root to the parent of `dir`. */
  const ancestors = (dir: string): string[] => {
    if (!root) return [];
    const s = sep(root);
    const rel = parts(dir).slice(parts(root).length);
    return [root, ...rel.slice(0, -1).map((_, i) => root + s + rel.slice(0, i + 1).join(s))];
  };

  const choose = async (): Promise<void> => {
    let dir: string | null;
    try {
      dir = await cb.chooseFolder();
    } catch {
      return; // the dialog already notifies on its own
    }
    if (!dir) return;
    await panel.setFolder(dir);
    cb.onFolderChange?.(dir);
  };

  const go = async (dir: string, record = true): Promise<void> => {
    cwd = dir;
    search.value = '';
    query = '';
    selected = null;
    if (record) {
      trail = [...trail.slice(0, at + 1), dir];
      at = trail.length - 1;
    }
    // the tree shows the current folder: it opens the ones that contain it
    for (const a of ancestors(dir)) expanded.add(a);
    await load();
    await Promise.all([...expanded].map(loadSubdirs));
  };

  const step = async (by: number): Promise<void> => {
    const to = trail[at + by];
    if (to === undefined) return;
    at += by;
    await go(to, false);
  };

  const load = async (): Promise<void> => {
    const t = ++ticket;
    if (!cwd) {
      entries = [];
      error = null;
      return render();
    }
    try {
      const list = await cb.list(cwd);
      if (t !== ticket) return;
      entries = list;
      error = null;
      subdirs.set(cwd, list.filter((e) => e.isDir));
    } catch (e) {
      if (t !== ticket) return;
      entries = [];
      error = e instanceof Error ? e.message : String(e);
    }
    render();
  };

  /** Reads the subfolders of `dir` for the tree (if they are not already there) and repaints it. */
  const loadSubdirs = async (dir: string): Promise<void> => {
    if (subdirs.has(dir)) return;
    const from = root;
    let dirs: LibraryEntry[] = [];
    try {
      dirs = (await cb.list(dir)).filter((e) => e.isDir);
    } catch {
      /* ilegible: se queda sin hijos */
    }
    if (root !== from) return; // the library was changed while reading
    subdirs.set(dir, dirs);
    renderTree();
  };

  const renderCrumbs = (): void => {
    crumbs.replaceChildren();
    if (!root || !cwd) return;
    // the root with its name and, below it, each subfolder down to the current one
    const rel = parts(cwd).slice(parts(root).length);
    const s = sep(root);
    const trailOf = [{ label: parts(root).at(-1) ?? root, path: root }];
    rel.forEach((name, i) => trailOf.push({ label: name, path: root + s + rel.slice(0, i + 1).join(s) }));
    trailOf.forEach((c, i) => {
      if (i) crumbs.append(el('span', 'lib-crumb-sep', '›'));
      const last = i === trailOf.length - 1;
      const b = el('button', 'lib-crumb', c.label);
      b.type = 'button';
      b.title = c.path;
      b.disabled = last;
      if (last) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => void go(c.path));
      crumbs.append(b);
    });
  };

  const renderTree = (): void => {
    tree.replaceChildren();
    if (!root) return;
    const node = (path: string, label: string, depth: number): void => {
      const kids = subdirs.get(path);
      const open = expanded.has(path);
      const row = el('div', 'lib-node');
      row.setAttribute('role', 'treeitem');
      row.style.paddingLeft = `${4 + depth * 14}px`;
      row.classList.toggle('current', path === cwd);
      row.title = path;
      if (kids && !kids.length) row.append(el('span', 'lib-toggle lib-toggle-empty'));
      else {
        row.setAttribute('aria-expanded', String(open));
        const t = button('lib-toggle', open ? '−' : '+', open ? 'Collapse' : 'Expand', () => {
          if (open) expanded.delete(path);
          else {
            expanded.add(path);
            void loadSubdirs(path);
          }
          renderTree();
        });
        t.setAttribute('aria-label', open ? 'Collapse' : 'Expand');
        t.addEventListener('click', (c) => c.stopPropagation());
        row.append(t);
      }
      row.append(svgIcon('folder', 14), el('span', 'lib-node-name', label));
      row.addEventListener('click', () => void go(path));
      tree.append(row);
      if (open) for (const d of kids ?? []) node(d.path, d.name, depth + 1);
    };
    node(root, parts(root).at(-1) ?? root, 0);
  };

  const formatDate = (ms: number): string =>
    new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  const renderDetails = (): void => {
    details.replaceChildren();
    const e = selected ? entries.find((x) => x.path === selected) : undefined;
    details.append(el('div', 'lib-details-head', e ? (e.isDir ? e.name : stem(e.name)) : 'No files selected'));
    if (!e) return;
    const list = el('dl', 'lib-props');
    const row = (k: string, v: string) => list.append(el('dt', '', k), el('dd', '', v));
    row('Type', e.isDir ? 'Folder' : 'IFCx file');
    row('Date Modified', e.mtime ? formatDate(e.mtime) : '—');
    row('Location', parentOf(e.path));
    details.append(list);
  };

  const select = (path: string | null): void => {
    selected = path;
    for (const li of grid.children) li.classList.toggle('selected', (li as HTMLElement).dataset.path === path);
    renderDetails();
  };

  const tile = (e: LibraryEntry): HTMLElement => {
    const li = el('li', `lib-tile ${e.isDir ? 'lib-dir' : 'lib-file'}`);
    li.tabIndex = 0;
    li.title = e.path;
    li.dataset.path = e.path;
    li.classList.toggle('selected', e.path === selected);
    const icon = el('span', 'lib-icon');
    icon.append(svgIcon(e.isDir ? 'folder' : 'cube3d', 28));
    li.append(icon, el('span', 'lib-name', e.isDir ? e.name : stem(e.name)));
    const activate = () => {
      if (e.isDir) void go(e.path);
      else if (enabled) cb.onActivate(e.path);
    };
    li.addEventListener('click', (c) => {
      c.stopPropagation();
      select(e.path);
    });
    li.addEventListener('dblclick', activate);
    li.addEventListener('keydown', (k) => {
      if (k.key !== 'Enter') return;
      k.preventDefault();
      activate();
    });
    li.draggable = !e.isDir && enabled;
    if (!e.isDir) {
      li.classList.toggle('disabled', !enabled);
      li.addEventListener('dragstart', (d) => {
        if (!enabled) return d.preventDefault();
        dragging = e.path;
        if (d.dataTransfer) {
          d.dataTransfer.setData(LIBRARY_MIME, e.path);
          d.dataTransfer.setData('text/plain', e.path);
          d.dataTransfer.effectAllowed = 'copy';
        }
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        dragging = null;
        li.classList.remove('dragging');
      });
    }
    return li;
  };

  const render = (): void => {
    renderCrumbs();
    renderTree();
    if (selected && !entries.some((x) => x.path === selected)) selected = null;
    renderDetails();
    up.disabled = !cwd || cwd === root;
    back.disabled = at <= 0;
    forward.disabled = at >= trail.length - 1;
    reload.disabled = !cwd;
    search.disabled = !cwd;
    const shown = query ? entries.filter((e) => e.name.toLowerCase().includes(query)) : entries;
    grid.replaceChildren(...shown.map(tile));
    const msg =
      !root ? 'Choose a folder with .ifcx files to use as the library'
      : error ? error
      : !entries.length ? 'No .ifcx files in this folder'
      : !shown.length ? 'No results'
      : null;
    empty.textContent = msg ?? '';
    empty.hidden = msg === null;
    grid.hidden = msg !== null;
  };

  // clic en el hueco de la rejilla: sin ficha elegida
  main.addEventListener('click', () => select(null));

  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value.trim().toLowerCase();
      render();
    }, SEARCH_DEBOUNCE_MS);
  });

  const panel: LibraryPanel = {
    async setFolder(dir) {
      root = dir;
      cwd = null;
      trail = [];
      at = -1;
      selected = null;
      subdirs.clear();
      expanded.clear();
      if (dir) await go(dir);
      else await load();
    },
    setEnabled(on) {
      if (enabled === on) return;
      enabled = on;
      render();
    },
    refresh: load,
  };
  render();
  return panel;
}
