import type { IfcxFile, IfcxNode } from '../types';
import { FlatNode } from './types';

export const head = (p: string) => p.split('/')[0];

export const tail = (p: string) => p.split('/').slice(1).join('/');

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Fases 1 y 2: federar y aplanar. `null` en children/inherits/attributes elimina.
 * With `definedIn`, it annotates per path the indexes of the files that write it (in order).
 * With `warnings`, every ignored malformed item pushes one line.
 * With `payloadKey`, each payload carries the identity it is loaded under.
 */
export function flatten(
  layers: IfcxFile[],
  definedIn?: Map<string, number[]>,
  warnings?: string[],
  payloadKey?: (uri: string, fileIndex: number) => string,
): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>();
  const said = new Set<string>();
  const ignore = (line: string) => {
    if (!warnings || said.has(line)) return;
    said.add(line);
    warnings.push(line);
  };
  let withoutPath = 0;
  for (let li = 0; li < layers.length; li++) {
    for (const raw of layers[li].data as unknown[]) {
      const n = raw as IfcxNode;
      if (!isPlain(n) || typeof n.path !== 'string' || !n.path) {
        withoutPath++;
        continue;
      }
      let f = out.get(n.path);
      if (!f) {
        f = { path: n.path, children: {}, inherits: {}, attributes: {}, variants: {}, variantSelection: {}, payloads: {} };
        out.set(n.path, f);
      }
      if (definedIn) {
        const d = definedIn.get(n.path);
        if (d) d.push(li); else definedIn.set(n.path, [li]);
      }
      /** The field as a plain object, or undefined (with a warning) when it is present but malformed. */
      const field = (name: keyof IfcxNode): Record<string, unknown> | undefined => {
        const v = n[name];
        if (v === undefined) return undefined;
        if (isPlain(v)) return v;
        ignore(`Ignored invalid "${name}" at "${n.path}"`);
        return undefined;
      };
      for (const [k, v] of Object.entries(field('children') ?? {})) {
        if (v !== null && typeof v !== 'string') {
          ignore(`Ignored invalid reference "${n.path}" children.${k}`);
          continue;
        }
        f.children[k] = v;
      }
      for (const [k, v] of Object.entries(field('inherits') ?? {})) {
        if (v === null) { delete f.inherits[k]; continue; }
        if (typeof v !== 'string') {
          ignore(`Ignored invalid reference "${n.path}" inherits.${k}`);
          continue;
        }
        f.inherits[k] = v;
      }
      for (const [k, v] of Object.entries(field('attributes') ?? {})) f.attributes[k] = v;
      for (const [k, v] of Object.entries(field('variants') ?? {})) f.variants[k] = { ...f.variants[k], ...(v as Record<string, string>) };
      for (const [k, v] of Object.entries(field('variantSelection') ?? {})) f.variantSelection[k] = v as string;
      for (const [k, v] of Object.entries(field('payloads') ?? {})) {
        const p = v as FlatNode['payloads'][string];
        f.payloads[k] = { ...p, key: payloadKey?.(p.uri, li) ?? p.uri };
      }
    }
  }
  if (withoutPath) ignore(`Ignored ${withoutPath} ${withoutPath === 1 ? 'node' : 'nodes'} without a valid path`);
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
