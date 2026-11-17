// How a composed node is named in the interface.

import type { ComposedNode } from './types';

/** Clase IFC del nodo (`IfcWall`…), o null si no tiene. */
export function classCode(n: ComposedNode): string | null {
  return (n.attributes['bsi::ifc::class'] as any)?.code ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Name to show: that of the tree, unless it is a UUID and an IFC Name exists. */
export function displayName(n: ComposedNode): string {
  const name = n.attributes['bsi::ifc::prop::Name'];
  return UUID.test(n.name) && typeof name === 'string' && name ? name : n.name;
}
