import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draggedAsset, LIBRARY_MIME, mountLibraryPanel, type LibraryEntry } from '../src/library/librarypanel';

const ROOT = 'C:\\lib';
const DISK: Record<string, LibraryEntry[]> = {
  [ROOT]: [
    { name: 'Muebles', path: 'C:\\lib\\Muebles', isDir: true },
    { name: 'Puerta.ifcx', path: 'C:\\lib\\Puerta.ifcx', isDir: false },
    { name: 'Ventana.ifcx', path: 'C:\\lib\\Ventana.ifcx', isDir: false },
  ],
  'C:\\lib\\Muebles': [{ name: 'Mesa.ifcx', path: 'C:\\lib\\Muebles\\Mesa.ifcx', isDir: false }],
  'C:\\vacia': [],
};

function setup(chosen: string | null = ROOT) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const cb = {
    chooseFolder: vi.fn(async () => chosen),
    list: vi.fn(async (dir: string) => {
      const l = DISK[dir];
      if (!l) throw new Error(`Could not read ${dir}`);
      return l;
    }),
    onFolderChange: vi.fn(),
    onActivate: vi.fn(),
  };
  const panel = mountLibraryPanel(host, cb);
  return { host, cb, panel };
}

const tiles = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.lib-tile')];
const names = (host: HTMLElement) => tiles(host).map((t) => t.querySelector('.lib-name')!.textContent);
const emptyText = (host: HTMLElement) => {
  const e = host.querySelector<HTMLElement>('.lib-empty')!;
  return e.hidden ? null : e.textContent;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    dropEffect: 'none', effectAllowed: 'all',
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? '',
  };
}

function fire(type: string, target: HTMLElement, extra: object = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, extra);
  target.dispatchEvent(e);
  return e;
}

beforeEach(() => vi.useRealTimers());

describe('Library panel', () => {
  it('without a folder it asks for one; Folder… lists it and remembers it', async () => {
    const { host, cb } = setup();
    expect(emptyText(host)).toMatch(/Choose a folder/);
    host.querySelector<HTMLButtonElement>('.lib-pick')!.click();
    await flush();
    await flush();
    expect(cb.onFolderChange).toHaveBeenCalledWith(ROOT);
    expect(names(host)).toEqual(['Muebles', 'Puerta', 'Ventana']); // without the extension
    expect(emptyText(host)).toBeNull();
  });

  it('a cancelled dialog changes nothing', async () => {
    const { host, cb } = setup(null);
    host.querySelector<HTMLButtonElement>('.lib-pick')!.click();
    await flush();
    expect(cb.onFolderChange).not.toHaveBeenCalled();
    expect(emptyText(host)).toMatch(/Choose a folder/);
  });

  it('double click on a folder enters it; the breadcrumb and Up go back to the root only', async () => {
    const { host, panel } = setup();
    await panel.setFolder(ROOT);
    const up = host.querySelector<HTMLButtonElement>('.lib-up')!;
    expect(up.disabled).toBe(true);
    fire('dblclick', tiles(host)[0]);
    await flush();
    expect(names(host)).toEqual(['Mesa']);
    expect([...host.querySelectorAll('.lib-crumb')].map((c) => c.textContent)).toEqual(['lib', 'Muebles']);
    expect(up.disabled).toBe(false);
    up.click();
    await flush();
    expect(names(host)).toEqual(['Muebles', 'Puerta', 'Ventana']);
    expect(up.disabled).toBe(true);
  });

  it('double click or Enter on a file activates it only with a document', async () => {
    const { host, cb, panel } = setup();
    await panel.setFolder(ROOT);
    fire('dblclick', tiles(host)[1]);
    expect(cb.onActivate).not.toHaveBeenCalled();
    panel.setEnabled(true);
    fire('dblclick', tiles(host)[1]);
    fire('keydown', tiles(host)[2], { key: 'Enter' });
    expect(cb.onActivate.mock.calls).toEqual([['C:\\lib\\Puerta.ifcx'], ['C:\\lib\\Ventana.ifcx']]);
  });

  it('dragging a file publishes its path until the drag ends; folders do not drag', async () => {
    const { host, panel } = setup();
    await panel.setFolder(ROOT);
    expect(tiles(host)[1].draggable).toBe(false);
    panel.setEnabled(true);
    const [dir, file] = tiles(host);
    expect(dir.draggable).toBe(false);
    expect(file.draggable).toBe(true);
    const dt = dataTransfer();
    fire('dragstart', file, { dataTransfer: dt });
    expect(draggedAsset()).toBe('C:\\lib\\Puerta.ifcx');
    expect(dt.getData(LIBRARY_MIME)).toBe('C:\\lib\\Puerta.ifcx');
    fire('dragend', file);
    expect(draggedAsset()).toBeNull();
  });

  it('search filters the current folder by name', async () => {
    vi.useFakeTimers();
    const { host, panel } = setup();
    await panel.setFolder(ROOT);
    const search = host.querySelector<HTMLInputElement>('.lib-search')!;
    search.value = 'vent';
    fire('input', search);
    vi.advanceTimersByTime(200);
    expect(names(host)).toEqual(['Ventana']);
    search.value = 'zzz';
    fire('input', search);
    vi.advanceTimersByTime(200);
    expect(emptyText(host)).toBe('No results');
  });

  it('an empty folder and an unreadable one say so', async () => {
    const { host, panel } = setup();
    await panel.setFolder('C:\\vacia');
    expect(emptyText(host)).toBe('No .ifcx files in this folder');
    await panel.setFolder('C:\\nope');
    expect(emptyText(host)).toBe('Could not read C:\\nope');
  });

  it('names from disk go in as text', async () => {
    DISK['C:\\x'] = [{ name: '<img src=x onerror=alert(1)>.ifcx', path: 'C:\\x\\a.ifcx', isDir: false }];
    const { host, panel } = setup();
    await panel.setFolder('C:\\x');
    expect(host.querySelector('img')).toBeNull();
  });
});

