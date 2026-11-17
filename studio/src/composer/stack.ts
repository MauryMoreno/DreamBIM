// Pure composition of the composer stack: linked layers (file + edit layer) and,
// at the end, the document. The last one wins, so the document prevails over everything.
import { resolveStack, type Fetcher, type Layer } from '../ifcx/layers';
import { compose, type ComposeResult } from '../ifcx/compose';
import type { IfcxFile, IfcxNode } from '../ifcx/types';
import { locateImport, offlineFetcher } from '../model/schemas';
import { schemaWarnings } from '../model/validate';
import { resolveUri } from './uri';
import type { LoadedModel } from '../model/load';

export interface ComposerLayer {
  /** Stable within the session. */
  id: string;
  /** Tal como se guarda (relativa o absoluta). */
  uri: string;
  name: string;
  /** Color of the layer, in six-digit hexadecimal format. */
  color: string;
  enabled: boolean;
  editsEnabled: boolean;
  /** Edit layer. */
  edits: IfcxNode[];
}

/** Internal uri of the base layer (the file itself): it is not a path and is not saved as a link. */
export const BASE_URI = 'ifcx-studio:base';

const NOT_FOUND = 'File not found: ';
/** Composition warning for a linked file that was not found. */
export const notFoundWarning = (uri: string): string => `${NOT_FOUND}${uri}`;
/**
 * Load warnings not yet said: those of files not found are already reported by the controller on opening,
 * uno por capa, y no se cuentan otra vez en el resumen de avisos.
 */
export const unreportedWarnings = (warnings: readonly string[]): string[] => warnings.filter((w) => !w.startsWith(NOT_FOUND));

/** uri -> archivo (null = no encontrado). */
export type LinkedFiles = Map<string, IfcxFile | null>;

/**
 * 8 colors; the first unused one is assigned. They are defined as numbers so as not to have literals of
 * color en cadenas (lo vigila css-tokens.test.ts); el valor final es '#rrggbb'.
 */
const PALETTE = [0xe6550d, 0x3182bd, 0x31a354, 0x756bb1, 0xd6a100, 0xe7298a, 0x17a2b8, 0x8c6d31];
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
export const LAYER_COLORS: string[] = PALETTE.map(hex);
/** Fixed color of the document in the Stage and Layer panels (neutral grey, different from the palette). */
export const DOCUMENT_COLOR: string = hex(0x7a8290);

export function nextColor(layers: ComposerLayer[]): string {
  const used = new Set(layers.map((l) => l.color.toLowerCase()));
  return LAYER_COLORS.find((c) => !used.has(c)) ?? LAYER_COLORS[layers.length % LAYER_COLORS.length];
}

/** File with the edits of a layer; it is composed right after the file of the layer. */
export function editsFile(layer: ComposerLayer): IfcxFile {
  return {
    header: {
      id: `ifcx-studio/edits/${layer.uri}`,
      ifcxVersion: '',
      dataVersion: '',
      author: '',
      timestamp: '',
    },
    imports: [],
    schemas: {},
    data: layer.edits,
  };
}

/**
 * Composes the stack: for each active layer with a file, its file and then its edits (if they are
 * active and there are any); the document goes last, without the imports the layers already contribute.
 * `payloads`: files of the loaded payloads, by uri.
 */
export async function composeStack(
  name: string,
  path: string | null,
  base: Layer,
  layers: ComposerLayer[],
  files: LinkedFiles,
  fetcher: Fetcher = offlineFetcher,
  payloads?: ReadonlyMap<string, IfcxFile>,
  overlays: readonly IfcxFile[] = [],
): Promise<LoadedModel> {
  const warnings: string[] = [];
  const stack: Layer[] = [];
  for (const l of layers) {
    const file = files.get(l.uri) ?? null;
    if (!file) {
      warnings.push(notFoundWarning(l.uri));
      continue;
    }
    // the base of a foreign file is the document itself; a link is where its uri points
    const location = l.uri === BASE_URI ? path ?? undefined : resolveUri(path, l.uri);
    stack.push({ id: l.id, name: l.name, file, enabled: l.enabled, location });
    if (l.editsEnabled && l.edits.length) {
      stack.push({ id: `${l.id}:edits`, name: `${l.name} (edits)`, file: editsFile(l), enabled: l.enabled });
    }
  }

  // The document no longer imports what the layers contribute: this way nothing is composed twice.
  const linked = new Set(layers.map((l) => l.uri));
  const baseFile: IfcxFile = {
    ...base.file,
    imports: (base.file.imports ?? []).filter((i) => !linked.has(i.uri)),
  };
  stack.push({ ...base, file: baseFile, location: path ?? undefined });
  // on top of the document: the last one wins (e.g. the materials assigned in Materials mode)
  for (const file of overlays) stack.push({ id: `overlay:${file.header.id}`, name: file.header.id, file, enabled: true });

  const resolved = await resolveStack(stack, fetcher, locateImport);
  for (const imp of resolved.imports) {
    if (!imp.ok) warnings.push(`Import unavailable: ${imp.uri}${imp.error ? ` (${imp.error})` : ''}`);
  }
  // the provenance of each file (layer, edit, import) comes from the resolved stack
  const payloadKey = (uri: string, i: number) => resolveUri(resolved.sources[i].location ?? path, uri);
  const result = compose(resolved.files, { payloads, sources: resolved.sources, payloadKey });
  warnings.push(...result.warnings);
  warnings.push(...schemaWarnings(resolved.files));
  return { name, path, result, warnings, layer: base };
}

/** Own hierarchy of a file, without the rest of the stack. */
export function layerTree(file: IfcxFile): ComposeResult {
  return compose([file]);
}
