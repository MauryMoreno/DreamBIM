import type { AttributeOrigin, ComposedNode, IfcxFile, IfcxNode, Provenance, ProvenanceSource } from '../types';
import { FlatNode } from './types';
import { head, tail, nestedPrefixes } from './flatten';
import { Composer } from './composer';

/**
 * Consultas de procedencia. Retiene `nodes`, `definedIn` y, en los cierres, el `data` de los archivos
 * (for `sourceFor`); not the Composer (its cache is the whole model).
 */
export function makeProvenance(
  files: readonly IfcxFile[],
  nodes: Map<string, FlatNode>,
  payloadFiles: ReadonlyMap<string, IfcxFile>,
  payloadRoots: ReadonlyMap<string, string[]>,
  definedIn: Map<string, number[]>,
  sources: readonly ProvenanceSource[],
): Provenance {
  let prefixes: Set<string> | null = null;
  const hasDataUnder = (p: string) => (prefixes ??= nestedPrefixes(nodes)).has(p);

  // por archivo consultado: ruta -> sus nodos
  const byFile = new Map<number, Map<string, IfcxNode[]>>();
  const nodesIn = (i: number, path: string): IfcxNode[] => {
    let m = byFile.get(i);
    if (!m) {
      byFile.set(i, m = new Map());
      for (const n of files[i].data as IfcxNode[]) {
        const l = m.get(n.path);
        if (l) l.push(n); else m.set(n.path, [n]);
      }
    }
    return m.get(path) ?? [];
  };
  /** The strongest source that writes `key` at `path` (or the strongest of the path). */
  const sourceFor = (path: string, key: string): ProvenanceSource => {
    const d = definedIn.get(path) ?? [];
    for (let j = d.length - 1; j >= 0; j--) {
      if (nodesIn(d[j], path).some((n) => n.attributes && key in n.attributes)) return sources[d[j]];
    }
    // without annotation: the strongest source of all
    return sources[d.length ? d[d.length - 1] : sources.length - 1];
  };

  // State of a descendant `sub` of the node being composed: `d` = how many segments of `sub` exist;
  // `o` = origins of its attributes if it exists in full (d === sub.length), otherwise null.
  type Origins = Map<string, AttributeOrigin>;
  type State = { d: number; o: Origins | null };
  const via = (k: string, o: AttributeOrigin): AttributeOrigin => o.kind === 'local'
    ? { kind: 'inherited', via: [k], target: o.path, source: o.source }
    : { ...o, via: [k, ...o.via] };
  const relabel = (k: string, o: Origins | null) => o && new Map([...o].map(([a, x]) => [a, via(k, x)]));

  const stack = new Set<string>();

  /** Refleja `Composer.composeInto(path, ·)` solo para el descendiente `sub`. */
  const trace = (path: string, sub: string[], st: State): State => {
    let { d, o } = st;
    const flat = nodes.get(path);
    if (flat) {
      for (const [k, ih] of Object.entries(flat.inherits)) {
        const got = traceRef(ih, sub);
        if (!got) continue;
        if (!sub.length) {
          o ??= new Map();
          for (const [a, x] of got.o!) o.set(a, via(k, x));
        } else if (got.d >= 1) {
          // el hijo heredado sustituye al que hubiera
          d = got.d; o = relabel(k, got.o);
        }
      }
      if (sub.length && sub[0] in flat.children) {
        const ref = flat.children[sub[0]];
        if (ref === null) { d = 0; o = null; }
        else {
          const got = traceRef(ref, sub.slice(1));
          if (got) { d = got.d + 1; o = got.o; }
        }
      }
      if (!sub.length) {
        o ??= new Map();
        for (const [a, v] of Object.entries(flat.attributes)) {
          if (v === null) { o.delete(a); continue; }
          const prev = o.get(a);
          o.set(a, { kind: 'local', path, source: sourceFor(path, a), ...(prev && { overrides: prev }) });
        }
      }
    }
    if (sub.length && d >= 1 && hasDataUnder(`${path}/${sub[0]}`)) {
      const r = trace(`${path}/${sub[0]}`, sub.slice(1), { d: d - 1, o });
      return { d: r.d + 1, o: r.o };
    }
    return { d, o };
  };

  /** Como `Composer.resolve(ref)` y luego el descendiente `sub`; null si ref no se resuelve (ciclo o inexistente). */
  const traceRef = (ref: string, sub: string[]): State | null => {
    const h = head(ref);
    if (stack.has(h)) return null;
    const pre = tail(ref).split('/').filter(Boolean);
    const all = [...pre, ...sub];
    stack.add(h);
    const r = trace(h, all, { d: 0, o: all.length ? null : new Map() });
    stack.delete(h);
    if (r.d < pre.length) return null;
    return { d: r.d - pre.length, o: r.o };
  };

  return {
    sources,
    inheritsOf: (origin) => ({ ...nodes.get(origin)?.inherits }),
    sourcesOf: (path) => (definedIn.get(path) ?? []).map((i) => sources[i]),
    pathsWith: (key) => [...nodes].filter(([, n]) => key in n.attributes).map(([p]) => p),
    attributeSources: (path) => Object.fromEntries(Object.keys(nodes.get(path)?.attributes ?? {}).map((k) => [k, sourceFor(path, k)])),
    attributesOf: (path) => {
      if (!nodes.has(head(path))) return null;
      // New, ephemeral Composer: it shares neither cache nor warnings with compose,
      // but it reuses the prefix index of this provenance instead of rebuilding it.
      const w = new Composer(nodes, payloadFiles, payloadRoots, hasDataUnder).resolve(path);
      return w ? Object.fromEntries(w.attributes) : null;
    },
    hasOwn: (path, key) => {
      const a = nodes.get(path)?.attributes;
      return !!a && key in a && a[key] !== null;
    },
    // Empty on purpose if `node` or an ancestor has variants (out of scope: the variant may
    // override attributes or replace children and we would give a false origin). With cycles, the result
    // may differ from that of compose, which depends on the order of its cache.
    explain: (node) => {
      // `top`: the ancestor that is a child of the root; `sub`: names from it down to `node`
      const sub: string[] = [];
      let top: ComposedNode = node;
      for (; top.parent?.parent; top = top.parent) {
        if (top.variantSets) return {};
        sub.unshift(top.name);
      }
      if (!top.parent || top.variantSets) return {};
      const o = traceRef(top.origin, sub)?.o;
      const out: Record<string, AttributeOrigin> = {};
      if (o) for (const [k, x] of o) if (k in node.attributes) out[k] = x;
      return out;
    },
  };
}
