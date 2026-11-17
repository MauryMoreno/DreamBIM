import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IfcxFile } from '../src/ifcx/types';
import type { CardInfo } from '../src/collection/cardinfo';
import { mountCollection, type CardViewer } from '../src/collection/collection';
import { createThumbRenderer } from '../src/collection/thumbs';
import type { IndexerDeps } from '../src/collection/indexer';
import { memoryStore, type CardRecord } from '../src/collection/store';
import type { LibraryEntry } from '../src/library/librarypanel';

const file = (path: string): LibraryEntry => ({ name: path.split('/').at(-1)!, path, isDir: false, mtime: 1 });
const dir = (path: string): LibraryEntry => ({ name: path.split('/').at(-1)!, path, isDir: true, mtime: 1 });

const DISK: Record<string, LibraryEntry[]> = {
  '/lib': [dir('/lib/hvac'), dir('/lib/fontaneria')],
  '/lib/hvac': [file('/lib/hvac/grille.ifcx'), file('/lib/hvac/duct.ifcx')],
  '/lib/fontaneria': [file('/lib/fontaneria/elbow.ifcx')],
  '/vacia': [],
};

const info = (path: string, over: Partial<CardInfo> = {}): CardInfo => ({
  path,
  name: path.split('/').at(-1)!.replace('.ifcx', ''),
  ifcClass: 'IfcPipeFitting',
  reference: null,
  description: null,
  discipline: path.split('/')[2],
  typeFolder: path.split('/')[2],
  dims: {},
  extra: [],
  meshes: 1,
  materials: 1,
  lods: [{ level: 0, triangles: 10, error: 0 }],
  ...over,
});

const ifcx = {} as IfcxFile;
const flush = () => new Promise((r) => setTimeout(r, 80));
const afterDebounce = () => new Promise((r) => setTimeout(r, 250));

function setup(pageSize?: number) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  let handlers!: Pick<IndexerDeps, 'onCard' | 'onProgress'>;
  const indexer = { run: vi.fn(), cancel: vi.fn(), load: vi.fn(async (_path: string) => ifcx) };
  const store = memoryStore();
  const viewers: { setModel: ReturnType<typeof vi.fn>; setLod: ReturnType<typeof vi.fn>; fit: ReturnType<typeof vi.fn>; disposeModel: ReturnType<typeof vi.fn> }[] = [];
  const cb = {
    list: vi.fn(async (d: string) => {
      const l = DISK[d];
      if (!l) throw new Error(`Could not read ${d}`);
      return l;
    }),
    chooseFolder: vi.fn(async () => '/lib' as string | null),
    onFolderChange: vi.fn(),
    onBack: vi.fn(),
    onPlace: vi.fn(),
  };
  const deps = {
    createIndexer: vi.fn((h: Pick<IndexerDeps, 'onCard' | 'onProgress'>) => {
      handlers = h;
      return indexer;
    }),
    store,
    renderThumb: vi.fn((): string | null => 'data:image/png;base64,TT'),
    createViewer: vi.fn((): CardViewer => {
      const v = { setModel: vi.fn(), setLod: vi.fn(), fit: vi.fn(), disposeModel: vi.fn() };
      viewers.push(v);
      return v as never;
    }),
  };
  const col = mountCollection(host, cb, pageSize ? { ...deps, pageSize } : deps);
  const card = (path: string, rec: CardRecord = { info: info(path) }) => handlers.onCard(path, rec);
  const cards = () => [...host.querySelectorAll<HTMLElement>('.card-small')];
  const names = () => cards().map((c) => c.querySelector('.card-name')!.textContent);
  const empty = () => {
    const e = host.querySelector<HTMLElement>('.col-empty')!;
    return e.hidden ? null : e.querySelector('.col-empty-text')!.textContent;
  };
  return { host, indexer, store, cb, deps, col, viewers, handlers: () => handlers, card, cards, names, empty };
}

const ALL = ['/lib/hvac/grille.ifcx', '/lib/hvac/duct.ifcx', '/lib/fontaneria/elbow.ifcx'];

beforeEach(() => vi.stubGlobal('IntersectionObserver', undefined));
afterEach(() => vi.unstubAllGlobals());

