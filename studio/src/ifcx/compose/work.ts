import { VariantSet, WorkNode } from './types';

export function cloneWork(n: WorkNode): WorkNode {
  const children = new Map<string, WorkNode>();
  for (const [k, c] of n.children) children.set(k, cloneWork(c));
  const variants = new Map<string, VariantSet>();
  for (const [k, v] of n.variants) variants.set(k, cloneVariant(v));
  return { origin: n.origin, attributes: new Map(n.attributes), children, variants, payloads: new Map(n.payloads), loaded: new Set(n.loaded) };
}

export function cloneVariant(v: VariantSet): VariantSet {
  const applied = v.applied && {
    children: v.applied.children.map(([k, c]): [string, WorkNode | undefined] => [k, c && cloneWork(c)]),
    attributes: [...v.applied.attributes],
  };
  return { options: new Map(v.options), selected: v.selected, applied };
}

/** Deshace una variante aplicada, en orden inverso. */
export function revert(target: WorkNode, v: VariantSet) {
  const u = v.applied;
  if (!u) return;
  for (let i = u.children.length - 1; i >= 0; i--) {
    const [k, prev] = u.children[i];
    if (prev) target.children.set(k, prev); else target.children.delete(k);
  }
  for (let i = u.attributes.length - 1; i >= 0; i--) {
    const [k, prev] = u.attributes[i];
    if (prev === undefined) target.attributes.delete(k); else target.attributes.set(k, prev);
  }
  v.applied = null;
}

export function childAt(n: WorkNode, sub: string): WorkNode | null {
  if (sub === '') return n;
  let cur: WorkNode | undefined = n;
  for (const part of sub.split('/')) {
    cur = cur.children.get(part);
    if (!cur) return null;
  }
  return cur;
}
