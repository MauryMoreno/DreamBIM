// Theme radio options (Light / Dark / System), shared by the title bar button
// and the Theme section of the File menu. Both read and write the same state of theme.ts.
import { getThemePref, onThemeChange, setThemePref, type ThemePref } from './theme';

export const THEME_LABELS: readonly { pref: ThemePref; label: string }[] = [
  { pref: 'light', label: 'Light' },
  { pref: 'dark', label: 'Dark' },
  { pref: 'system', label: 'System' },
];

/**
 * Creates the three role="menuitemradio" buttons (the active one carries aria-checked="true" and is kept up to date
 * ante cualquier cambio de tema). Al elegir uno se aplica la preferencia y se llama a `onChoose`.
 */
export function createThemeRadios(onChoose: () => void): HTMLButtonElement[] {
  const items = THEME_LABELS.map(({ pref, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-radio';
    b.setAttribute('role', 'menuitemradio');
    const mark = document.createElement('span');
    mark.className = 'theme-radio-mark';
    mark.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    b.append(mark, text);
    b.addEventListener('click', () => {
      setThemePref(pref);
      onChoose();
    });
    return { pref, b };
  });
  const sync = (current: ThemePref): void => {
    for (const { pref, b } of items) b.setAttribute('aria-checked', String(pref === current));
  };
  sync(getThemePref());
  onThemeChange((p) => sync(p));
  return items.map((i) => i.b);
}
