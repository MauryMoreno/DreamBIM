// The classification as IFCX nodes: the codes of an imported table are nodes with `omniclass::TableN` and an
// element references them with `inherits`. Here they are read from the composed model, with the file that defines them.
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode, ProvenanceSource } from '../ifcx/types';
import { K_ASSIGN_21 } from './state';
import { K_MEDICION, medicionOf, priceRefOf, tableKey, type Medicion, type PriceOrigin } from './system';

export const K_TABLE21 = tableKey('21');
export const K_TABLE22 = tableKey('22');
const K_CLASS = 'bsi::ifc::class';

/** A code of an imported table. */
export interface ClassItem {
  /** Data path of the node (the one an element inherits). */
  path: string;
  /** '21', '22' o '23'. */
  table: string;
  code: string;
  name: string;
  medicion?: Medicion;
  price?: number;
  reference?: string;
  origin?: PriceOrigin;
  /** The weakest file that defines the node: the table. */
  source: ProvenanceSource;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The items of the composed model: nodes with `omniclass::Table21|22` and without `bsi::ifc::class` (an element with the
 * attribute is not an item). The first of each code wins. An item that others inherit does not hang from the tree, that is why
 * se busca en la procedencia.
 */
export function classItems(result: ComposeResult): ClassItem[] {
  const { provenance } = result;
  const out = new Map<string, ClassItem>();
  for (const table of ['21', '22', '23']) {
    const key = tableKey(table);
    for (const path of provenance.pathsWith(key)) {
      if (provenance.hasOwn(path, K_CLASS)) continue;
      const attrs = provenance.attributesOf(path);
      const source = provenance.sourcesOf(path)[0];
      const v = attrs?.[key];
      if (!attrs || !source || K_CLASS in attrs || !isObject(v) || typeof v.code !== 'string') continue;
      const id = `${table}:${v.code}`;
      if (out.has(id)) continue;
      const medicion = medicionOf(attrs[K_MEDICION]);
      out.set(id, { path, table, code: v.code, name: typeof v.name === 'string' ? v.name : '', source, ...(medicion ? { medicion } : {}), ...priceRefOf(attrs) });
    }
  }
  return [...out.values()];
}

/**
 * The code of table 21 of an element: its composed `omniclass::Table21` (by inheritance, from a value layer
 * or own) or, if there is none, that of the previous cards (`studio::classification::omniclass-21`). `title` stays empty
 * if the value has no name. null if it has no code.
 */
export function elementClass(node: ComposedNode, table = '21'): { code: string; title: string } | null {
  const v = node.attributes[tableKey(table)];
  if (isObject(v) && typeof v.code === 'string') return { code: v.code, title: typeof v.name === 'string' ? v.name : '' };
  if (table !== '21') return null;
  const old = node.attributes[K_ASSIGN_21];
  if (isObject(old) && typeof old.code === 'string') return { code: old.code, title: typeof old.title === 'string' ? old.title : '' };
  return null;
}
