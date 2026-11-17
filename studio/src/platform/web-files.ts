// Files of the web demo: the example project is read over the network (read only), what the visitor opens or
// saves lives in the memory of the tab. Nothing persists between reloads.
import { downloadQueue, type Saver } from './downloads';
import type { FileEntry, Files, PickFilter } from './files';

import { SAMPLE_ROOT } from './sample-root';

export { SAMPLE_ROOT };

/** Índice del proyecto publicado (lo escribe scripts/web/sample.ts). */
interface SampleIndex {
  /** Example models, in the order Home shows them. */
  featured?: string[];
  /** Files each example model loads when it opens (not itself), to preload them in parallel. */
  closure?: Record<string, string[]>;
  entries: { path: string; isDir: boolean; mtime: number }[];
}

export interface WebDeps {
  fetch: typeof fetch;
  /** URL of the app: the project paths are requested relative to it. */
  base: string;
  /** Browser file picker (the tests replace it). */
  pickNative: (accept: string, multiple: boolean) => Promise<File[]>;
  /** Entrega de las descargas de Guardar (las pruebas la sustituyen). */
  save: Saver;
}

/** Virtual folder of the files the visitor opens from their computer. */
const LOCAL_ROOT = '/local';
/** Importaciones que se piden a la vez al abrir un modelo de ejemplo. */
const PREFETCH_CONCURRENCY = 16;
/** Those that are read as text; the rest stay as bytes. */
const TEXT_FILE = /\.(ifcx|xml|xer|csv|tsv|txt|json)$/i;

/** <input type=file> del navegador; devuelve [] si el visitante cancela. */
function pickNativeFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export type WebFiles = Files & { memory: Map<string, string | Uint8Array> };