describe('one card per indexed file', () => {
  it('Collection: filters', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    expect(s.indexer.run).toHaveBeenCalledTimes(1);
    expect(s.indexer.run.mock.calls[0][0].map((e: LibraryEntry) => e.path)).toEqual([
      '/lib/hvac/grille.ifcx',
      '/lib/hvac/duct.ifcx',
      '/lib/fontaneria/elbow.ifcx',
    ]);
  });

  it('by text: name, reference or description, case-insensitive', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    ALL.forEach((p) => s.card(p));
    await flush();
    expect(s.cards()).toHaveLength(3);
    expect(s.names()).toEqual(['grille', 'duct', 'elbow']);
  });

  it('un archivo con error sale como carta de error', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0], { error: 'Not a valid IFCX file: boom' });
    await flush();
    expect(s.host.querySelector('.card-error')!.textContent).toContain('Not a valid IFCX file: boom');
  });

  it('muestra el progreso y lo oculta al terminar', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.handlers().onProgress(1, 3);
    const p = s.host.querySelector<HTMLElement>('.col-progress')!;
    expect(p.hidden).toBe(false);
    expect(p.textContent).toBe('Indexing 1 / 3');
    s.handlers().onProgress(3, 3);
    expect(p.hidden).toBe(true);
  });
});

describe('Collection: folder', () => {
  async function filled() {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0], { info: info(ALL[0], { name: 'Return Grille', ifcClass: 'IfcAirTerminal', reference: '16x4' }) });
    s.card(ALL[1], { info: info(ALL[1], { name: 'Duct', ifcClass: 'IfcDuctFitting', description: 'Un conducto con rejilla' }) });
    s.card(ALL[2], { info: info(ALL[2], { name: 'Elbow', ifcClass: 'IfcPipeFitting' }) });
    await flush();
    return s;
  }
  const pick = (s: ReturnType<typeof setup>, sel: string, value: string) => {
    const e = s.host.querySelector<HTMLSelectElement>(sel)!;
    e.value = value;
    e.dispatchEvent(new Event('change'));
  };

  it('por disciplina', async () => {
    const s = await filled();
    pick(s, '.col-disc', 'fontaneria');
    expect(s.names()).toEqual(['Elbow']);
  });

  it('por clase IFC', async () => {
    const s = await filled();
    pick(s, '.col-class', 'IfcDuctFitting');
    expect(s.names()).toEqual(['Duct']);
  });

  it('without a folder it shows the message and the button to choose one', async () => {
    const s = await filled();
    const q = s.host.querySelector<HTMLInputElement>('.col-search')!;
    q.value = 'REJILLA';
    q.dispatchEvent(new Event('input'));
    await afterDebounce();
    expect(s.names()).toEqual(['Duct']);
    q.value = '16x4';
    q.dispatchEvent(new Event('input'));
    await afterDebounce();
    expect(s.names()).toEqual(['Return Grille']);
    q.value = 'nada';
    q.dispatchEvent(new Event('input'));
    await afterDebounce();
    expect(s.empty()).toBe('No results');
  });
});

describe('an unreadable root shows the error', () => {
  it('Collection: thumbnails', async () => {
    const s = setup();
    await s.col.setFolder(null);
    expect(s.empty()).toContain('Choose a folder with .ifcx files');
    s.host.querySelector<HTMLButtonElement>('.col-choose')!.click();
    await flush();
    expect(s.cb.chooseFolder).toHaveBeenCalled();
    expect(s.cb.onFolderChange).toHaveBeenCalledWith('/lib');
    expect(s.indexer.run).toHaveBeenCalled();
  });

  it('it uses the one from the cache without reading the file', async () => {
    const s = setup();
    await s.col.setFolder('/no-existe');
    expect(s.empty()).toBe('Could not read /no-existe');
    expect(s.indexer.run).not.toHaveBeenCalled();
  });

  it('una carpeta sin fichas lo dice', async () => {
    const s = setup();
    await s.col.setFolder('/vacia');
    expect(s.empty()).toBe('No .ifcx files in this folder');
  });

  it('onHide cancela el indexador', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.indexer.cancel.mockClear();
    s.col.onHide();
    expect(s.indexer.cancel).toHaveBeenCalled();
  });

  it('Back avisa', async () => {
    const s = setup();
    s.host.querySelector<HTMLButtonElement>('.col-back')!.click();
    expect(s.cb.onBack).toHaveBeenCalled();
  });
});

