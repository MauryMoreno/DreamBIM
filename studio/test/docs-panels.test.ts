// Docs panels: folder tree and explorer in the center (folders and files like the file explorer).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDocTree } from '../src/docs/treepanel';
import { mountDocExplorer, sizeText, typeName } from '../src/docs/explorer';
import type { DiskTree } from '../src/docs/scan';

const TREE: DiskTree = {
  folders: ['Planos', 'Planos/Estructura', 'Memorias'],
  files: [
    { path: 'Planos/Estructura/A-0001.pdf', mtime: Date.UTC(2026, 10, 9, 12), size: 0 },
    { path: 'Memoria.pdf', mtime: Date.UTC(2026, 10, 9, 12), size: 3 * 1024 + 1 },
    { path: 'Planos/Nota.txt', mtime: Date.UTC(2026, 10, 5, 12), size: 0 },
    { path: 'Foto.jpg', mtime: Date.UTC(2026, 10, 1, 12), size: 500 },
  ],
};

let treeHost: HTMLElement;
let centerHost: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="t"></div><div id="b"></div>';
  treeHost = document.getElementById('t')!;
  centerHost = document.getElementById('b')!;
});

function mount(over: { tree?: DiskTree } = {}) {
  const onOpen = vi.fn();
  const onNavigate = vi.fn();
  const explorer = mountDocExplorer(centerHost, {
    tree: () => over.tree ?? TREE,
    rootName: () => 'Casa',
    onOpen,
    onNavigate,
  });
  return { explorer, onOpen, onNavigate };
}

const names = (): string[] => [...centerHost.querySelectorAll('.doc-name')].map((n) => n.textContent!);
const crumbs = (): string[] => [...centerHost.querySelectorAll('.doc-crumb')].map((n) => n.textContent!);
const row = (name: string): HTMLElement =>
  [...centerHost.querySelectorAll<HTMLElement>('.doc-row')].find((r) => r.querySelector('.doc-name')!.textContent === name)!;
const dbl = (el: HTMLElement): void => void el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

describe('explorador del centro', () => {
  it('it shows the folders and files of the current folder, folders first, without what is inside', () => {
    mount();
    expect(names()).toEqual(['Memorias', 'Planos', 'Foto.jpg', 'Memoria.pdf']);
  });

  it('las columnas son Name, Date modified, Type y Size', () => {
    mount();
    expect([...centerHost.querySelectorAll('th')].map((th) => th.textContent))
      .toEqual(['Name', 'Date modified', 'Type', 'Size']);
  });

  it('each row carries its icon, its type and its size like the explorer', () => {
    mount();
    expect(row('Planos').querySelector('.doc-icon.is-folder')).not.toBeNull();
    expect(row('Memoria.pdf').querySelector('.doc-icon.is-file')).not.toBeNull();
    expect(row('Planos').querySelector('.doc-type')!.textContent).toBe('File folder');
    expect(row('Planos').querySelector('.doc-size')!.textContent).toBe('');
    expect(row('Memoria.pdf').querySelector('.doc-type')!.textContent).toBe('PDF Document');
    expect(row('Memoria.pdf').querySelector('.doc-size')!.textContent).toBe('4 KB'); // 3 KB y 1 byte, hacia arriba
    expect(row('Memoria.pdf').querySelector('.doc-date')!.textContent).not.toBe('');
  });

  it('doble clic en una carpeta entra: migas de pan, contenido y aviso al modo', () => {
    const { onNavigate } = mount();
    dbl(row('Planos'));
    expect(onNavigate).toHaveBeenCalledWith('Planos');
    expect(crumbs()).toEqual(['Casa', 'Planos']);
    expect(names()).toEqual(['Estructura', 'Nota.txt']);
  });

  it('go up with the button, with Backspace and with a breadcrumb', () => {
    const { explorer } = mount();
    dbl(row('Planos'));
    dbl(row('Estructura'));
    expect(crumbs()).toEqual(['Casa', 'Planos', 'Estructura']);
    expect(centerHost.querySelector<HTMLButtonElement>('.doc-up')!.disabled).toBe(false);
    centerHost.querySelector<HTMLButtonElement>('.doc-up')!.click();
    expect(explorer.folder()).toBe('Planos');
    centerHost.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(explorer.folder()).toBe('');
    expect(centerHost.querySelector<HTMLButtonElement>('.doc-up')!.disabled).toBe(true);
    dbl(row('Planos'));
    centerHost.querySelector<HTMLElement>('.doc-crumb[data-folder=""]')!.click();
    expect(explorer.folder()).toBe('');
  });

  it('doble clic en un archivo lo abre; un clic lo elige', () => {
    const { onOpen, explorer } = mount();
    row('Memoria.pdf').click();
    expect(explorer.selected()).toBe('Memoria.pdf');
    expect(row('Memoria.pdf').classList.contains('is-selected')).toBe(true);
    dbl(row('Memoria.pdf'));
    expect(onOpen).toHaveBeenCalledWith('Memoria.pdf');
  });

  it('elegir una carpeta no elige archivo', () => {
    const { explorer } = mount();
    row('Planos').click();
    expect(explorer.selected()).toBeNull();
    expect(row('Planos').classList.contains('is-selected')).toBe(true);
  });

  it('flechas y Enter: bajan por la lista y abren carpeta o archivo', () => {
    const { explorer, onOpen } = mount();
    const root = centerHost.querySelector('section')!;
    const key = (k: string) => root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown'); // Memorias
    key('ArrowDown'); // Planos
    key('Enter');
    expect(explorer.folder()).toBe('Planos');
    key('ArrowDown'); // Estructura
    key('ArrowDown'); // Nota.txt
    key('Enter');
    expect(onOpen).toHaveBeenCalledWith('Planos/Nota.txt');
    key('ArrowUp');
    expect(row('Estructura').classList.contains('is-selected')).toBe(true);
  });

  it('the search also looks inside the subfolders and clears when navigating', () => {
    const { explorer } = mount();
    const search = centerHost.querySelector<HTMLInputElement>('.doc-search')!;
    search.value = '0001';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['A-0001.pdf']);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    search.value = 'estruct';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['Estructura']);
    explorer.navigate('Planos');
    expect(search.value).toBe('');
  });

  it('a search without results says so', () => {
    mount();
    const search = centerHost.querySelector<HTMLInputElement>('.doc-search')!;
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    expect(centerHost.querySelector<HTMLElement>('.doc-empty')!.hidden).toBe(false);
    expect(centerHost.querySelector('.doc-empty')!.textContent).toBe('No items match your search');
  });

  it('sorting by size: folders stay first; another click reverses', () => {
    mount();
    const sort = (col: string) => centerHost.querySelector<HTMLButtonElement>(`th[data-col="${col}"] button`)!.click();
    sort('size');
    expect(names()).toEqual(['Memorias', 'Planos', 'Foto.jpg', 'Memoria.pdf']);
    sort('size');
    expect(names()).toEqual(['Memorias', 'Planos', 'Memoria.pdf', 'Foto.jpg']);
    expect(centerHost.querySelector('th[data-col="size"]')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorting by date puts the newest first', () => {
    mount();
    centerHost.querySelector<HTMLButtonElement>('th[data-col="date"] button')!.click();
    expect(names().slice(2)).toEqual(['Memoria.pdf', 'Foto.jpg']);
  });

  it('la barra de estado cuenta elementos y elegidos', () => {
    mount();
    const bar = () => centerHost.querySelector('.doc-statusbar')!.textContent!;
    expect(bar()).toBe('4 items');
    row('Memoria.pdf').click();
    expect(bar()).toContain('1 item selected');
    expect(bar()).toContain('4 KB');
  });

  it('an empty folder says so', () => {
    mount({ tree: { folders: [], files: [] } });
    expect(centerHost.querySelector('.doc-empty')!.textContent).toBe('This folder is empty');
    expect(centerHost.querySelector('.doc-statusbar')!.textContent).toBe('0 items');
  });

  it('typeName y sizeText', () => {
    expect(typeName('A.DWG', false)).toBe('AutoCAD Drawing');
    expect(typeName('Casa.ifcx', false)).toBe('IFCx Model');
    expect(typeName('x.abc', false)).toBe('ABC File');
    expect(typeName('LEEME', false)).toBe('File');
    expect(typeName('Planos', true)).toBe('File folder');
    expect(sizeText(0)).toBe('0 KB');
    expect(sizeText(1)).toBe('1 KB');
    expect(sizeText(1024)).toBe('1 KB');
    expect(sizeText(1025)).toBe('2 KB');
    expect(sizeText(1234 * 1024)).toBe('1,234 KB');
  });
});

