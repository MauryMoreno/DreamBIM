import { isModeId, type ModeId } from './definition';

export const MODE_STORAGE_PREFIX = 'studio.mode:';

const keyOf = (path: string): string => MODE_STORAGE_PREFIX + path.replace(/\\/g, '/').toLowerCase();

/** Último modo de ese documento; «model» si no hay ruta, nada guardado, basura o localStorage falla. */
export function loadMode(path: string | null): ModeId {
  if (!path) return 'model';
  try {
    const v = localStorage.getItem(keyOf(path));
    return isModeId(v) ? v : 'model';
  } catch {
    return 'model';
  }
}

/** Recuerda el modo del documento. Sin ruta (Untitled) no guarda nada. */
export function saveMode(path: string | null, id: ModeId): void {
  if (!path) return;
  try {
    localStorage.setItem(keyOf(path), id);
  } catch {
    /* sin almacenamiento */
  }
}