describe('Collection: big card', () => {
  it('Enter on a card also opens it', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0], { info: info(ALL[0]), thumb: 'data:image/png;base64,CACHE' });
    await flush();
    expect(s.cards()[0].querySelector<HTMLImageElement>('img')!.src).toBe('data:image/png;base64,CACHE');
    expect(s.indexer.load).not.toHaveBeenCalled();
    expect(s.deps.renderThumb).not.toHaveBeenCalled();
  });

  it('genera y guarda la que falta', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0]);
    await flush();
    expect(s.indexer.load).toHaveBeenCalledWith(ALL[0]);
    expect(s.deps.renderThumb).toHaveBeenCalledWith(ifcx);
    expect(s.cards()[0].querySelector<HTMLImageElement>('img')!.src).toBe('data:image/png;base64,TT');
    expect((await s.store.get(`${ALL[0]}|1`))!.thumb).toBe('data:image/png;base64,TT');
  });

  it('createThumbRenderer compone el archivo y pide la miniatura al visor', () => {
    const viewer = { setModel: vi.fn(), thumbnail: vi.fn((_paths: string[], _w?: number, _h?: number) => 'data:image/png;base64,V'), disposeModel: vi.fn() };
    const render = createThumbRenderer(() => viewer as never);
    const f: IfcxFile = {
      header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' },
      imports: [],
      schemas: {},
      data: [{ path: 'r', attributes: { 'bsi::ifc::class': { code: 'IfcWall' } } }],
    };
    expect(render(f)).toBe('data:image/png;base64,V');
    expect(viewer.setModel).toHaveBeenCalledTimes(1);
    expect(viewer.thumbnail.mock.calls[0][0]).toEqual(['/r']);
  });
});

const valid: IfcxFile = {
  header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' },
  imports: [],
  schemas: {},
  data: [{ path: 'r', attributes: { 'bsi::ifc::class': { code: 'IfcWall' } } }],
};
const withLods = (path: string): CardRecord => ({
  info: info(path, {
    lods: [
      { level: 0, triangles: 100, error: 0 },
      { level: 1, triangles: 40, error: 0.002 },
      { level: 2, triangles: 10, error: 0.007 },
    ],
  }),
});
const deferred = () => {
  let resolve!: (f: IfcxFile) => void;
  const promise = new Promise<IfcxFile>((r) => (resolve = r));
  return { promise, resolve };
};
const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

describe('choosing a LOD sets it in the viewer and marks the button', () => {
  async function opened() {
    const s = setup();
    s.indexer.load.mockResolvedValue(valid);
    await s.col.setFolder('/lib');
    s.card(ALL[0], withLods(ALL[0]));
    await flush();
    s.cards()[0].click();
    await flush();
    return s;
  }

  it('abre la carta grande con un visor y le pasa el modelo', async () => {
    const s = await opened();
    expect(s.host.querySelector('.card-large')).not.toBeNull();
    expect(s.deps.createViewer).toHaveBeenCalledTimes(1);
    expect(s.viewers[0].setModel).toHaveBeenCalledTimes(1);
    expect(s.viewers[0].fit).toHaveBeenCalled();
  });

  it('the × button and the background also close it', async () => {
    const s = setup();
    s.indexer.load.mockResolvedValue(valid);
    await s.col.setFolder('/lib');
    s.card(ALL[0], withLods(ALL[0]));
    await flush();
    s.cards()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(s.host.querySelector('.card-large')).not.toBeNull();
  });

  it('a late answer does not paint on the new card nor on a released viewer', async () => {
    const s = await opened();
    const bs = () => [...s.host.querySelectorAll<HTMLButtonElement>('.card-large .card-lods button')];
    bs()[1].click();
    expect(s.viewers[0].setLod).toHaveBeenLastCalledWith({ enabled: true, force: 1 });
    expect(bs().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('Esc la cierra y libera el visor', async () => {
    const s = await opened();
    esc();
    expect(s.host.querySelector('.card-large')).toBeNull();
    expect(s.viewers[0].disposeModel).toHaveBeenCalled();
  });

  it('it reuses a single viewer (each Viewer is a WebGL context)', async () => {
    const s = await opened();
    s.host.querySelector<HTMLButtonElement>('.col-close')!.click();
    expect(s.host.querySelector('.card-large')).toBeNull();
    s.cards()[0].click();
    s.host.querySelector<HTMLElement>('.col-overlay')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(s.host.querySelector('.card-large')).toBeNull();
  });

  it('Place warns; without a document it is disabled', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0], withLods(ALL[0]));
    s.card(ALL[1], withLods(ALL[1]));
    await flush();
    const a = deferred();
    const b = deferred();
    s.indexer.load.mockImplementation(async (p: string) => (p === ALL[0] ? a.promise : b.promise));
    s.cards()[0].click();
    esc();
    s.cards()[1].click();
    b.resolve(valid);
    await flush();
    a.resolve(valid); // llega tarde
    await flush();
    expect(s.viewers[0].setModel).toHaveBeenCalledTimes(1); // solo el de B
    esc();
    const c = deferred();
    s.indexer.load.mockImplementation(async () => c.promise);
    s.cards()[0].click();
    esc();
    c.resolve(valid);
    await flush();
    expect(s.viewers[0].setModel).toHaveBeenCalledTimes(1);
  });

  it('Collection: fixes from the final review', async () => {
    const s = await opened();
    esc();
    s.cards()[0].click();
    await flush();
    expect(s.deps.createViewer).toHaveBeenCalledTimes(1);
    expect(s.viewers[0].setModel).toHaveBeenCalledTimes(2);
  });

  it('the queue had the second job pending', async () => {
    const s = await opened();
    const place = () => s.host.querySelector<HTMLButtonElement>('.col-place')!;
    s.col.setCanPlace(false);
    expect(place().disabled).toBe(true);
    s.col.setCanPlace(true);
    expect(place().disabled).toBe(false);
    place().click();
    expect(s.cb.onPlace).toHaveBeenCalledWith(ALL[0]);
  });

  it('onHide cierra la carta grande', async () => {
    const s = await opened();
    s.col.onHide();
    expect(s.host.querySelector('.card-large')).toBeNull();
  });
});