describe('folder tree', () => {
  const mountTree = () => {
    const onSelect = vi.fn();
    const tree = mountDocTree(treeHost, { onSelect });
    tree.setRoot('Casa');
    tree.setFolders(TREE.folders);
    return { tree, onSelect };
  };
  const tnames = () => [...treeHost.querySelectorAll('.doc-tree-name')].map((n) => n.textContent);

  it('the root carries the project name and the child folders are shown collapsed', () => {
    mountTree();
    expect(tnames()).toEqual(['Casa', 'Memorias', 'Planos']);
  });

  it('el chevron despliega y pliega sin elegir la carpeta', () => {
    const { onSelect } = mountTree();
    treeHost.querySelector<HTMLElement>('[data-folder="Planos"] .doc-tree-chevron')!.click();
    expect(tnames()).toEqual(['Casa', 'Memorias', 'Planos', 'Estructura']);
    expect(treeHost.querySelector('[data-folder="Planos"]')!.getAttribute('aria-expanded')).toBe('true');
    treeHost.querySelector<HTMLElement>('[data-folder="Planos"] .doc-tree-chevron')!.click();
    expect(tnames()).toEqual(['Casa', 'Memorias', 'Planos']);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('choosing a folder notifies with its path; the root with empty', () => {
    const { onSelect } = mountTree();
    treeHost.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    expect(onSelect).toHaveBeenLastCalledWith('Planos');
    treeHost.querySelector<HTMLElement>('[data-folder=""]')!.click();
    expect(onSelect).toHaveBeenLastCalledWith('');
  });

  it('marking a deep folder expands the ones that contain it', () => {
    const { tree } = mountTree();
    tree.setSelected('Planos/Estructura');
    expect(tnames()).toEqual(['Casa', 'Memorias', 'Planos', 'Estructura']);
    expect(treeHost.querySelector('[data-folder="Planos/Estructura"]')!.classList.contains('is-selected')).toBe(true);
  });

  it('las flechas derecha e izquierda despliegan y pliegan', () => {
    mountTree();
    const planos = treeHost.querySelector<HTMLElement>('[data-folder="Planos"]')!;
    planos.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tnames()).toContain('Estructura');
    treeHost.querySelector<HTMLElement>('[data-folder="Planos"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tnames()).not.toContain('Estructura');
  });
});
