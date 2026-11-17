// Provenance of an element for the agent: which file or layer each attribute comes from. It is what the
// References tab shows, in a form that reads as JSON.
import type { ComposedNode, Provenance } from '../../ifcx/types';
import { sourceLabel } from '../../properties/references';

export interface AttributeSource {
  /** Archivo o capa donde se define el valor (ruta relativa al documento). */
  from: string;
  /** Chain of inheritances through which it arrives, if the attribute is not the node's own. */
  via?: string[];
  /** Fuente a la que este valor sobrescribe. */
  overrides?: string;
}

export interface ElementProvenance {
  sources: string[];
  attributes: Record<string, AttributeSource>;
}

export function explainElement(node: ComposedNode, p: Provenance, docPath: string | null): ElementProvenance {
  const attributes: Record<string, AttributeSource> = {};
  for (const [key, o] of Object.entries(p.explain(node))) {
    const out: AttributeSource = { from: sourceLabel(o.source, docPath) };
    if (o.kind === 'inherited') out.via = o.via;
    else if (o.overrides) out.overrides = sourceLabel(o.overrides.source, docPath);
    attributes[key] = out;
  }
  return { sources: p.sourcesOf(node.origin).filter((s) => !s.layerId?.startsWith('overlay:')).map((s) => sourceLabel(s, docPath)), attributes };
}