describe('Esc in the search with text clears it instead of going back', () => {
  it('las miniaturas pendientes al ocultar la pantalla se piden al volver', async () => {
    const s = setup();
    const first = deferred();
    s.indexer.load.mockImplementation(async (p: string) => (p === ALL[0] ? first.promise : ifcx));
    await s.col.setFolder('/lib');
    s.card(ALL[0]);
    s.card(ALL[1]);
    await flush();
    s.col.onHide(); // 240 ms of arrivals in a row, without a pause: the grid has already been painted
    first.resolve(valid);
    await flush();
    expect(s.cards()[1].querySelector('img')).toBeNull();
    s.col.onShow();
    await flush();
    expect(s.cards()[1].querySelector('img')).not.toBeNull();
  });

  it('Esc sin carta grande vuelve; con ella abierta solo la cierra', async () => {
    const s = setup();
    s.indexer.load.mockResolvedValue(valid);
    await s.col.setFolder('/lib');
    s.card(ALL[0], withLods(ALL[0]));
    await flush();
    esc();
    expect(s.cb.onBack).toHaveBeenCalledTimes(1);
    s.cards()[0].click();
    esc();
    expect(s.host.querySelector('.card-large')).toBeNull();
    expect(s.cb.onBack).toHaveBeenCalledTimes(1);
  });

  it('Esc no hace nada con la pantalla oculta', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.col.onHide();
    esc();
    expect(s.cb.onBack).not.toHaveBeenCalled();
  });

  it('with an unreadable root the button to choose another folder remains', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    const q = s.host.querySelector<HTMLInputElement>('.col-search')!;
    q.value = 'algo';
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(q.value).toBe('');
    expect(s.cb.onBack).not.toHaveBeenCalled();
  });

  it('pinta las cartas mientras siguen llegando otras', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    for (let i = 0; i < 12; i++) {
      s.card(ALL[0], { info: info(ALL[0], { name: `n${i}` }) });
      await new Promise((r) => setTimeout(r, 20));
    }
    // the big card says which size it is among those of its kind
    expect(s.cards()).toHaveLength(1);
  });

  it('un aviso repetido de la misma carta no la reconstruye', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    s.card(ALL[0]);
    await flush();
    const before = s.cards()[0];
    s.card(ALL[0]);
    await flush();
    expect(s.cards()[0]).toBe(before);
  });

  it('Collection: pages', async () => {
    const s = setup();
    await s.col.setFolder('/no-existe');
    expect(s.host.querySelector<HTMLElement>('.col-choose')!.hidden).toBe(false);
  });

  it('it only paints the cards of the current page', async () => {
    const s = setup();
    s.indexer.load.mockResolvedValue(valid);
    await s.col.setFolder('/lib');
    s.card(ALL[0], withLods(ALL[0]));
    s.card(ALL[1], withLods(ALL[1]));
    await flush();
    s.cards()[1].click();
    expect(s.host.querySelector('.card-large .card-foot')!.textContent).toContain('2 / 2 sizes');
  });
});

