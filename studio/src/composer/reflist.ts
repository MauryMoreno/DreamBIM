// Pure logic of the References tab: the files that enter the composition and which elements
// use them through their `inherits`. No DOM.
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode, ProvenanceSource } from '../ifcx/types';
import { sourceLabel } from '../properties/references';

export type RefRole = 'document' | 'layer' | 'import' | 'payload';

export interface RefFile {
  /** Location, or the name if it is not known where it is (unsaved document). */
  key: string;
  role: RefRole;
  /** Último segmento de la ruta. */
  name: string;
  /** Ruta relativa al documento (una url, tal cual). */
  label: string;
  /** Ruta completa, para el tooltip. */
  title: string;
  location?: string;
  /** Nodes of the tree that inherit, directly or indirectly, from something this file defines. */
  usedBy: number;
}

const head = (p: string) => p.split('/')[0];
const keyOf = (s: ProvenanceSource) => s.location ?? s.name;
const baseName = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p;

/** Edits of a layer and overlays of sidecars: internal layers, not files the user linked. */
const internal = (s: ProvenanceSource) => !!s.layerId && (s.layerId.startsWith('overlay:') || s.layerId.endsWith(':edits'));

/**
 * Files each data path reaches through its inheritances (its own included), with the rule of
 * Properties: a file "defines" a path if it is the weakest source that writes it.
 */
function reacher(result: ComposeResult) {
  const P = result.provenance;
  const memo = new Map<string, readonly string[]>();
  const stack = new Set<string>();
  const reach = (path: string): readonly string[] => {
    const h = head(path);
    const hit = memo.get(h);
    if (hit) return hit;
    if (stack.has(h)) return []; // cycle: it is already being counted higher up
    stack.add(h);
    const keys = new Set<string>();
    const def = P.sourcesOf(h)[0];
    if (def) keys.add(keyOf(def));
    for (const t of Object.values(P.inheritsOf(h))) for (const k of reach(t)) keys.add(k);
    stack.delete(h);
    const out = [...keys];
    memo.set(h, out);
    return out;
  };
  /** Files the element `origin` reaches, without the one that defines it. */
  const of = (origin: string): Set<string> => {
    const keys = new Set<string>();
    for (const t of Object.values(P.inheritsOf(origin))) for (const k of reach(t)) keys.add(k);
    return keys;
  };
  return { of };
}

const reachers = new WeakMap<ComposeResult, ReturnType<typeof reacher>>();
const reachOf = (result: ComposeResult) => {
  let r = reachers.get(result);
  if (!r) reachers.set(result, (r = reacher(result)));
  return r;
};

/** Files `node` references through its inheritances (keys of RefFile), without the file that defines it. */
export function referencedBy(result: ComposeResult, node: ComposedNode): Set<string> {
  return node.origin ? reachOf(result).of(node.origin) : new Set();
}

/** Rows of the tab: from the strongest source to the weakest, one per file. */
export function referenceFiles(result: ComposeResult, docPath: string | null): RefFile[] {
  const sources = result.provenance.sources;
  // the document is the last real layer of the stack: only the overlays go on top
  let docIndex = -1;
  sources.forEach((s, i) => { if (s.role === 'layer' && !internal(s)) docIndex = i; });

  const uses = new Map<string, number>();
  const { of } = reachOf(result);
  for (const [origin, nodes] of result.byOrigin) {
    for (const k of of(origin)) uses.set(k, (uses.get(k) ?? 0) + nodes.length);
  }

  const rows: RefFile[] = [];
  const seen = new Set<string>();
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = sources[i];
    if (internal(s)) continue;
    const key = keyOf(s);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = sourceLabel(s, docPath);
    const row: RefFile = {
      key,
      role: i === docIndex ? 'document' : s.role,
      name: baseName(label),
      label,
      title: s.location ?? s.name,
      usedBy: uses.get(key) ?? 0,
    };
    if (s.location) row.location = s.location;
    rows.push(row);
  }
  return rows;
}
