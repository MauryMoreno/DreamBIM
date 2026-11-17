// Local URIs of the linked files. Only string handling (no node:path) so that
// it also works in the browser. Internally '/' is used; '\' and drive letters are accepted.
import { parseIfcx } from '../ifcx/layers';
import type { IfcxFile } from '../ifcx/types';
import { perfSpanAsync } from '../render/perf';
import type { LinkedFiles } from './stack';

interface Ruta {
  /** '' = relative; 'C:' = Windows drive; '/' = POSIX root; '//' = UNC. */
  raiz: string;
  segs: string[];
}

/** Decomposes and normalizes: slashes, '.', '..' and empty segments. */
function analizar(texto: string): Ruta {
  let t = texto.replace(/\\/g, '/');
  let raiz = '';
  const unidad = /^[A-Za-z]:(?=\/|$)/.exec(t);
  if (unidad) {
    raiz = unidad[0];
    t = t.slice(2);
  } else if (t.startsWith('//')) {
    raiz = '//';
  } else if (t.startsWith('/')) {
    raiz = '/';
  }
  const segs: string[] = [];
  for (const s of t.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop();
      else if (!raiz) segs.push('..'); // in an absolute path it does not go up beyond the root
      continue;
    }
    segs.push(s);
  }
  return { raiz, segs };
}

/** Windows drives and UNC paths are case-insensitive. */
const sinMayusculas = (r: Ruta): boolean => r.raiz === '//' || r.raiz.endsWith(':');
const clave = (r: Ruta, s: string): string => (sinMayusculas(r) ? s.toLowerCase() : s);
const mismaRaiz = (a: Ruta, b: Ruta): boolean => clave(a, a.raiz) === clave(b, b.raiz);

function formatear(r: Ruta): string {
  if (!r.raiz) {
    // canonical relative: always './x' or '../x'
    return (r.segs[0] === '..' ? '' : './') + r.segs.join('/');
  }
  const cuerpo = r.segs.join('/');
  return r.raiz.endsWith('/') ? r.raiz + cuerpo : r.raiz + '/' + cuerpo;
}

/** Directorio del documento (sin el nombre de archivo). */
const dirDe = (doc: Ruta): Ruta => ({ raiz: doc.raiz, segs: doc.segs.slice(0, -1) });

/**
 * URI para guardar en el documento: relativa (./x, ../x) si comparten unidad; absoluta si no, o
 * if there is no document. It is deterministic and normalized, because it is compared as a string.
 */
export function linkUri(docPath: string | null, filePath: string): string {
  const f = analizar(filePath);
  if (!docPath || !f.raiz) return formatear(f);
  const d = analizar(docPath);
  if (!d.raiz || !mismaRaiz(d, f)) return formatear(f);
  const dir = dirDe(d).segs;
  let i = 0;
  while (i < dir.length && i < f.segs.length - 1 && clave(f, dir[i]) === clave(f, f.segs[i])) i++;
  const subidas = dir.slice(i).map(() => '..');
  return formatear({ raiz: '', segs: [...subidas, ...f.segs.slice(i)] });
}

/** Ruta absoluta en disco de una URI guardada (relativa al documento o ya absoluta). */
export function resolveUri(docPath: string | null, uri: string): string {
  const u = analizar(uri);
  if (u.raiz || !docPath) return formatear(u);
  const d = analizar(docPath);
  if (!d.raiz) return formatear(u);
  const base = [...dirDe(d).segs];
  for (const s of u.segs) {
    if (s === '..') base.pop();
    else base.push(s);
  }
  return formatear({ raiz: d.raiz, segs: base });
}

/** Do they point to the same file? It ignores separators, ./ and ../, and case in Windows paths. */
export function sameFile(a: string, b: string): boolean {
  const ra = analizar(a);
  const rb = analizar(b);
  return mismaRaiz(ra, rb) && clave(ra, formatear(ra)) === clave(rb, formatear(rb));
}

/** Save as: recomputes the URI so that it keeps pointing to the same file from the new document. */
export function rebaseUri(uri: string, fromDoc: string | null, toDoc: string): string {
  return linkUri(toDoc, resolveUri(fromDoc, uri));
}

/**
 * Reads and parses the linked files. A read failure or invalid JSON gives null for that
 * URI; nunca lanza.
 */
export async function loadLinked(
  docPath: string | null,
  uris: string[],
  read: (absPath: string) => Promise<string>,
  parse: (text: string) => IfcxFile | Promise<IfcxFile> = parseIfcx,
): Promise<LinkedFiles> {
  const entradas = await Promise.all(
    uris.map(async (uri): Promise<[string, IfcxFile | null]> => {
      try {
        const text = await read(resolveUri(docPath, uri)); // studio.read lo mide readTextFile
        return [uri, await perfSpanAsync('studio.parse', async () => parse(text))];
      } catch {
        return [uri, null];
      }
    }),
  );
  return new Map(entradas);
}
