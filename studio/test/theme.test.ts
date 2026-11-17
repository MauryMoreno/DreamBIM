import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_STORAGE_KEY,
  getThemePref,
  initTheme,
  loadThemePref,
  onThemeChange,
  resolveTheme,
  setThemePref,
} from '../src/shell/theme';

/** fake matchMedia: `setDark` changes the "Windows" theme and notifies the listeners as the browser would. */
function mockSystem(dark: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn),
  };
  const fn = vi.fn(() => mql);
  vi.stubGlobal('matchMedia', fn);
  window.matchMedia = fn as unknown as typeof window.matchMedia;
  return {
    listeners,
    setDark(v: boolean) {
      mql.matches = v;
      for (const l of [...listeners]) l({ matches: v });
    },
  };
}

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete root().dataset.theme;
  root().style.colorScheme = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveTheme', () => {
  it('light y dark ignoran el sistema; system lo sigue', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('loadThemePref', () => {
  it('sin valor guardado es system', () => {
    expect(loadThemePref()).toBe('system');
  });
  it('lee light, dark y system', () => {
    for (const v of ['light', 'dark', 'system'] as const) {
      localStorage.setItem(THEME_STORAGE_KEY, v);
      expect(loadThemePref()).toBe(v);
    }
  });
  it('an invalid value is system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    expect(loadThemePref()).toBe('system');
  });
  it('si localStorage lanza, es system', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(loadThemePref()).toBe('system');
  });
});

describe('initTheme / setThemePref', () => {
  it('aplica la preferencia guardada al iniciar', () => {
    mockSystem(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initTheme();
    expect(getThemePref()).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
  });

  it('by default (system) it follows the system theme', () => {
    mockSystem(true);
    initTheme();
    expect(getThemePref()).toBe('system');
    expect(root().dataset.theme).toBe('dark');
  });

  it("setThemePref('dark') pone data-theme, persiste y avisa a los suscriptores", () => {
    mockSystem(false);
    initTheme();
    const seen: [string, string][] = [];
    const off = onThemeChange((p, t) => seen.push([p, t]));
    setThemePref('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(getThemePref()).toBe('dark');
    expect(seen).toEqual([['dark', 'dark']]);
    off();
  });

  it('unsubscribe deja de avisar', () => {
    mockSystem(false);
    initTheme();
    const fn = vi.fn();
    const off = onThemeChange(fn);
    off();
    setThemePref('dark');
    expect(fn).not.toHaveBeenCalled();
  });

  it('con system, un cambio del tema de Windows se aplica en vivo y avisa', () => {
    const sys = mockSystem(false);
    initTheme();
    const fn = vi.fn();
    const off = onThemeChange(fn);
    sys.setDark(true);
    expect(root().dataset.theme).toBe('dark');
    expect(fn).toHaveBeenLastCalledWith('system', 'dark');
    sys.setDark(false);
    expect(root().dataset.theme).toBe('light');
    off();
  });

  it('with light or dark fixed it ignores the system changes', () => {
    const sys = mockSystem(false);
    initTheme();
    setThemePref('light');
    sys.setDark(true);
    expect(root().dataset.theme).toBe('light');
    setThemePref('dark');
    sys.setDark(false);
    expect(root().dataset.theme).toBe('dark');
  });

  it('volver a system adopta el tema actual del sistema', () => {
    mockSystem(true);
    initTheme();
    setThemePref('light');
    expect(root().dataset.theme).toBe('light');
    setThemePref('system');
    expect(root().dataset.theme).toBe('dark');
  });

  it('si no se puede guardar, funciona en memoria', () => {
    mockSystem(false);
    initTheme();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cuota');
    });
    expect(() => setThemePref('dark')).not.toThrow();
    expect(getThemePref()).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
  });

  it('volver a llamar a initTheme no acumula oyentes de matchMedia', () => {
    const sys = mockSystem(false);
    initTheme();
    initTheme();
    expect(sys.listeners.size).toBe(1);
  });
});

describe('script inline de index.html (sin destello al arrancar)', () => {
  const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
  const file = /<script src="\.\/(theme-boot\.js)"><\/script>/.exec(html)?.[1] ?? '';
  const script = file ? readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../public', file), 'utf8') : '';

  it('it exists as a file, goes before the module script and uses the same key', () => {
    expect(script).not.toBe('');
    expect(html.indexOf('theme-boot.js')).toBeLessThan(html.indexOf('type="module"'));
    expect(script).toContain(THEME_STORAGE_KEY);
  });

  it('index.html has no inline script (the CSP requires it)', () => {
    expect(/<script(?![^>]*\bsrc=)[^>]*>/.test(html)).toBe(false);
  });

  it('it decides the same theme as resolveTheme for all the combinations', () => {
    for (const stored of [null, 'light', 'dark', 'system', 'basura']) {
      for (const dark of [false, true]) {
        localStorage.clear();
        delete root().dataset.theme;
        if (stored) localStorage.setItem(THEME_STORAGE_KEY, stored);
        mockSystem(dark);
        new Function(script)();
        const pref = stored === 'light' || stored === 'dark' ? stored : 'system';
        expect(root().dataset.theme, `${stored}/${dark}`).toBe(resolveTheme(pref, dark));
        expect(root().style.colorScheme).toBe(root().dataset.theme);
      }
    }
  });

  it('no falla si localStorage lanza', () => {
    mockSystem(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(() => new Function(script)()).not.toThrow();
    expect(root().dataset.theme).toBe('dark');
  });
});
