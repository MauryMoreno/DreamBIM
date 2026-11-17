// Project sample for the web demo: copies the chosen models and everything they import (even if it is in
// a folder that is not listed) and writes the index that the web library reads. See deploy/sample.json.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { SAMPLE_ROOT } from '../../src/platform/sample-root';

export interface SampleConfig {
  /** Carpeta del proyecto, relativa a studio/ (se resuelve en make-sample.ts). */
  source: string;
  /** A model on the list bigger than this warns (it is copied anyway). */
  maxModelMB: number;
  /** Modelos de la demo, relativos a `source`. */
  models: string[];
  /** Folders (by name, at any depth) that are neither shown nor walked. Hidden ones (`.x`) never. */
  skipFolders?: string[];
  /** Carpetas, relativas a `source`, que se publican enteras (salvo copias `.antes-de-*` y scripts). */
  fullFolders?: string[];
}

export interface SampleResult {
  /** Archivos copiados, relativos a `source`, ordenados. */
  files: string[];
  /** Imports or models that do not exist: the demo would not load. */
  missing: string[];
  tooBig: string[];
}

const K_COMPOSER = 'ifcx-studio::composer';
/** Versiones de prueba y copias de seguridad: no son parte de la demo. */
const EXCLUDED = /\.(test\d*|antes-de-)/i;
/** What is never published from a whole folder: backups and scripts. */
const NOT_IN_FULL = /(\.antes-de-|\.(py|pyc)$)/i;

/** Todas las carpetas de `sourceDir` (relativas, con `/`), sin las ocultas ni `skip`. */
function walkDirs(sourceDir: string, skip: Set<string>, rel = ''): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  for (const e of readdirSync(join(sourceDir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || skip.has(e.name)) continue;
      dirs.push(r);
      const sub = walkDirs(sourceDir, skip, r);
      dirs.push(...sub.dirs);
      files.push(...sub.files);
    } else if (e.isFile()) files.push(r);
  }
  return { dirs, files };
}

/** Relative URIs that a file declares: its imports and the layers of a Studio document. */
function linkedUris(text: string): string[] {
  const file = JSON.parse(text) as { imports?: { uri?: string }[]; data?: { attributes?: Record<string, unknown> }[] };
  const uris = (file.imports ?? []).map((i) => i.uri);
  for (const n of file.data ?? []) {
    const composer = n.attributes?.[K_COMPOSER] as { layers?: { uri?: string }[] } | undefined;
    for (const l of composer?.layers ?? []) uris.push(l.uri);
  }
  return uris.filter((u): u is string => typeof u === 'string' && u !== '' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u));
}

/**
 * Sibling files of the model (`m.costos-asignacion.ifcx`, `m.cronograma.ifcx`…) that are not from another test
 * version nor copies: only what follows the model name is looked at (`m.test2.ifcx` does carry `m.test2.cronograma.ifcx`).
 */
function siblings(sourceDir: string, rel: string): string[] {
  const dir = posix.dirname(rel);
  const stem = posix.basename(rel).replace(/\.ifcx$/i, '');
  return readdirSync(join(sourceDir, dir))
    .filter((n) => n.startsWith(`${stem}.`) && /\.ifcx$/i.test(n) && !EXCLUDED.test(n.slice(stem.length)))
    .map((n) => posix.join(dir, n));
}

export function buildSample(cfg: SampleConfig, sourceDir: string, outDir: string): SampleResult {
  const copied = new Set<string>();
  const missing = new Set<string>();
  const tooBig: string[] = [];
  const exists = (rel: string) => {
    try {
      return statSync(join(sourceDir, rel)).isFile();
    } catch {
      return false;
    }
  };

  /** Which files each one links (imports and, in the models of the list, their siblings). */
  const graph = new Map<string, string[]>();

  function visit(rel: string): void {
    if (copied.has(rel) || missing.has(rel)) return;
    if (rel.startsWith('..') || !exists(rel)) {
      missing.add(rel);
      return;
    }
    copied.add(rel);
    if (!/\.ifcx$/i.test(rel)) return;
    const kids = linkedUris(readFileSync(join(sourceDir, rel), 'utf8')).map((uri) => posix.normalize(posix.join(posix.dirname(rel), uri)));
    graph.set(rel, kids);
    for (const k of kids) visit(k);
  }

  for (const model of cfg.models) {
    visit(model);
    if (!exists(model)) continue;
    if (statSync(join(sourceDir, model)).size > cfg.maxModelMB * 1024 * 1024) tooBig.push(model);
    const sibs = siblings(sourceDir, model);
    for (const s of sibs) visit(s);
    graph.set(model, [...(graph.get(model) ?? []), ...sibs]);
  }

  const tree = walkDirs(sourceDir, new Set(cfg.skipFolders ?? []));
  const full = (cfg.fullFolders ?? []).map((f) => f.replace(/\/+$/, ''));
  for (const f of tree.files) {
    if (full.some((d) => f.startsWith(`${d}/`)) && !NOT_IN_FULL.test(f)) visit(f);
  }

  /** Everything a model loads when it opens, not itself: the web preloads it in parallel (requesting one by one takes minutes). */
  const closure: Record<string, string[]> = {};
  for (const model of cfg.models) {
    if (!copied.has(model)) continue;
    const reach = new Set<string>();
    const stack = [...(graph.get(model) ?? [])];
    while (stack.length) {
      const r = stack.pop()!;
      if (r === model || reach.has(r) || !copied.has(r)) continue;
      reach.add(r);
      stack.push(...(graph.get(r) ?? []));
    }
    closure[`${SAMPLE_ROOT}/${model}`] = [...reach].sort().map((r) => `${SAMPLE_ROOT}/${r}`);
  }

  const files = [...copied].sort();
  const entries = new Map<string, { path: string; isDir: boolean; mtime: number }>();
  for (const rel of files) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    copyFileSync(join(sourceDir, rel), join(outDir, rel));
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = `${SAMPLE_ROOT}/${parts.slice(0, i).join('/')}`;
      entries.set(dir, { path: dir, isDir: true, mtime: 0 });
    }
    entries.set(`${SAMPLE_ROOT}/${rel}`, { path: `${SAMPLE_ROOT}/${rel}`, isDir: false, mtime: Math.round(statSync(join(sourceDir, rel)).mtimeMs) });
  }
  for (const d of tree.dirs) entries.set(`${SAMPLE_ROOT}/${d}`, { path: `${SAMPLE_ROOT}/${d}`, isDir: true, mtime: 0 });
  mkdirSync(outDir, { recursive: true });
  const featured = cfg.models.filter((m) => copied.has(m)).map((m) => `${SAMPLE_ROOT}/${m}`);
  const sorted = [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(join(outDir, 'index.json'), JSON.stringify({ featured, closure, entries: sorted }));
  return { files, missing: [...missing].sort(), tooBig };
}
