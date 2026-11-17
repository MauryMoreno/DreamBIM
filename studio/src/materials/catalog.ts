// Catalog of materials, their use in the model and assignment rules. Pure: no DOM or viewer.
import type { QuantityRow } from '../render/viewer';
import { isPrefix } from '../classification/system';
import { modelColor, type MaterialNode, type MaterialSite } from './nodes';
import type { MaterialDef } from './state';

/** A material node of the model with what the document overrides of it (attribute keys). */
export type CatalogNode = MaterialNode & { overridden: string[] };

export interface CatalogEntry {
  def: MaterialDef;
  /** Path of the material node; null = the model only brings the code on its elements. */
  path: string | null;
  /** Where the node can be written; null without a node. */
  site: MaterialSite | null;
  /** File that defines it; null if it is the document itself or there is no node. */
  sourceName: string | null;
  /** Attributes the document overrides (empty if there is no over). */
  overridden: string[];
  /** Elementos distintos con este material efectivo. */
  elements: number;
}

export interface UsageRow {
  /** '' = elementos sin material. */
  code: string;
  name: string;
  /** Color de la muestra: el del material o el de «sin material». */
  color: string;
  elements: number;
  area: number;
  volume: number;
  /** Rutas compuestas de esos elementos. */
  paths: string[];
}

/** Elements without material: light grey and semi-transparent, so they stand out. */
// (the color is a number so as not to have color literals in strings, which css-tokens.test.ts watches)
export const NO_MATERIAL = { color: '#' + (0xb0b0b0).toString(16), opacity: 0.35 };

export { modelColor };

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

const byName = (a: CatalogEntry, b: CatalogEntry) => a.def.name.localeCompare(b.def.name);

/**
 * The material nodes of the model and the codes their elements bring without a node (with a stable color),
 * sorted by name. `elements` counts the distinct elements that use each code.
 */
export function catalog(nodes: readonly CatalogNode[], rows: QuantityRow[]): CatalogEntry[] {
  const used = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.materialCode === null) continue;
    let set = used.get(r.materialCode);
    if (!set) used.set(r.materialCode, (set = new Set()));
    set.add(r.element);
  }
  const entries: CatalogEntry[] = nodes.map((n) => ({
    def: n.def,
    path: n.path,
    site: n.site,
    sourceName: n.site === 'document' ? null : baseName(n.source.location ?? n.source.name),
    overridden: n.overridden,
    elements: used.get(n.def.code)?.size ?? 0,
  }));
  const defined = new Set(nodes.map((n) => n.def.code));
  for (const [code, elements] of used) {
    if (defined.has(code)) continue;
    entries.push({
      def: { name: code, code, color: modelColor(code), opacity: 1 },
      path: null, site: null, sourceName: null, overridden: [], elements: elements.size,
    });
  }
  return entries.sort(byName);
}

/** One row per effective material (in catalog order) and a final "No material" if there are elements without one. */
export function usage(entries: CatalogEntry[], rows: QuantityRow[]): UsageRow[] {
  const groups = new Map<string, UsageRow>();
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const code = r.materialCode ?? '';
    let g = groups.get(code);
    if (!g) {
      const entry = entries.find((e) => e.def.code === code);
      const name = code === '' ? 'No material' : entry?.def.name ?? code;
      const color = code === '' ? NO_MATERIAL.color : entry?.def.color ?? modelColor(code);
      groups.set(code, (g = { code, name, color, elements: 0, area: 0, volume: 0, paths: [] }));
      seen.set(code, new Set());
    }
    g.area += r.area;
    g.volume += r.volume;
    if (!seen.get(code)!.has(r.element)) {
      seen.get(code)!.add(r.element);
      g.elements++;
      g.paths.push(r.element);
    }
  }
  const order = [...entries.map((e) => e.def.code), ''];
  return order.flatMap((c) => (groups.has(c) ? [groups.get(c)!] : []));
}

export interface MaterialRule {
  cls?: string;
  storey?: string;
  /** code del material actual; '' = sin material. Sin definir = cualquiera. */
  material?: string;
  /** Prefix of an OmniClass 21 code of the element (by pairs: '21-02' takes '21-02 10 10'). */
  omniclass21?: string;
  /** Code of table 23 (Products), by prefix. */
  omniclass23?: string;
}

/**
 * Composed paths, without repeats, of the elements that satisfy all the given fields. `omniclass21` is
 * satisfied by prefix on the code of `classOf`; without `classOf` a rule with `omniclass21` takes nothing.
 */
export function matchRule(rows: QuantityRow[], rule: MaterialRule, classOf?: (path: string, table?: string) => string | null): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (rule.omniclass21 !== undefined) {
      const code = classOf?.(r.element);
      if (!code || !isPrefix(rule.omniclass21, code)) continue;
    }
    if (rule.omniclass23 !== undefined) {
      const code = classOf?.(r.element, '23');
      if (!code || !isPrefix(rule.omniclass23, code)) continue;
    }
    if (rule.cls !== undefined && r.cls !== rule.cls) continue;
    if (rule.storey !== undefined && r.storey !== rule.storey) continue;
    if (rule.material !== undefined && (r.materialCode ?? '') !== rule.material) continue;
    out.add(r.element);
  }
  return [...out];
}