describe('Next and Previous change page', () => {
  async function paged() {
    const s = setup(2);
    await s.col.setFolder('/lib');
    ALL.forEach((p) => s.card(p));
    await flush();
    const $ = <T extends HTMLElement>(sel: string) => s.host.querySelector<T>(sel)!;
    return { ...s, prev: () => $<HTMLButtonElement>('.col-prev'), next: () => $<HTMLButtonElement>('.col-next'), pager: () => $('.col-pager') };
  }

  it('a filter goes back to the first page', async () => {
    const s = await paged();
    expect(s.names()).toEqual(['grille', 'duct']);
    expect(s.pager().hidden).toBe(false);
    expect(s.pager().textContent).toContain('1–2 of 3');
    expect(s.prev().disabled).toBe(true);
    expect(s.next().disabled).toBe(false);
  });

  it('it fits in one page', async () => {
    const s = await paged();
    s.next().click();
    expect(s.names()).toEqual(['elbow']);
    expect(s.pager().textContent).toContain('3–3 of 3');
    expect(s.next().disabled).toBe(true);
    s.prev().click();
    expect(s.names()).toEqual(['grille', 'duct']);
  });

  it('it only requests thumbnails of the cards of the visible page', async () => {
    const s = await paged();
    s.next().click();
    const disc = s.host.querySelector<HTMLSelectElement>('.col-disc')!;
    disc.value = 'hvac';
    disc.dispatchEvent(new Event('change'));
    expect(s.names()).toEqual(['grille', 'duct']);
    expect(s.pager().hidden).toBe(true); // the pending thumbnails of another page are discarded when changing
  });

  it('Collection: Pokedex', async () => {
    const s = await paged();
    await flush();
    expect(s.indexer.load.mock.calls.map((c) => c[0])).toEqual([ALL[0], ALL[1]]);
  });

  it('each card carries its entry number, stable across pages', async () => {
    const s = setup(2);
    const first = deferred();
    s.indexer.load.mockImplementation(async (p: string) => (p === ALL[0] ? first.promise : ifcx));
    await s.col.setFolder('/lib');
    ALL.forEach((p) => s.card(p));
    await flush();
    s.host.querySelector<HTMLButtonElement>('.col-next')!.click(); // duct queda en cola, ya fuera de pantalla
    first.resolve(valid);
    await flush();
    expect(s.indexer.load.mock.calls.map((c) => c[0])).not.toContain(ALL[1]);
    expect(s.indexer.load.mock.calls.map((c) => c[0])).toContain(ALL[2]);
  });

  it('sin paginar no hay controles', async () => {
    const s = setup();
    await s.col.setFolder('/lib');
    ALL.forEach((p) => s.card(p));
    await flush();
    expect(s.host.querySelector<HTMLElement>('.col-pager')!.hidden).toBe(true);
  });
});

describe('the big card compares the measures with the largest of the library', () => {
  it('put merges with what was there', async () => {
    const s = setup(2);
    await s.col.setFolder('/lib');
    ALL.forEach((p) => s.card(p));
    await flush();
    expect(s.cards().map((c) => c.querySelector('.card-num')!.textContent)).toEqual(['#001', '#002']);
    s.host.querySelector<HTMLButtonElement>('.col-next')!.click();
    expect(s.cards()[0].querySelector('.card-num')!.textContent).toBe('#003');
  });

  it('without colors there is no overlay and the state is empty', async () => {
    const s = setup();
    s.indexer.load.mockResolvedValue(valid);
    await s.col.setFolder('/lib');
    s.card(ALL[0], { info: info(ALL[0], { dims: { width: 1 } }) });
    s.card(ALL[1], { info: info(ALL[1], { dims: { width: 4 } }) });
    await flush();
    s.cards()[0].click();
    expect(s.host.querySelector<HTMLElement>('.card-large .card-bar-fill')!.style.width).toBe('25%');
    expect(s.host.querySelector('.card-large .card-num')!.textContent).toBe('#001');
  });
});
