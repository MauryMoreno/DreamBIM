// Desktop file access: the Rust commands. The dialogs are Rust commands too, because what the user picks there
// is what grants the disk commands access to a folder (see src-tauri/src/fs/scope.rs).
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, Files, PickFilter } from './files';

/** Tauri rechaza con cadenas, no con Error. */
async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export function desktopFiles(): Files {
  return {
    readText: (path) => call<string>('read_text_file', { path }),
    // the command answers with a raw IPC response, which arrives as an ArrayBuffer (not a JSON array of numbers)
    readBinary: async (path) => new Uint8Array(await call<ArrayBuffer>('read_binary_file', { path })),
    writeText: (path, contents) => call<void>('write_text_file', { path, contents }),
    copyFile: (src, dest, root) => call<void>('store_document', { src, dest, root }),
    openExternal: (path) => call<void>('open_document', { path }),
    makeDir: (path, root) => call<void>('make_document_folder', { path, root }),
    listAll: (dir) => call<FileEntry[]>('list_folder', { dir }),
    exists: (path) => call<boolean>('path_exists', { path }),
    mtime: (path) => call<number | null>('file_mtime', { path }),
    listDir: (dir) => call<FileEntry[]>('list_library', { dir }),
    search: (dir, query, limit) => call<FileEntry[]>('search_library', { dir, query, limit }),
    pickOpen: (filters: PickFilter[]) => call<string | null>('pick_open_file', { filters }),
    pickSave: (suggested: string, filters: PickFilter[]) => call<string | null>('pick_save_path', { suggested, filters }),
    pickFolder: () => call<string | null>('pick_folder', {}),
    defaultLibraryFolder: () => null,
  };
}
