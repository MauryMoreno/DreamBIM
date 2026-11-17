// Assign a classification code to an element: inherit the item of the table (`inherits.omniclass21`,
// `inherits.omniclass23`…) o, si no se puede, escribir el valor. Puro: recibe y devuelve listas de nodos sin mutarlas
// (la misma lista = nada que cambiar).
import { setAttr, setInherit } from '../composer/edits';
import { linkUri } from '../composer/uri';
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode, IfcxNode } from '../ifcx/types';
import type { ClassItem } from './nodes';
import { K_ASSIGN_21 } from './state';
import { itemPath, tableKey, type ClassTableRef } from './system';

/** Key of `inherits` with which an element references its code of the table `table`. */
export const inheritKey = (table: string): string => `omniclass${table}`;

/** Table of a code ('23-25 30 …' → '23'). */
export const tableOf = (code: string): string => code.trim().slice(0, 2);

/** What a code is assigned to. */
export interface ClassTarget {
  /** '21', '23'… */
  table: string;
  code: string;
  name: string;
  /** Path of the table node that is inherited; null = the value is written on the element. */
  item: string | null;
  /** Uri (relative to the document) of the table that must be imported so that `item` exists. */
  importUri?: string;
}

/**
 * Where the code is: (1) an item of a table the model already imports; (2) an item of a flat table of the
 * folder, which will be imported (the path of the document is needed for the relative uri); (3) otherwise, only the value. A
 * table of the previous format is not inherited: it would drag its children into the element. `hint`: the title if no table gives it.
 */
export function resolveClassTarget(
  code: string,
  hint: string | undefined,
  items: readonly ClassItem[],
  tables: readonly ClassTableRef[],
  docPath: string | null,
  imported: readonly string[],
): ClassTarget {
  const table = tableOf(code);
  const item = items.find((i) => i.table === table && i.code === code);
  if (item) return { table, code, name: item.name, item: item.path };
  const known = tables.filter((t) => t.system.info.table === table);
  const title = known.map((t) => t.system.title(code)).find((x): x is string => !!x) ?? hint ?? '';
  const ref = known.find((t) => t.system.flat && t.system.byCode.has(code));
  if (ref && docPath) {
    const uri = linkUri(docPath, ref.path);
    return { table, code, name: title, item: itemPath(ref.system.info.id, code), ...(imported.includes(uri) ? {} : { importUri: uri }) };
  }
  return { table, code, name: title, item: null };
}

/**
 * Assigns `target` (or with null removes the code of the table `table`) to the element at `path`. The own attributes are
 * applied after what is inherited: if the code arrives by another way (own value, a card, a value layer) and
 * it is not the new one, it is overridden with it; on removal `null` is written there too. If it is already so, it returns the same
 * lista.
 */
export function assignClass(
  overs: IfcxNode[],
  path: string,
  target: ClassTarget | null,
  node: ComposedNode,
  result: ComposeResult,
  table: string = target?.table ?? '21',
): IfcxNode[] {
  const key = tableKey(table);
  const inheritAs = inheritKey(table);
  const inherited = result.provenance.inheritsOf(node.origin)[inheritAs] ?? null;
  const exp = result.provenance.explain(node)[key];
  // does the composed value arrive only through the own inheritance?
  const own = exp?.kind === 'inherited' && exp.via.length === 1 && exp.via[0] === inheritAs;
  const composed = node.attributes[key] as { code?: unknown; name?: unknown } | undefined;
  let out = overs;

  if (target === null) {
    if (inherited !== null) out = setInherit(out, path, inheritAs, null);
    if (composed !== undefined && !own) out = setAttr(out, path, key, null);
    if (table === '21' && node.attributes[K_ASSIGN_21] !== undefined) out = setAttr(out, path, K_ASSIGN_21, null);
    return out;
  }

  if (target.item !== null) {
    if (inherited !== target.item) out = setInherit(out, path, inheritAs, target.item);
    if (composed !== undefined && !own && composed.code !== target.code) {
      out = setAttr(out, path, key, { code: target.code, name: target.name });
    }
    return out;
  }

  if (inherited !== null) out = setInherit(out, path, inheritAs, null);
  const same = exp?.kind === 'local' && composed?.code === target.code && (composed.name ?? '') === target.name;
  if (!same) out = setAttr(out, path, key, { code: target.code, name: target.name });
  return out;
}