describe('Cards button', () => {
  it('it only appears with the action and notifies it', () => {
    const { host } = setup();
    expect(host.querySelector('.lib-cards')).toBeNull();
    const h = document.createElement('div');
    document.body.append(h);
    const onOpenCollection = vi.fn();
    mountLibraryPanel(h, { chooseFolder: async () => null, list: async () => [], onActivate: vi.fn(), onOpenCollection });
    h.querySelector<HTMLButtonElement>('.lib-cards')!.click();
    expect(onOpenCollection).toHaveBeenCalledOnce();
  });
});

describe('estructura tipo Content de Omniverse', () => {
  const nodes = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.lib-node')];
  const nodeNames = (host: HTMLElement) => nodes(host).map((n) => n.querySelector('.lib-node-name')!.textContent);

  it('the tree shows the root and opens its subfolders with the expander', async () => {
    const { host, panel } = setup();
    await panel.setFolder(ROOT);
    expect(nodeNames(host)).toEqual(['lib', 'Muebles']);
    nodes(host)[1].click(); // entering through the tree
    await flush();
    expect(names(host)).toEqual(['Mesa']);
    expect(nodes(host)[1].classList.contains('current')).toBe(true);
    host.querySelector<HTMLButtonElement>('.lib-toggle')!.click(); // collapsing the root
    expect(nodeNames(host)).toEqual(['lib']);
  });

  it('Back y Forward recorren las carpetas visitadas', async () => {
    const { host, panel } = setup();
    await panel.setFolder(ROOT);
    const back = host.querySelector<HTMLButtonElement>('.lib-back')!;
    const forward = host.querySelector<HTMLButtonElement>('.lib-forward')!;
    expect([back.disabled, forward.disabled]).toEqual([true, true]);
    fire('dblclick', tiles(host)[0]);
    await flush();
    expect([back.disabled, forward.disabled]).toEqual([false, true]);
    back.click();
    await flush();
    expect(names(host)).toEqual(['Muebles', 'Puerta', 'Ventana']);
    expect(forward.disabled).toBe(false);
    forward.click();
    await flush();
    expect(names(host)).toEqual(['Mesa']);
  });

  it('un clic elige la ficha y los detalles la describen; el hueco la suelta', async () => {
    const { host, panel } = setup();
    const details = () => host.querySelector<HTMLElement>('.lib-details')!;
    DISK[ROOT][1].mtime = Date.UTC(2024, 0, 15, 12);
    await panel.setFolder(ROOT);
    expect(details().textContent).toMatch(/No files selected/);
    tiles(host)[1].click();
    expect(tiles(host)[1].classList.contains('selected')).toBe(true);
    expect(details().querySelector('.lib-details-head')!.textContent).toBe('Puerta');
    expect(details().textContent).toMatch(/IFCx file/);
    expect(details().textContent).toContain(ROOT);
    host.querySelector<HTMLElement>('.lib-main')!.click();
    expect(details().textContent).toMatch(/No files selected/);
  });

  it('zoom changes the size of the cards', async () => {
    const { host } = setup();
    const zoom = host.querySelector<HTMLInputElement>('.lib-zoom')!;
    zoom.value = '120';
    fire('input', zoom);
    expect(host.querySelector<HTMLElement>('.lib-main')!.style.getPropertyValue('--lib-tile')).toBe('120px');
  });
});
