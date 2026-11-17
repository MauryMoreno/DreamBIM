// The real project folder as Docs sees it: the disk is walked. There is no registry: the tree and the table are
// exactly what is in the chosen folder.
import type { FileEntry } from '../platform/files';

/** File on the disk: path relative to the project folder (with `/`), last modification (ms) and size (bytes). */
export interface DiskFile { path: string; mtime: number; size: number }

/** What is on the disk: folders (relative paths) and files. */
export interface DiskTree { folders: string[]; files: DiskFile[] }

export const EMPTY_TREE: DiskTree = { folders: [], files: [] };

const MAX_DEPTH = 8;
const MAX_FILES = 5000;

export const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
export const dirName = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/**
 * Walks `root` (absolute project folder) with `listAll`, breadth-first and skipping hidden things. A subfolder that
 * cannot be read is ignored; a root that cannot be read throws the error. It stops at MAX_FILES files and MAX_DEPTH levels
 * so as not to hang with an enormous folder.
 */
export async function scanProject(root: string, listAll: (dir: string) => Promise<FileEntry[]>): Promise<DiskTree> {
  const folders: string[] = [];
  const files: DiskFile[] = [];
  const base = root.replace(/[\\/]+$/, '');
  const abs = (rel: string): string => (rel ? `${base}/${rel}` : base);
  const pending: [string, number][] = [['', 0]];
  while (pending.length) {
    const [rel, depth] = pending.shift()!;
    let entries: FileEntry[];
    try {
      entries = await listAll(abs(rel));
    } catch (e) {
      if (rel === '') throw e;
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = joinPath(rel, e.name);
      if (e.isDir) {
        folders.push(path);
        if (depth + 1 < MAX_DEPTH) pending.push([path, depth + 1]);
      } else {
        if (files.length >= MAX_FILES) return { folders, files };
        files.push({ path, mtime: e.mtime ?? 0, size: e.size ?? 0 });
      }
    }
  }
  return { folders, files };
}
