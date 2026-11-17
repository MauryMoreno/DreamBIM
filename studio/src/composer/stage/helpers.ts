import type { ComposedNode } from '../../ifcx/types';
import { classCode } from '../../ifcx/names';
import { LAYER_DRAG_TYPE } from '../rows';

/** Aviso al soltar un elemento del documento sobre otro nodo. */
export const DOCUMENT_RELOCATE_TEXT = 'Use Properties › Level to move Dream BIM elements between levels';

/** Does the drag come from a row of the Layer panel? (in dragover only the types can be read) */
export const isLayerDrag = (dt: DataTransfer | null | undefined): boolean => !!dt?.types && [...dt.types].includes(LAYER_DRAG_TYPE);

export const SEARCH_DEBOUNCE_MS = 150;

/** Children painted at once; the rest, with "Show more". */
export const PAGE = 400;

/** Depth (under the root) that is expanded on opening: project, site and building. */
export const OPEN_DEPTH = 3;

/** A branch with more children than this does not expand on its own. */
export const OPEN_MAX_CHILDREN = 50;

export const PLUS = '+';

export const MINUS = '−';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text: the names come from the model
  return e;
}

/** Does the node match the search? Name, IFC Name, class or origin prefix. */
export function matches(n: ComposedNode, q: string): boolean {
  const name = n.attributes['bsi::ifc::prop::Name'];
  return (
    n.name.toLowerCase().includes(q) ||
    (typeof name === 'string' && name.toLowerCase().includes(q)) ||
    (classCode(n)?.toLowerCase().includes(q) ?? false) ||
    n.origin.toLowerCase().startsWith(q)
  );
}
