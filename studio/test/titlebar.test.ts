import { beforeEach, describe, expect, it, vi } from 'vitest';

const win = vi.hoisted(() => ({
  minimize: vi.fn(async () => {}),
  toggleMaximize: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  isMaximized: vi.fn(async () => false),
  onResized: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => win }));

import { mountTitlebar } from '../src/shell/titlebar';
import { setDocumentTitle } from '../src/shell/screens';
import { toast } from '../src/shell/toast';
import { THEME_STORAGE_KEY, getThemePref, initTheme, setThemePref } from '../src/shell/theme';

const qat = { onOpen: vi.fn(), onHome: vi.fn(), on3D: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onAssistant: vi.fn(), onHelp: vi.fn() };

let bar: ReturnType<typeof mountTitlebar>;
function mount(): HTMLElement {
  document.body.innerHTML = '<div id="app"><div id="titlebar"></div></div>';
  const el = document.getElementById('titlebar') as HTMLElement;
  bar = mountTitlebar(el, qat);
  return el;
}

const byTitle = (el: HTMLElement, t: string) => el.querySelector<HTMLButtonElement>(`button[title="${t}"]`);

describe('title bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('es zona de arrastre y muestra el nombre del producto', () => {
    const el = mount();
    expect(el.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(el.textContent).toContain('Dream BIM');
  });

  it('the quick access bar slot also drags the window', () => {
    const el = mount();
    expect(el.querySelector('.tb-qat')!.hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('it has the quick access bar', () => {
    const el = mount();
    for (const t of ['Open', 'Home', 'Undo', 'Redo', '3D View']) {
      expect(byTitle(el, t), t).not.toBeNull();
    }
    expect(byTitle(el, 'Undo')!.disabled).toBe(true);
    expect(byTitle(el, 'Redo')!.disabled).toBe(true);
    byTitle(el, 'Open')!.click();
    byTitle(el, 'Home')!.click();
    byTitle(el, '3D View')!.click();
    expect(qat.onOpen).toHaveBeenCalledOnce();
    expect(qat.onHome).toHaveBeenCalledOnce();
    expect(qat.on3D).toHaveBeenCalledOnce();
  });

  it('Undo and Redo are enabled with the history and their tooltip says what they do', () => {
    const el = mount();
    const undo = el.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!;
    const redo = el.querySelector<HTMLButtonElement>('button[aria-label="Redo"]')!;
    bar.setHistory({ undo: 'Move', redo: null });
    expect(undo.disabled).toBe(false);
    expect(undo.title).toBe('Undo Move (Ctrl+Z)');
    expect(redo.disabled).toBe(true);
    expect(redo.title).toBe('Redo');
    undo.click();
    expect(qat.onUndo).toHaveBeenCalledOnce();
    bar.setHistory({ undo: null, redo: 'Add Wall' });
    expect(undo.disabled).toBe(true);
    expect(redo.title).toBe('Redo Add Wall (Ctrl+Y)');
    redo.click();
    expect(qat.onRedo).toHaveBeenCalledOnce();
  });

  it('botones de ventana', () => {
    const el = mount();
    expect(byTitle(el, 'Minimize')).not.toBeNull();
    expect(byTitle(el, 'Maximize')).not.toBeNull();
    byTitle(el, 'Minimize')!.click();
    expect(win.minimize).toHaveBeenCalledOnce();
    byTitle(el, 'Maximize')!.click();
    expect(win.toggleMaximize).toHaveBeenCalledOnce();
    byTitle(el, 'Close')!.click();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('setDocumentTitle updates the title of the document and of the bar', () => {
    const el = mount();
    setDocumentTitle('torre', '3D View');
    expect(document.title).toBe('Dream BIM — torre — 3D View');
    expect(el.textContent).toContain('Dream BIM — torre — 3D View');
    setDocumentTitle('torre', null);
    expect(document.title).toBe('Dream BIM — torre');
    setDocumentTitle(null, null);
    expect(document.title).toBe('Dream BIM');
  });

  it('toast usa role=status y se descarta solo', () => {
    vi.useFakeTimers();
    toast('Hecho');
    toast('Fallo', 'error');
    const items = document.querySelectorAll('[role="status"]');
    expect(items.length).toBe(2);
    expect(items[1].classList.contains('toast-error')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(document.querySelectorAll('[role="status"]').length).toBe(0);
    vi.useRealTimers();
  });
});

describe('title bar: Theme button', () => {
  beforeEach(() => {
    localStorage.clear();
    initTheme(); // system
  });

  const menu = () => document.querySelector<HTMLElement>('.theme-menu');
  const radios = () => [...document.querySelectorAll<HTMLElement>('.theme-menu [role="menuitemradio"]')];

  it('there is a Theme button in the quick access bar, next to Undo and Redo', () => {
    const el = mount();
    const btn = byTitle(el, 'Theme')!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('Theme');
    expect(btn.closest('.tb-qat')).not.toBeNull();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('it opens a menu with three radios; the active preference is marked', () => {
    const el = mount();
    expect(menu()?.hidden ?? true).toBe(true);
    byTitle(el, 'Theme')!.click();
    expect(menu()!.hidden).toBe(false);
    expect(menu()!.getAttribute('role')).toBe('menu');
    expect(radios().map((r) => r.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(byTitle(el, 'Theme')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('choosing Dark applies the preference and closes the menu', () => {
    const el = mount();
    byTitle(el, 'Theme')!.click();
    radios()[1].click();
    expect(getThemePref()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(menu()!.hidden).toBe(true);
    expect(byTitle(el, 'Theme')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('refleja una preferencia cambiada desde otro sitio', () => {
    const el = mount();
    byTitle(el, 'Theme')!.click();
    setThemePref('light');
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('Esc closes the menu; a click outside too; the button toggles it', () => {
    const el = mount();
    const btn = byTitle(el, 'Theme')!;
    btn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu()!.hidden).toBe(true);
    btn.click();
    document.body.click();
    expect(menu()!.hidden).toBe(true);
    btn.click();
    btn.click();
    expect(menu()!.hidden).toBe(true);
  });

  it('las flechas mueven el foco entre las opciones', () => {
    const el = mount();
    byTitle(el, 'Theme')!.click();
    expect(document.activeElement).toBe(radios()[2]); // la activa recibe el foco
    radios()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(radios()[1]);
    radios()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    radios()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(radios()[0]); // da la vuelta
  });

  it('the Assistant button calls onAssistant', () => {
    const el = mount();
    byTitle(el, 'Assistant')!.click();
    expect(qat.onAssistant).toHaveBeenCalledTimes(1);
  });

  it('without onAssistant there is no Assistant button (secondary model windows)', () => {
    document.body.innerHTML = '<div id="titlebar"></div>';
    const el = document.getElementById('titlebar') as HTMLElement;
    const { onAssistant: _, ...sin } = qat;
    mountTitlebar(el, sin);
    expect(byTitle(el, 'Assistant')).toBeNull();
    expect(byTitle(el, 'Help (F1)')).not.toBeNull();
  });

  it('the Help button (F1) goes after Assistant and calls onHelp', () => {
    const el = mount();
    const help = byTitle(el, 'Help (F1)')!;
    expect(help.previousElementSibling).toBe(byTitle(el, 'Assistant'));
    help.click();
    expect(qat.onHelp).toHaveBeenCalledTimes(1);
  });
});

describe('title bar: mode tabs', () => {
  it('it leaves a slot for the mode tabs after the title', () => {
    const el = mount();
    expect(bar.modeHost.classList.contains('tb-modes')).toBe(true);
    expect(el.querySelector('.tb-title')!.nextElementSibling).toBe(bar.modeHost);
  });
});
