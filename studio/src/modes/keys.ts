import { MODE_IDS, type ModeId } from './definition';

/**
 * Mode a key leads to: Ctrl+1…4 goes straight to it, Ctrl+Tab to the next and Ctrl+Shift+Tab to the previous
 * (con vuelta). Tab solo no cambia de modo. No mira si se escribe en un campo: eso es de quien llama.
 */
export function modeFromKey(e: KeyboardEvent, current: ModeId): ModeId | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === 'Tab') {
    const n = MODE_IDS.length;
    return MODE_IDS[(MODE_IDS.indexOf(current) + (e.shiftKey ? -1 : 1) + n) % n];
  }
  const n = Number(e.key);
  return Number.isInteger(n) && n >= 1 && n <= MODE_IDS.length ? MODE_IDS[n - 1] : null;
}
