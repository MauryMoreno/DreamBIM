// Walks the library folder in depth and returns its .ifcx files, in the order of `list`
// (folders before files), so the cards of the same kind stay together.
import type { LibraryEntry } from '../library/librarypanel';

export interface ScanResult {
  files: LibraryEntry[];
  /** Messages of the subfolders that could not be read. */
  errors: string[];
}

export async function scanLibrary(root: string, list: (dir: string) => Promise<LibraryEntry[]>): Promise<ScanResult> {
  const files: LibraryEntry[] = [];
  const errors: string[] = [];
  const walk = async (dir: string, top: boolean): Promise<void> => {
    let entries: LibraryEntry[];
    try {
      entries = await list(dir);
    } catch (e) {
      if (top) throw e;
      errors.push(e instanceof Error ? e.message : String(e));
      return;
    }
    for (const e of entries) {
      if (e.isDir) await walk(e.path, false);
      else files.push(e);
    }
  };
  await walk(root, true);
  return { files, errors };
}