/** Ruta absoluta POSIX sin `.`, `..` ni separadores de Windows. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const s of path.replace(/\\/g, '/').split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') out.pop();
    else out.push(s);
  }
  return `/${out.join('/')}`;
}

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);
const parentOf = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
const depthOf = (p: string): number => p.split('/').length;
const byName = (a: FileEntry, b: FileEntry): number => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

export function webFiles(deps: Partial<WebDeps> = {}): WebFiles {
  const doFetch: typeof fetch = deps.fetch ?? ((...a) => fetch(...a));
  const base = deps.base ?? location.href;
  const pickNative = deps.pickNative ?? pickNativeFiles;
  const downloads = downloadQueue(deps.save);
  const memory = new Map<string, string | Uint8Array>();
  const written = new Map<string, number>();
  /** Folders created with makeDir (an empty folder leaves no trace in `memory`). */
  const madeDirs = new Set<string>();
  let index: Promise<SampleIndex> | null = null;

  // `&` and `,` are valid in a path and are left as they are: some servers do not decode %26 or %2C. `+` is encoded.
  const encodeSegment = (s: string): string => encodeURIComponent(s).replace(/%26/g, '&').replace(/%2C/gi, ',');
  const urlOf = (path: string): string => new URL(path.replace(/^\//, '').split('/').map(encodeSegment).join('/'), base).href;

  const loadIndex = (): Promise<SampleIndex> => {
    index ??= doFetch(urlOf(`${SAMPLE_ROOT}/index.json`))
      .then((r) => {
        if (!r.ok) throw new Error('Could not load the sample project index');
        return r.json() as Promise<SampleIndex>;
      })
      .catch((e) => {
        index = null; // it is retried on the next use
        throw e;
      });
    return index;
  };

  const entryOf = (e: SampleIndex['entries'][number]): FileEntry => ({ name: baseName(e.path), path: e.path, isDir: e.isDir, mtime: e.mtime });

  /** Imports already requested in advance; the real read takes them (once) from here. */
  const prefetched = new Map<string, Promise<string>>();
  const prefetchStarted = new Set<string>();

  /**
   * The compositor requests the imports one by one, and with network latency a model with hundreds of them
   * would take minutes. When an example model is read, all of them are requested at once (up to PREFETCH_CONCURRENCY) so that
   * those reads are already resolved. A failure is ignored here: the real read requests it again and gives the error.
   */
  function prefetchClosure(model: string): void {
    if (prefetchStarted.has(model)) return;
    prefetchStarted.add(model);
    void loadIndex()
      .then((idx) => {
        const paths = (idx.closure?.[model] ?? []).filter((p) => !memory.has(p));
        let next = 0;
        const worker = async (): Promise<void> => {
          while (next < paths.length) {
            const p = paths[next++];
            const job = fetchPublished(p).then((r) => r.text());
            prefetched.set(p, job);
            try {
              await job;
            } catch {
              /* se reintenta al leerlo */
            }
          }
        };
        for (let i = 0; i < Math.min(PREFETCH_CONCURRENCY, paths.length); i++) void worker();
      })
      .catch(() => {});
  }

  const isPublished = (p: string): boolean => p === SAMPLE_ROOT || p.startsWith(`${SAMPLE_ROOT}/`);

  /**
   * Where a file is in memory: its path or, if it is a relative import of an own file
   * (que no se puede alcanzar desde el navegador), el archivo elegido junto al modelo con el mismo nombre.
   */
  const inMemory = (p: string): string | null => {
    if (memory.has(p)) return p;
    const sibling = `${LOCAL_ROOT}/${baseName(p)}`;
    return !isPublished(p) && memory.has(sibling) ? sibling : null;
  };

  /** Network response for a published file; the others do not exist. */
  async function fetchPublished(path: string): Promise<Response> {
    if (!isPublished(path)) throw new Error(`Missing ${baseName(path)}. Select it together with the model, both in the same folder.`);
    const r = await doFetch(urlOf(path));
    if (!r.ok) throw new Error(`Could not read ${baseName(path)} (${r.status})`);
    return r;
  }

  /** Bytes of a file in memory (to copy it); it fails if it is not there. */
  const bytesOf = (src: string): Uint8Array => {
    const got = memory.get(inMemory(normalizePath(src)) ?? normalizePath(src));
    const bytes = got instanceof Uint8Array ? got : typeof got === 'string' ? new TextEncoder().encode(got) : null;
    if (!bytes) throw new Error(`Missing ${baseName(src)}`);
    return bytes;
  };

  /**
   * The same checks as the Docs commands in Rust: no "..", and inside `root` (the folder the user
   * chose as the project).
   */
  const destination = (dest: string, root: string): string => {
    const reject = (): never => {
      throw new Error('Files can only be written inside the project folder');
    };
    if (dest.replace(/\\/g, '/').split('/').includes('..')) return reject();
    const p = normalizePath(dest);
    const r = normalizePath(root).replace(/\/$/, '');
    return p !== r && p.startsWith(`${r}/`) ? p : reject();
  };

  return {
    memory,
    async readText(path) {
      const p = normalizePath(path);
      const mem = memory.get(inMemory(p) ?? p);
      if (typeof mem === 'string') return mem;
      if (mem) return new TextDecoder().decode(mem);
      const early = prefetched.get(p);
      if (early) {
        prefetched.delete(p);
        try {
          return await early;
        } catch {
          /* it falls back to a new request, which gives the error of this file */
        }
      }
      if (isPublished(p)) prefetchClosure(p);
      return (await fetchPublished(p)).text();
    },
    async readBinary(path) {
      const p = normalizePath(path);
      const mem = memory.get(inMemory(p) ?? p);
      if (mem instanceof Uint8Array) return mem;
      if (typeof mem === 'string') return new TextEncoder().encode(mem);
      return new Uint8Array(await (await fetchPublished(p)).arrayBuffer());
    },
    async writeText(path, text) {
      const p = normalizePath(path);
      memory.set(p, text);
      written.set(p, Date.now());
      downloads.add(p, text);
    },
    async copyFile(src, dest, root) {
      const p = destination(dest, root);
      if (memory.has(p)) throw new Error('A file with that name is already stored');
      memory.set(p, bytesOf(src));
      written.set(p, Date.now());
    },
    async openExternal() {
      throw new Error('Opening a file in another app is not available in the web demo');
    },
    async makeDir(path, root) {
      const p = destination(path, root);
      if (madeDirs.has(p) || [...memory.keys()].some((k) => k === p || k.startsWith(`${p}/`))) {
        throw new Error('A folder or file with that name already exists');
      }
      madeDirs.add(p);
    },
    async listAll(dir) {
      const d = normalizePath(dir);
      const found = new Map<string, FileEntry>();
      const add = (e: FileEntry): void => void (found.has(e.path) || found.set(e.path, e));
      if (isPublished(d)) {
        for (const e of (await loadIndex()).entries) if (parentOf(e.path) === d) add(entryOf(e));
      }
      const prefix = d === '/' ? '/' : `${d}/`;
      for (const k of [...memory.keys(), ...madeDirs]) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const name = rest.split('/')[0];
        if (!name || name.startsWith('.')) continue;
        const isDir = rest.includes('/') || madeDirs.has(k);
        const got = memory.get(k);
        const size = isDir ? 0 : got instanceof Uint8Array ? got.byteLength : typeof got === 'string' ? new TextEncoder().encode(got).byteLength : 0;
        add({ name, path: `${prefix}${name}`, isDir, mtime: isDir ? 0 : written.get(k) ?? 0, size });
      }
      const all = [...found.values()];
      return [...all.filter((e) => e.isDir).sort(byName), ...all.filter((e) => !e.isDir).sort(byName)];
    },
    async exists(path) {
      const p = normalizePath(path);
      if (inMemory(p)) return true;
      return isPublished(p) && (await loadIndex()).entries.some((e) => e.path === p);
    },
    async mtime(path) {
      const p = normalizePath(path);
      const w = written.get(p);
      if (w !== undefined) return w;
      if (memory.has(p)) return 0;
      return (await loadIndex()).entries.find((e) => e.path === p)?.mtime ?? null;
    },
    async listDir(dir) {
      const d = normalizePath(dir);
      const kids = (await loadIndex()).entries.filter((e) => parentOf(e.path) === d).map(entryOf);
      return [...kids.filter((e) => e.isDir).sort(byName), ...kids.filter((e) => !e.isDir).sort(byName)];
    },
    async search(dir, query, limit) {
      const d = normalizePath(dir);
      const q = query.toLowerCase();
      return (await loadIndex()).entries
        .filter((e) => !e.isDir && e.path.startsWith(`${d}/`) && /\.ifcx$/i.test(e.path) && baseName(e.path).toLowerCase().includes(q))
        .map(entryOf)
        .sort((a, b) => depthOf(a.path) - depthOf(b.path) || byName(a, b))
        .slice(0, limit);
    },
    async pickOpen(filters: PickFilter[], opts) {
      const accept = filters.flatMap((f) => f.extensions.map((x) => `.${x}`)).join(',');
      const picked = await pickNative(accept, opts?.multiple ?? false);
      if (picked.length === 0) return null;
      for (const f of picked) {
        const p = `${LOCAL_ROOT}/${f.name}`;
        memory.set(p, TEXT_FILE.test(f.name) ? await f.text() : new Uint8Array(await f.arrayBuffer()));
        written.set(p, f.lastModified);
      }
      return `${LOCAL_ROOT}/${(picked.find((f) => /\.ifcx$/i.test(f.name)) ?? picked[0]).name}`;
    },
    // no dialog: the download is done by writeText. An absolute path keeps its folder (its relative imports
    // stay valid); a bare name or a Windows path goes to the folder of the visitor's files.
    pickSave: async (suggested: string) =>
      suggested.startsWith('/') ? normalizePath(suggested) : `${LOCAL_ROOT}/${baseName(normalizePath(suggested))}`,
    pickFolder: async () => SAMPLE_ROOT,
    defaultLibraryFolder: () => SAMPLE_ROOT,
    async examples() {
      const idx = await loadIndex();
      const byPath = new Map(idx.entries.map((e) => [e.path, e]));
      return (idx.featured ?? []).flatMap((p) => {
        const e = byPath.get(p);
        return e ? [entryOf(e)] : [];
      });
    },
  };
}
