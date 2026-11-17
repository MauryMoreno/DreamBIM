// File access of the application behind an interchangeable interface: desktop (Tauri) or web
// (memory + network). The disk modules delegate here and keep their signatures.
import { desktopFiles } from './desktop-files';
import { isWeb } from './env';
import { webFiles } from './web-files';

export interface FileEntry {
  name: string;
  /** Ruta absoluta. */
  path: string;
  isDir: boolean;
  /** Last modification, ms since the Unix epoch (0 if unknown). */
  mtime?: number;
  /** Size in bytes (only `listAll` gives it). */
  size?: number;
}

export interface PickFilter {
  name: string;
  extensions: string[];
}

export interface Files {
  readText(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  writeText(path: string, text: string): Promise<void>;
  /** Copia un archivo a `dest`, que debe estar dentro de `root`, sin sobrescribir. */
  copyFile(src: string, dest: string, root: string): Promise<void>;
  /** Crea una carpeta nueva dentro de `root`. */
  makeDir(path: string, root: string): Promise<void>;
  /** Opens a file with the default application of the system (not programs or scripts). */
  openExternal(path: string): Promise<void>;
  /** Everything in a folder (subfolders and files of any type, no hidden ones). */
  listAll(dir: string): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  mtime(path: string): Promise<number | null>;
  listDir(dir: string): Promise<FileEntry[]>;
  search(dir: string, query: string, limit: number): Promise<FileEntry[]>;
  /** Chosen path, or null if cancelled. On the web, `multiple` also loads the other chosen files. */
  pickOpen(filters: PickFilter[], opts?: { multiple?: boolean }): Promise<string | null>;
  pickSave(suggested: string, filters: PickFilter[]): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  /** Default library folder if the user chose none (desktop: null). */
  defaultLibraryFolder(): string | null;
  /** Example models that Home offers (only the web demo has them). */
  examples?(): Promise<FileEntry[]>;
}

let current: Files | null = null;

/** The file access of this build mode (created on first use). */
export function files(): Files {
  return (current ??= isWeb() ? webFiles() : desktopFiles());
}

/** For tests: replaces the file access; null goes back to the default one. */
export function setFiles(f: Files | null): void {
  current = f;
}
