import { composeLayers, parseLayer, type LoadedModel } from '../../model/load';
import type { EditSession } from '../session';

/**
 * Model of a document without its linked files (`linked`): those imports are not resolved here,
 * porque los compone el controlador con su pila. Lanza InvalidModelError si el texto no es IFCx.
 */
export async function documentModel(name: string, path: string | null, text: string, linked: string[]): Promise<LoadedModel> {
  const layer = parseLayer('1', name, text);
  if (linked.length) {
    const skip = new Set(linked);
    layer.file = { ...layer.file, imports: (layer.file.imports ?? []).filter((i) => !skip.has(i.uri)) };
  }
  return composeLayers(name, path, layer, []);
}

/** Model of the session: only the document; the linked layers are added by the controller. */
export async function sessionModel(s: EditSession): Promise<LoadedModel> {
  return documentModel(s.name, s.path, await s.modelText(), s.doc.composer.layers.map((l) => l.uri));
}
