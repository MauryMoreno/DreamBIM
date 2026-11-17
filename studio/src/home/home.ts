import type { FileEntry } from '../platform/files';
import type { RecentEntry } from './recents';
import { svgIcon, type StudioIcon } from '../shell/icons';

export interface HomeActions {
  onOpen(): void;
  onNew(): void;
  onOpenRecent(e: RecentEntry): void;
  onRemoveRecent(path: string): void;
  /** An example model (web demo). */
  onOpenExample?(e: ExampleEntry): void;
  /** The library as cards; without this the button does not appear. */
  onCollection?(): void;
  /** The project CDE; without this the button does not appear. */
  onDocuments?(): void;
  /** The Revit add-in (web demo); without this the button does not appear. */
  onRevitAddin?(): void;
}

type RecentItem = RecentEntry & { missing: boolean };

/** Un modelo de ejemplo de Inicio. */
export interface ExampleEntry {
  path: string;
  /** Without the .ifcx extension. */
  name: string;
  /** Carpeta dentro del proyecto de ejemplo: "01_WIP · EST". */
  folder: string;
}

/** Carpeta y nombre legibles de un archivo del proyecto de ejemplo (/proyecto/<carpetas>/<nombre>.ifcx). */
export function exampleOf(f: FileEntry): ExampleEntry {
  return { path: f.path, name: f.name.replace(/\.ifcx$/i, ''), folder: f.path.split('/').slice(2, -1).join(' · ') };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sideButton(label: string, icon: StudioIcon, onClick?: () => void): HTMLButtonElement {
  const b = el('button', 'home-action');
  b.type = 'button';
  b.append(svgIcon(icon, 18), el('span', undefined, label));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function card(r: RecentItem, a: HomeActions): HTMLElement {
  const c = el('div', r.missing ? 'recent-card missing' : 'recent-card');
  c.title = r.path;

  const frame = el('div', 'thumb');
  if (r.thumbnail) {
    const img = el('img');
    img.src = r.thumbnail;
    img.alt = '';
    img.draggable = false;
    frame.appendChild(img);
  } else {
    const empty = el('div', 'thumb-empty');
    empty.appendChild(svgIcon('cube3d', 40));
    frame.appendChild(empty);
  }

  const name = el('div', 'recent-name', r.name);
  const meta = el('div', 'recent-date', new Date(r.openedAt).toLocaleDateString('en-US'));
  c.append(frame, name, meta);

  if (r.missing) {
    const warn = el('div', 'recent-missing', 'Not found');
    const remove = el('button', 'recent-remove', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      a.onRemoveRecent(r.path);
    });
    c.append(warn, remove);
    return c;
  }

  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  const open = () => a.onOpenRecent({ path: r.path, name: r.name, openedAt: r.openedAt, thumbnail: r.thumbnail });
  c.addEventListener('click', open);
  c.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open();
    }
  });
  return c;
}

function exampleCard(x: ExampleEntry, a: HomeActions): HTMLElement {
  const c = el('div', 'recent-card');
  c.title = x.path;
  const frame = el('div', 'thumb');
  const empty = el('div', 'thumb-empty');
  empty.appendChild(svgIcon('cube3d', 40));
  frame.appendChild(empty);
  c.append(frame, el('div', 'recent-name', x.name), el('div', 'recent-date', x.folder));
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  const open = () => a.onOpenExample?.(x);
  c.addEventListener('click', open);
  c.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      open();
    }
  });
  return c;
}

/**
 * Home screen: a dark column of actions, the recent models on top and, if there are any, the models of
 * example (web demo) in the lower half.
 */
export function renderHome(root: HTMLElement, recents: RecentItem[], a: HomeActions, examples: ExampleEntry[] = []): void {
  root.textContent = '';
  root.classList.add('home');

  const side = el('aside', 'home-side');
  const brand = el('h1', 'home-brand');
  const logo = el('img', 'home-logo');
  logo.src = `${import.meta.env.BASE_URL}logoHorizontal.svg`;
  logo.alt = 'Dream BIM';
  logo.draggable = false;
  brand.appendChild(logo);
  side.appendChild(brand);
  side.appendChild(el('h2', 'home-heading', 'Models'));
  const importIfc = sideButton('Import IFC…', 'file');
  importIfc.disabled = true;
  importIfc.title = 'Coming soon';
  side.append(sideButton('Open…', 'open', () => a.onOpen()), sideButton('New…', 'cube3d', () => a.onNew()), importIfc);
  const addin = a.onRevitAddin;
  if (addin) side.append(sideButton('Revit add-in…', 'file', () => addin()));
  const open = a.onCollection;
  if (open) side.append(sideButton('Collection', 'folder', () => open()));
  const docs = a.onDocuments;
  if (docs) {
    side.appendChild(el('h2', 'home-heading', 'Project'));
    side.append(sideButton('Documents', 'file', () => docs()));
  }

  const main = el('section', 'home-main');
  const recent = el('section', 'home-recents');
  recent.appendChild(el('h2', 'home-heading', 'Recent'));
  if (recents.length === 0) {
    recent.appendChild(el('p', 'home-empty', 'No recent models yet'));
  } else {
    const grid = el('div', 'recent-grid');
    for (const r of recents) grid.appendChild(card(r, a));
    recent.appendChild(grid);
  }
  main.appendChild(recent);
  if (examples.length > 0) {
    const sample = el('section', 'home-examples');
    sample.appendChild(el('h2', 'home-heading', 'Examples'));
    const grid = el('div', 'recent-grid');
    for (const x of examples) grid.appendChild(exampleCard(x, a));
    sample.appendChild(grid);
    main.appendChild(sample);
  }

  root.append(side, main);
}
