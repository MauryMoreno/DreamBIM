// The center of Docs, like the file explorer: a bar with the path (breadcrumbs), the subfolders and the files
// of the current folder together (folders first) with their icon and the date, type and size columns. A double click on a
// folder enters it; on a file, it opens it. Typing in the search also looks inside the subfolders.
import { svgIcon, type StudioIcon } from '../shell/icons';
import { baseName, dirName, type DiskTree } from './scan';

export interface ExplorerDeps {
  /** What is on the disk, already scanned by the mode. */
  tree(): DiskTree;
  /** Nombre de la carpeta del proyecto: la primera miga de pan. */
  rootName(): string;
  /** A file was opened (double click or Enter). */
  onOpen(path: string): void;
  /** Another folder was entered ('' = the project one). */
  onNavigate(folder: string): void;
}

export interface Explorer {
  render(): void;
  /** Carpeta actual ('' = la del proyecto). */
  folder(): string;
  /** Enters a folder; clears the search and the selection. */
  navigate(folder: string): void;
  /** Ruta del archivo elegido, o null. */
  selected(): string | null;
  /** Marca el archivo elegido (null: ninguno) sin avisar. */
  setSelected(path: string | null): void;
}

type SortKey = 'name' | 'date' | 'type' | 'size';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const TYPE_NAMES: Record<string, string> = {
  pdf: 'PDF Document', dwg: 'AutoCAD Drawing', dxf: 'DXF Drawing', doc: 'Word Document', docx: 'Word Document',
  xls: 'Excel Workbook', xlsx: 'Excel Workbook', ppt: 'PowerPoint Presentation', pptx: 'PowerPoint Presentation',
  jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', bmp: 'Image', tif: 'Image', tiff: 'Image',
  ifc: 'IFC Model', ifcx: 'IFCx Model', rvt: 'Revit Model', skp: 'SketchUp Model', txt: 'Text Document',
  csv: 'CSV File', zip: 'Compressed Folder', rar: 'Compressed Folder', '7z': 'Compressed Folder',
};
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff']);
const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** «PDF Document», «File folder»… como el explorador de Windows. */
export function typeName(name: string, isFolder: boolean): string {
  if (isFolder) return 'File folder';
  const ext = extOf(name);
  return TYPE_NAMES[ext] ?? (ext ? `${ext.toUpperCase()} File` : 'File');
}

/** Size as in the explorer: in KB, rounded up (an empty file, 0 KB). */
export function sizeText(bytes: number): string {
  return bytes <= 0 ? '0 KB' : `${Math.ceil(bytes / 1024).toLocaleString('en-US')} KB`;
}

const dateText = (ms: number): string => (ms > 0 ? new Date(ms).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '');

interface Row {
  kind: 'folder' | 'file';
  /** Ruta del archivo o de la carpeta. */
  path: string;
  name: string;
  date: number;
  size: number;
}

