// Tema de la interfaz: preferencia del usuario (claro, oscuro o el del sistema), su persistencia y
// its application to the document. The colors live in styles/tokens.css, which reacts to
// <html data-theme="light|dark">. The script of index.html repeats this minimal logic to
// paint the first frame with the right theme (a test keeps them equal).

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ifcx-studio-theme';

/** Colors of the viewer grid (0xRRGGBB, the three.js format) by theme: center line and the rest. */
/** Aristas y bordes de los muros cortados: oscuros sobre fondo claro, claros sobre fondo oscuro. */
export const CUT_COLORS: Record<Theme, number> = { light: 0x2f343a, dark: 0xdfe3e8 };

/** Faces in Hidden Line: the color of the view background, as in Revit (in dark, under light edges). */
export const HIDDEN_FACE_COLORS: Record<Theme, number> = { light: 0xffffff, dark: 0x2a3039 };

export const GRID_COLORS: Record<Theme, { center: number; line: number }> = {
  light: { center: 0x8a94a3, line: 0xc4cad3 }, // the usual ones of the viewer
  dark: { center: 0x738096, line: 0x465061 },
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

type Listener = (pref: ThemePref, theme: Theme) => void;

let pref: ThemePref = 'system';
const listeners = new Set<Listener>();
let media: MediaQueryList | null = null;

export function resolveTheme(p: ThemePref, systemPrefersDark: boolean): Theme {
  if (p === 'system') return systemPrefersDark ? 'dark' : 'light';
  return p;
}

function isPref(v: unknown): v is ThemePref {
  return v === 'light' || v === 'dark' || v === 'system';
}

function systemMedia(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  } catch {
    return null;
  }
}

/** Saved preference; missing, invalid or with inaccessible localStorage it is "system". */
export function loadThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function getThemePref(): ThemePref {
  return pref;
}

/** Tema efectivo ahora mismo (el de la preferencia, o el del sistema si es «system»). */
export function getTheme(): Theme {
  return resolveTheme(pref, systemMedia()?.matches ?? false);
}

function apply(): void {
  const theme = getTheme();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme; // scrollbars y controles nativos acordes
  for (const fn of [...listeners]) fn(pref, theme);
}

/** Cambia la preferencia: la guarda (si se puede), la aplica y avisa a los suscriptores. */
export function setThemePref(p: ThemePref): void {
  pref = p;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, p);
  } catch {
    /* sin almacenamiento: se queda en memoria */
  }
  apply();
}

/** Subscribes to theme changes; returns the function to unsubscribe. */
export function onThemeChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const onSystemChange = (): void => {
  if (pref === 'system') apply();
};

/** Applies the saved preference and follows the changes of the system theme. It can be called more than once. */
export function initTheme(): void {
  pref = loadThemePref();
  media?.removeEventListener('change', onSystemChange);
  media = systemMedia();
  media?.addEventListener('change', onSystemChange);
  apply();
}
