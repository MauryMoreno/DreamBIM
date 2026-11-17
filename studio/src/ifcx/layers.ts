// Pila de capas: el usuario ordena sus archivos; cada archivo arrastra sus imports.
// Federation order: for each layer (from weakest to strongest) first its imports
// (recursive, without duplicates) and then the layer itself. The last one wins.

import type { IfcxFile, ProvenanceSource } from './types';

export interface Layer {
  id: string;
  name: string;
  file: IfcxFile;
  enabled: boolean;
  /** Where the file is: its relative imports are resolved against this path (with a Locator). */
  location?: string;
}

export type Fetcher = (uri: string) => Promise<IfcxFile>;
/** Location of an import `uri` declared in the file that is at `from` (no location if unknown). */
export type Locator = (uri: string, from: string | undefined) => string;

const remoteCache = new Map<string, Promise<IfcxFile>>();

export const fetchIfcx: Fetcher = (uri) => {
  let p = remoteCache.get(uri);
  if (!p) {
    p = fetch(uri).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseIfcx(await r.text());
    });
    remoteCache.set(uri, p);
    p.catch(() => remoteCache.delete(uri));
  }
  return p;
};

export function parseIfcx(text: string): IfcxFile {
  const json = JSON.parse(text);
  if (!json || typeof json !== 'object' || !Array.isArray(json.data)) {
    throw new Error('Not a valid IFCX file: missing "data" array');
  }
  json.header ??= { id: '', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' };
  json.imports ??= [];
  json.schemas ??= {};
  return json as IfcxFile;
}

export interface ResolvedStack {
  files: IfcxFile[];
  /** Procedencia de cada archivo de `files` (misma longitud y orden). */
  sources: ProvenanceSource[];
  imports: { uri: string; ok: boolean; error?: string }[];
}

/**
 * Devuelve la lista ordenada de archivos a federar, resolviendo imports. Con `locate`, cada import
 * it is looked up where it points from the file that declares it, and two imports to the same place are read once.
 */
export async function resolveStack(layers: Layer[], fetcher: Fetcher = fetchIfcx, locate?: Locator): Promise<ResolvedStack> {
  const localById = new Map<string, IfcxFile>();
  for (const l of layers) if (l.file.header.id) localById.set(l.file.header.id, l.file);

  const placed = new Set<string>();
  const files: IfcxFile[] = [];
  const sources: ProvenanceSource[] = [];
  const imports: ResolvedStack['imports'] = [];

  const visit = async (file: IfcxFile, location: string | undefined) => {
    for (const imp of file.imports ?? []) {
      const where = locate ? locate(imp.uri, location) : imp.uri;
      if (placed.has(where)) continue;
      placed.add(where);
      let dep = localById.get(imp.uri);
      if (!dep) {
        try {
          dep = await fetcher(where);
          imports.push({ uri: where, ok: true });
        } catch (e) {
          imports.push({ uri: where, ok: false, error: (e as Error).message });
          continue;
        }
      }
      await visit(dep, where);
      files.push(dep);
      sources.push({ role: 'import', name: imp.uri, uri: imp.uri, location: where });
    }
  };

  for (const l of layers) {
    if (!l.enabled) continue;
    await visit(l.file, l.location);
    files.push(l.file);
    sources.push({ role: 'layer', name: l.name, uri: null, ...(l.location !== undefined && { location: l.location }), layerId: l.id });
  }
  return { files, sources, imports };
}