export function mountDocExplorer(host: HTMLElement, deps: ExplorerDeps): Explorer {
  const root = el('section', 'doc-table doc-explorer');
  root.setAttribute('aria-label', 'Documents');
  root.tabIndex = 0;

  const up = el('button', 'doc-up');
  up.type = 'button';
  up.title = 'Up one level (Backspace)';
  up.setAttribute('aria-label', 'Up one level');
  up.append(el('span', 'doc-up-arrow', '↑'));
  const crumbs = el('nav', 'doc-crumbs');
  crumbs.setAttribute('aria-label', 'Path');
  const search = el('input', 'doc-search');
  search.type = 'search';
  search.placeholder = 'Search files';
  search.setAttribute('aria-label', 'Search files');
  const bar = el('div', 'doc-table-bar doc-nav');
  bar.append(up, crumbs, search);

  const columns: [SortKey, string][] = [
    ['name', 'Name'], ['date', 'Date modified'], ['type', 'Type'], ['size', 'Size'],
  ];
  const wrap = el('div', 'doc-list');
  const table = el('table', 'doc-table-grid');
  table.setAttribute('role', 'grid');
  const head = el('thead');
  const hrow = el('tr');
  const heads = new Map<SortKey, HTMLTableCellElement>();
  for (const [key, label] of columns) {
    const th = el('th');
    th.dataset.col = key;
    const b = el('button', 'doc-sort', label);
    b.type = 'button';
    b.addEventListener('click', () => sortBy(key));
    th.append(b);
    hrow.append(th);
    heads.set(key, th);
  }
  head.append(hrow);
  const tbody = el('tbody');
  table.append(head, tbody);
  wrap.append(table);
  const empty = el('p', 'doc-empty', 'This folder is empty');
  const statusbar = el('div', 'doc-statusbar');
  statusbar.setAttribute('role', 'status');
  root.append(bar, wrap, empty, statusbar);
  host.replaceChildren(root);

  let current = '';
  let selectedPath: string | null = null;
  let selectedFolder: string | null = null;
  let sortKey: SortKey = 'name';
  let ascending = true;
  let rows: Row[] = [];

  /** What is shown: the subfolders and files of the current folder or, with a search, everything that matches below it. */
  function collect(): Row[] {
    const tree = deps.tree();
    const text = search.value.trim().toLowerCase();
    const folders = text
      ? tree.folders.filter((f) => baseName(f).toLowerCase().includes(text))
      : tree.folders.filter((f) => dirName(f) === current);
    const files = text
      ? tree.files.filter((f) => baseName(f.path).toLowerCase().includes(text))
      : tree.files.filter((f) => dirName(f.path) === current);
    return [
      ...folders.map((path): Row => ({ kind: 'folder', path, name: baseName(path), date: 0, size: 0 })),
      ...files.map((f): Row => ({ kind: 'file', path: f.path, name: baseName(f.path), date: f.mtime, size: f.size })),
    ];
  }

  const sortValue = (r: Row): string | number => {
    switch (sortKey) {
      case 'date': return r.date;
      case 'size': return r.size;
      case 'type': return typeName(r.name, r.kind === 'folder').toLowerCase();
      default: return r.name.toLowerCase();
    }
  };

  function sorted(list: Row[]): Row[] {
    const dir = ascending ? 1 : -1;
    const cmp = (a: Row, b: Row): number => {
      const x = sortValue(a);
      const y = sortValue(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return c * dir || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    };
    // folders always come before files, as in the explorer
    return [...list.filter((r) => r.kind === 'folder').sort(cmp), ...list.filter((r) => r.kind === 'file').sort(cmp)];
  }

  function sortBy(key: SortKey): void {
    if (sortKey === key) ascending = !ascending;
    else {
      sortKey = key;
      ascending = key !== 'date'; // the date, from the newest to the oldest
    }
    render();
  }

  const icon = (r: Row): SVGElement => {
    const name: StudioIcon = r.kind === 'folder' ? 'folder' : IMAGE_EXT.has(extOf(r.name)) ? 'image' : 'file';
    const i = svgIcon(name, 16);
    i.classList.add('doc-icon', r.kind === 'folder' ? 'is-folder' : 'is-file');
    return i;
  };

  function activate(r: Row): void {
    if (r.kind === 'folder') navigate(r.path);
    else deps.onOpen(r.path);
  }

  function pick(r: Row): void {
    selectedFolder = r.kind === 'folder' ? r.path : null;
    selectedPath = r.kind === 'file' ? r.path : null;
    render();
  }

  function drawCrumbs(): void {
    const parts = current ? current.split('/') : [];
    const items: HTMLElement[] = [];
    const add = (label: string, folder: string, last: boolean): void => {
      if (items.length) items.push(el('span', 'doc-crumb-sep', '›'));
      const b = el('button', 'doc-crumb', label);
      b.type = 'button';
      b.dataset.folder = folder;
      if (last) b.setAttribute('aria-current', 'location');
      b.addEventListener('click', () => navigate(folder));
      items.push(b);
    };
    add(deps.rootName(), '', parts.length === 0);
    parts.forEach((p, i) => add(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1));
    crumbs.replaceChildren(...items);
    up.disabled = current === '';
  }

  function render(): void {
    rows = sorted(collect());
    drawCrumbs();
    for (const [key, th] of heads) {
      th.setAttribute('aria-sort', key === sortKey ? (ascending ? 'ascending' : 'descending') : 'none');
    }
    const out = rows.map((r) => {
      const tr = el('tr', r.kind === 'folder' ? 'doc-row doc-folder-row' : 'doc-row');
      const chosen = r.kind === 'folder' ? r.path === selectedFolder : r.path === selectedPath;
      if (r.kind === 'folder') tr.dataset.folder = r.path;
      else tr.dataset.doc = r.path;
      tr.setAttribute('aria-selected', String(chosen));
      tr.classList.toggle('is-selected', chosen);
      const name = el('td', 'doc-name-cell');
      name.append(icon(r), el('span', 'doc-name', r.name));
      if (search.value.trim() && dirName(r.path)) name.title = r.path; // in a search, where it is
      tr.append(
        name,
        el('td', 'doc-date', dateText(r.date)),
        el('td', 'doc-type', typeName(r.name, r.kind === 'folder')),
        el('td', 'doc-size', r.kind === 'folder' ? '' : sizeText(r.size)),
      );
      tr.addEventListener('click', () => pick(r));
      tr.addEventListener('dblclick', () => activate(r));
      return tr;
    });
    tbody.replaceChildren(...out);
    empty.hidden = rows.length > 0;
    empty.textContent = search.value.trim() ? 'No items match your search' : 'This folder is empty';
    const chosen = rows.filter((r) => (r.kind === 'folder' ? r.path === selectedFolder : r.path === selectedPath));
    statusbar.textContent = chosen.length
      ? `${chosen.length} item selected${chosen[0].kind === 'file' && chosen[0].size ? `   ${sizeText(chosen[0].size)}` : ''}`
      : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`;
  }

  function navigate(folder: string): void {
    current = folder;
    search.value = '';
    selectedPath = null;
    selectedFolder = null;
    deps.onNavigate(folder);
    render();
  }

  function move(delta: number): void {
    if (!rows.length) return;
    const i = rows.findIndex((r) => (r.kind === 'folder' ? r.path === selectedFolder : r.path === selectedPath));
    pick(rows[Math.min(rows.length - 1, Math.max(0, i < 0 ? (delta > 0 ? 0 : rows.length - 1) : i + delta))]);
    tbody.querySelector('.is-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  up.addEventListener('click', () => navigate(dirName(current)));
  search.addEventListener('input', render);
  root.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Enter') {
      const r = rows.find((x) => (x.kind === 'folder' ? x.path === selectedFolder : x.path === selectedPath));
      if (r) activate(r);
    } else if (e.key === 'Backspace' && current) navigate(dirName(current));
    else return;
    e.preventDefault();
  });

  render();
  return {
    render,
    folder: () => current,
    navigate,
    selected: () => selectedPath,
    setSelected(path) {
      selectedPath = path;
      if (path) selectedFolder = null;
      render();
    },
  };
}
