import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleOf, renderHome, type HomeActions } from '../src/home/home';
import type { RecentEntry } from '../src/home/recents';

type R = RecentEntry & { missing: boolean };

const entry = (name: string, extra: Partial<R> = {}): R => ({
  path: `C:\modelos\${name}.ifcx`,
  name: `${name}.ifcx`,
  openedAt: Date.UTC(2026, 9, 22, 12),
  thumbnail: null,
  missing: false,
  ...extra,
});

function actions(): HomeActions {
  return { onOpen: vi.fn(), onNew: vi.fn(), onOpenRecent: vi.fn(), onRemoveRecent: vi.fn() };
}

let el: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="home"></div>';
  el = document.getElementById('home') as HTMLElement;
});

const btn = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('pantalla de inicio', () => {
  it('la columna izquierda tiene Open, New e Import IFC (deshabilitado)', () => {
    const a = actions();
    renderHome(el, [], a);
    const open = btn('Open…')!;
    const nuevo = btn('New…')!;
    const importIfc = btn('Import IFC…')!;
    expect(open && nuevo && importIfc).toBeTruthy();
    expect(importIfc.disabled).toBe(true);
    expect(importIfc.title).toBe('Coming soon');
    open.click();
    nuevo.click();
    expect(a.onOpen).toHaveBeenCalledOnce();
    expect(a.onNew).toHaveBeenCalledOnce();
  });

  it('it shows one card per recent, with a placeholder if there is no thumbnail', () => {
    const list = [entry('torre'), entry('casa', { thumbnail: 'data:image/png;base64,AAAA' })];
    renderHome(el, list, actions());
    const cards = el.querySelectorAll('.recent-card');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('torre.ifcx');
    expect(cards[0].querySelector('.thumb-empty')).not.toBeNull();
    expect(cards[1].textContent).toContain('casa.ifcx');
    expect(cards[1].querySelector('.thumb-empty')).toBeNull();
    expect(cards[1].querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('formatea la fecha en en-US', () => {
    renderHome(el, [entry('torre')], actions());
    const esperado = new Date(Date.UTC(2026, 9, 22, 12)).toLocaleDateString('en-US');
    expect(el.querySelector('.recent-card')!.textContent).toContain(esperado);
  });

  it('clic en una tarjeta normal abre el reciente', () => {
    const a = actions();
    const e = entry('torre');
    renderHome(el, [e], a);
    (el.querySelector('.recent-card') as HTMLElement).click();
    expect(a.onOpenRecent).toHaveBeenCalledWith(expect.objectContaining({ path: e.path }));
  });

  it('una tarjeta ausente lleva .missing, No encontrado y Quitar; no se abre', () => {
    const a = actions();
    const e = entry('perdido', { missing: true });
    renderHome(el, [e], a);
    const card = el.querySelector('.recent-card') as HTMLElement;
    expect(card.classList.contains('missing')).toBe(true);
    expect(card.textContent).toContain('Not found');
    card.click();
    expect(a.onOpenRecent).not.toHaveBeenCalled();
    const remove = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Remove')!;
    remove.click();
    expect(a.onRemoveRecent).toHaveBeenCalledWith(e.path);
    expect(a.onOpenRecent).not.toHaveBeenCalled();
  });

  it('without recents it shows the empty text', () => {
    renderHome(el, [], actions());
    expect(el.textContent).toContain('No recent models yet');
    expect(el.querySelectorAll('.recent-card').length).toBe(0);
  });

  it('volver a renderizar reemplaza el contenido', () => {
    renderHome(el, [entry('a')], actions());
    renderHome(el, [entry('a'), entry('b')], actions());
    expect(el.querySelectorAll('.recent-card').length).toBe(2);
    expect(el.querySelectorAll('.home-side').length).toBe(1);
  });

  it('without onRevitAddin there is no add-in button', () => {
    renderHome(el, [], actions());
    expect(btn('Revit add-in')).toBeUndefined();
  });

  it('with onRevitAddin the button appears after Import IFC and calls the action', () => {
    const a = { ...actions(), onRevitAddin: vi.fn() };
    renderHome(el, [], a);
    const labels = [...el.querySelectorAll('.home-action')].map((b) => b.textContent);
    expect(labels.indexOf('Revit add-in…')).toBe(labels.indexOf('Import IFC…') + 1);
    btn('Revit add-in')!.click();
    expect(a.onRevitAddin).toHaveBeenCalledOnce();
  });

  it('Collection only appears if there is an action and it notifies it', () => {
    renderHome(el, [], actions());
    expect(btn('Collection')).toBeUndefined();
    const a = { ...actions(), onCollection: vi.fn() };
    renderHome(el, [], a);
    btn('Collection')!.click();
    expect(a.onCollection).toHaveBeenCalledOnce();
  });

  describe('modelos de ejemplo', () => {
    const examples = [
      { path: '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx', name: 'S-0001', folder: '01_WIP · EST' },
      { path: '/Snowdon Towers Example/01_WIP/ARQ/A-0003.ifcx', name: 'A-0003', folder: '01_WIP · ARQ' },
    ];
    const cards = () => [...el.querySelectorAll<HTMLElement>('.home-examples .recent-card')];

    it('van en la mitad inferior, bajo Recent, con su nombre y carpeta', () => {
      renderHome(el, [], actions(), examples);
      expect(cards().map((c) => c.querySelector('.recent-name')?.textContent)).toEqual(['S-0001', 'A-0003']);
      expect(cards()[0].querySelector('.recent-date')?.textContent).toBe('01_WIP · EST');
      expect(el.querySelector('.home-examples h2')?.textContent).toBe('Examples');
      const sections = [...el.querySelectorAll('.home-main > section')].map((s) => s.className);
      expect(sections).toEqual(['home-recents', 'home-examples']);
    });

    it('clic en una tarjeta de ejemplo la abre', () => {
      const a = { ...actions(), onOpenExample: vi.fn() };
      renderHome(el, [], a, examples);
      cards()[1].click();
      expect(a.onOpenExample).toHaveBeenCalledWith(examples[1]);
    });

    it('exampleOf: name without .ifcx and folder without the project root', () => {
      expect(exampleOf({ name: 'S-0001.ifcx', path: '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx', isDir: false })).toEqual({
        path: '/Snowdon Towers Example/01_WIP/EST/S-0001.ifcx',
        name: 'S-0001',
        folder: '01_WIP · EST',
      });
      expect(exampleOf({ name: 'Mesa.ifcx', path: '/Snowdon Towers Example/Mesa.ifcx', isDir: false }).folder).toBe('');
    });

    it('without examples there is no section (desktop)', () => {
      renderHome(el, [], actions());
      expect(el.querySelector('.home-examples')).toBeNull();
      expect(el.textContent).not.toContain('Examples');
    });
  });
});

