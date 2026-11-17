// Opening models from disk: dialog, reading and loading.
import { files } from '../platform/files';
import { loadModel, parseLayer, type LoadedModel } from './load';
import { K_DOC } from '../modeling/document';
import { perfSpan, perfSpanAsync } from '../render/perf';
import { documentModel, sessionFromFile, type EditSession } from '../modeling/session';

/** Último componente de una ruta de Windows o POSIX. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** true si la ruta existe; si no se puede comprobar, no se marca como ausente. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    return await files().exists(path);
  } catch {
    return true;
  }
}

/** Modification date of the file (ms), or null if it does not exist. */
export function fileMtime(path: string): Promise<number | null> {
  return files().mtime(path);
}

/** Mensaje legible de cualquier error (Tauri rechaza con cadenas, no con Error). */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Open dialog filtered to .ifcx. Returns the path, or null if the user cancels. */
export async function pickPath(): Promise<string | null> {
  return files().pickOpen([{ name: 'IFCx Model', extensions: ['ifcx'] }], { multiple: true });
}

/** Save dialog filtered to .ifcx. Returns the path (with .ifcx added if missing), or null if cancelled. */
export async function pickSavePath(suggested: string): Promise<string | null> {
  const picked = await files().pickSave(suggested, [{ name: 'IFCx Model', extensions: ['ifcx'] }]);
  if (picked === null) return null;
  return /\.ifcx$/i.test(picked) ? picked : `${picked}.ifcx`;
}

/** Escribe el texto. Lanza Error si falla. */
export async function writeTextFile(path: string, text: string): Promise<void> {
  try {
    await files().writeText(path, text);
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}

export interface OpenedModel {
  model: LoadedModel;
  /**
   * Editable session: that of a Studio document or, in a generic IFCx, a ForeignSession that
   * edits what it brings and overwrites it on save. null only if it is from Studio but damaged.
   */
  session: EditSession | null;
  /** true if Studio created the file (it carries ifcx-studio::document) but it could not be read for editing. */
  studioUnreadable: boolean;
}

/** Lee un archivo de texto. Lanza Error si falla. */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await perfSpanAsync('studio.read', () => files().readText(path));
  } catch (e) {
    throw new Error(errorMessage(e));
  }
}

/** Lee el archivo y lo carga. Lanza si la lectura o la carga fallan. */
export async function openPath(path: string): Promise<OpenedModel> {
  const text = await readTextFile(path);
  const name = fileName(path);
  // parseLayer valida el texto (lanza InvalidModelError) antes de leerlo como documento de Studio.
  const file = perfSpan('studio.parse', () => parseLayer('1', name, text)).file;
  const studio = sessionFromFile(file, path);
  // a Studio file that could not be read is opened read-only: editing it as a foreign one would spoil it
  const studioUnreadable = !studio && file.data.some((n) => n.attributes?.[K_DOC] !== undefined);
  if (studioUnreadable) return { model: await loadModel(name, path, text), session: null, studioUnreadable };
  // De los dos, los archivos enlazados (y la base de uno ajeno) los compone el controlador al abrirlo.
  // deferred import: foreign extends EditSession, and session already imports this module
  const session = studio ?? (await import('../modeling/foreign')).foreignFromFile(file, path, text);
  const model = await documentModel(name, path, await session.modelText(), session.doc.composer.layers.map((l) => l.uri));
  return { model, session, studioUnreadable };
}
