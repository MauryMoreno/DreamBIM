// Library disk access: list a folder, choose it and remember it.
import { isWeb } from '../platform/env';
import { files } from '../platform/files';
import { errorMessage } from '../model/open';
import type { LibraryEntry } from './librarypanel';

const KEY = 'ifcx-studio.library';

/** Subcarpetas y .ifcx de `dir`. Lanza Error con el mensaje del sistema si falla. */
export async function listLibrary(dir: string): Promise<LibraryEntry[]> {
  try {
    return await files().listDir(dir);
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}

/** Busca .ifcx por nombre bajo `dir`, hasta `limit` resultados. */
export function searchLibrary(dir: string, query: string, limit: number): Promise<LibraryEntry[]> {
  return files().search(dir, query, limit);
}

/** Folder dialog. Returns the path, or null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  return files().pickFolder();
}

/** Folder chosen in this tab (web: nothing persists); undefined if none was chosen. */
let tabFolder: string | null | undefined;

/** Remembered library folder (a preference of the machine: if it fails, there is none). */
export function savedLibraryFolder(): string | null {
  if (isWeb()) return tabFolder === undefined ? files().defaultLibraryFolder() : tabFolder;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveLibraryFolder(dir: string | null): void {
  if (isWeb()) {
    tabFolder = dir;
    return;
  }
  try {
    if (dir) localStorage.setItem(KEY, dir);
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: the folder will be asked for again */
  }
}
