import type { IfcxFile, IfcxNode } from '../types';
import { FlatNode } from './types';

export const head = (p: string) => p.split('/')[0];

export const tail = (p: string) => p.split('/').slice(1).join('/');

/**
 * Fases 1 y 2: federar y aplanar. `null` en children/inherits/attributes elimina.
 * With `definedIn`, it annotates per path the indexes of the files that write it (in order).
 */
export function flatten(layers: IfcxFile[], definedIn?: Map<string, number[]>): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>();
  for (let li = 0; li < layers.length; li++) {
    for (const n of layers[li].data as IfcxNode[]) {
      let f = out.get(n.path);
      if (!f) {
        f = { path: n.path, children: {}, inherits: {}, attributes: {}, variants: {}, variantSelection: {}, payloads: {} };
        out.set(n.path, f);
      }
      if (definedIn) {
        const d = definedIn.get(n.path);
        if (d) d.push(li); else definedIn.set(n.path, [li]);
      }
      for (const [k, v] of Object.entries(n.children ?? {})) f.children[k] = v;
      for (const [k, v] of Object.entries(n.inherits ?? {})) {
        if (v === null) delete f.inherits[k];
        else f.inherits[k] = v;
      }
      for (const [k, v] of Object.entries(n.attributes ?? {})) f.attributes[k] = v;
      for (const [k, v] of Object.entries(n.variants ?? {})) f.variants[k] = { ...f.variants[k], ...v };
      for (const [k, v] of Object.entries(n.variantSelection ?? {})) f.variantSelection[k] = v;
      for (const [k, v] of Object.entries(n.payloads ?? {})) f.payloads[k] = v;
    }
  }
  return out;
}

/** Roots: single-segment paths that nobody references as a child or inheritance. */
export function findRoots(nodes: Map<string, FlatNode>): string[] {
  const referenced = new Set<string>();
  for (const n of nodes.values()) {
    for (const c of Object.values(n.children)) if (c) referenced.add(head(c));
    for (const i of Object.values(n.inherits)) referenced.add(head(i));
    for (const opts of Object.values(n.variants)) for (const r of Object.values(opts)) referenced.add(head(r));
    for (const p of Object.values(n.payloads)) if (p.path) referenced.add(head(p.path));
  }
  return [...nodes.keys()].filter(p => !p.includes('/') && !referenced.has(p));
}

/** Prefixes of nested paths with data ("uuid/Body", "uuid/Body/x"): where composeInto descends. */
export function nestedPrefixes(nodes: Map<string, FlatNode>): Set<string> {
  const out = new Set<string>();
  for (const k of nodes.keys()) {
    const parts = k.split('/');
    for (let i = 2; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}

/** Aplana atributos-objeto de un nivel ("usd::usdgeom::mesh" -> "...::points") como la referencia. */
export function flattenAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [ck, cv] of Object.entries(v as Record<string, unknown>)) out[`${k}::${ck}`] = cv;
    } else {
      out[k] = v;
    }
  }
  return out;
}
