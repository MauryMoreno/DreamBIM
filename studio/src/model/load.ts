// Loading of an IFCx model: parsing, import resolution and composition, with warnings in Spanish.
import { parseIfcx, type Fetcher, type Layer } from '../ifcx/layers';
import type { ComposeResult } from '../ifcx/compose';
import { composeStack, type ComposerLayer, type LinkedFiles } from '../composer/stack';
import { offlineFetcher } from './schemas';

import type { ElementColor } from '../render/coloroverride';

export interface LoadedModel {
  name: string;
  path: string | null;
  result: ComposeResult;
  warnings: string[];
  /** Layer of the document: it allows recomposing the model with layers added on top (composeLayers). */
  layer?: Layer;
  /** Colors saved by composed path (the viewer paints them per element); missing if there are none. */
  savedColors?: ReadonlyMap<string, ElementColor>;
}

export class InvalidModelError extends Error {}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadModel(
  name: string,
  path: string | null,
  text: string,
  fetcher: Fetcher = offlineFetcher,
): Promise<LoadedModel> {
  const layer = parseLayer('1', name, text);
  return composeLayers(name, path, layer, [], fetcher);
}

/**
 * Composes the layer of the document with extra layers on top (the last ones win). Disabled layers
 * are not composed; the common imports are resolved only once.
 */
export async function composeLayers(
  name: string,
  path: string | null,
  base: Layer,
  extra: Layer[],
  fetcher: Fetcher = offlineFetcher,
): Promise<LoadedModel> {
  // Each extra layer is a composer layer without edits; its uri is its id.
  const files: LinkedFiles = new Map();
  const layers: ComposerLayer[] = extra.map((l) => {
    files.set(l.id, l.file);
    return { id: l.id, uri: l.id, name: l.name, color: '', enabled: l.enabled, editsEnabled: true, edits: [] };
  });
  return composeStack(name, path, base, layers, files, fetcher);
}

/** Parsea un archivo .ifcx como capa; lanza InvalidModelError si no lo es. */
export function parseLayer(id: string, name: string, text: string): Layer {
  try {
    return { id, name, file: parseIfcx(text), enabled: true };
  } catch (e) {
    throw new InvalidModelError('Not a valid IFCX file: ' + reason(e));
  }
}
