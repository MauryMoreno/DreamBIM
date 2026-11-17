// The cost system of a model: it is defined by a cost IFCx that the model composes as a layer. A root
// (`prj::costos::sistema`) says what the system is called and in which attribute the elements carry their code; each code
// is a flat node with that attribute, and it is an item if it has a measurement (`prj::medicion`) or a heading line if not.
// The price of an item is the one written on it (`prj::precio`), with its reference: the file it came from
// (`prj::origen`). Una `prj::referencia` a un APU de versiones anteriores ya no cuenta. Puro.
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode } from '../ifcx/types';
import { CURRENCIES } from './format';
import { K_ORIGEN } from '../classification/system';

export const K_COST_SYSTEM = 'prj::costos::sistema';
const K_MEDICION = 'prj::medicion';
const K_PRECIO = 'prj::precio';
/** Which document the manual price came from: `{ documento, celda }`. */
const K_CLASS = 'bsi::ifc::class';

/** The document (its path, or its name if it was pasted text) and the cell or box a price came from. */
export interface PriceOrigin {
  doc: string;
  cell: string;
}

export type Measure = 'count' | 'length' | 'area' | 'volume' | 'weight';
export type PriceFrom = 'manual' | 'none';

export const MEASURES: readonly Measure[] = ['count', 'length', 'area', 'volume', 'weight'];
export const DEFAULT_UNIT: Record<Measure, string> = { count: 'u', length: 'm', area: 'm²', volume: 'm³', weight: 'kg' };

export const NO_PRICE = 'No price';

export interface CostCode {
  /** Path of the node of the code: the one an element inherits. */
  path: string;
  code: string;
  name: string;
  /** Code of its heading line; null = root. */
  parent: string | null;
  /** null = heading line. */
  medicion: { unit: string; measure: Measure } | null;
  manualPrice: number | null;
  /** Which document the manual price came from; null if it was typed. */
  origin: PriceOrigin | null;
  unitPrice: number;
  priceFrom: PriceFrom;
  warning: string | null;
  /** What the source that defines the node is (null if none). Only an `import` can be written when editing. */
  role: 'layer' | 'import' | 'payload' | null;
  /** File of the import that defines the node, to write it when editing; null if it is not an import or it is not known where it is. */
  location: string | null;
}

export interface CostSystem {
  id: string;
  name: string;
  /** Key of the attribute where an element carries its code. */
  attribute: string;
  currency: string;
  codes: CostCode[];
  byCode: Map<string, CostCode>;
  /** Direct children (null: the roots), by code. */
  children(code: string | null): CostCode[];
  warning: string | null;
  /** Path of the root node (`prj::costos::sistema`). */
  rootPath: string;
  /** What the source of the root is; only an `import` can be written. */
  role: 'layer' | 'import' | 'payload' | null;
  /** File of the import that defines the system (where codes are created); null if it is not an import or has no path. */
  location: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** El sistema de costos del modelo compuesto, o null si ninguna capa lo define. */
export function readCostSystem(result: ComposeResult): CostSystem | null {
  const { provenance } = result;
  const roots = provenance.pathsWith(K_COST_SYSTEM).flatMap((path) => {
    const v = provenance.attributesOf(path)?.[K_COST_SYSTEM];
    return isObject(v) && typeof v.id === 'string' && typeof v.attribute === 'string' && v.attribute
      ? [{ path, v: v as Record<string, unknown> & { id: string; attribute: string } }]
      : [];
  });
  if (!roots.length) return null;
  const { path: rootPath, v } = roots[0];
  const where = (path: string): string => {
    const s = provenance.sourcesOf(path)[0];
    return s?.location ?? s?.name ?? '';
  };
  const place = where(rootPath);
  const rootSource = provenance.sourcesOf(rootPath)[0];

  const seen = new Set<string>();
  const list: CostCode[] = [];
  for (const path of provenance.pathsWith(v.attribute)) {
    if (provenance.hasOwn(path, K_CLASS)) continue;
    const attrs = provenance.attributesOf(path);
    const a = attrs?.[v.attribute];
    if (!attrs || K_CLASS in attrs || !isObject(a) || typeof a.code !== 'string' || !a.code || seen.has(a.code)) continue;
    if (where(path) !== place) continue;
    seen.add(a.code);

    const med = attrs[K_MEDICION];
    const measure = isObject(med) ? (MEASURES.find((m) => m === med.measure) ?? null) : null;
    const medicion = measure ? { unit: text((med as Record<string, unknown>).unit) || DEFAULT_UNIT[measure], measure } : null;
    const manualPrice = finite(attrs[K_PRECIO]);
    const o = attrs[K_ORIGEN];
    const origin = isObject(o) && typeof o.documento === 'string' && typeof o.celda === 'string' ? { doc: o.documento, cell: o.celda } : null;
    let unitPrice = 0;
    let priceFrom: PriceFrom = 'none';
    let warning: string | null = null;
    if (medicion) {
      if (manualPrice !== null) {
        unitPrice = manualPrice;
        priceFrom = 'manual';
      } else warning = NO_PRICE;
    }
    const source = provenance.sourcesOf(path)[0];
    list.push({
      path, code: a.code, name: text(a.name), parent: text(a.parent) || null, medicion, manualPrice, origin,
      unitPrice, priceFrom, warning, role: source?.role ?? null, location: source?.role === 'import' ? source.location ?? null : null,
    });
  }

  // a parent that does not exist, the code itself or a cycle leave the code as a root
  const byCode = new Map(list.map((c) => [c.code, c]));
  for (const c of list) if (c.parent !== null && !byCode.has(c.parent)) c.parent = null;
  for (const c of list) {
    const walked = new Set<string>([c.code]);
    for (let p = c.parent; p !== null; p = byCode.get(p)!.parent) {
      if (walked.has(p)) {
        c.parent = null;
        break;
      }
      walked.add(p);
    }
  }

  const byParent = new Map<string | null, CostCode[]>();
  for (const c of list) byParent.set(c.parent, [...(byParent.get(c.parent) ?? []), c]);
  for (const kids of byParent.values()) kids.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

  return {
    id: v.id,
    rootPath,
    role: rootSource?.role ?? null,
    location: rootSource?.role === 'import' ? rootSource.location ?? null : null,
    name: text(v.name) || v.id,
    attribute: v.attribute,
    currency: typeof v.currency === 'string' && CURRENCIES.includes(v.currency) ? v.currency : 'USD',
    codes: list,
    byCode,
    children: (code) => byParent.get(code) ?? [],
    warning: roots.length > 1 ? `More than one cost system: using ${v.id}, ignoring ${roots.slice(1).map((r) => r.v.id).join(', ')}` : null,
  };
}

/** The cost code of an element: the composed value of the attribute of the system (inherited or written). null if it has none. */
export function elementCode(node: ComposedNode, system: CostSystem): string | null {
  const a = node.attributes[system.attribute];
  return isObject(a) && typeof a.code === 'string' && a.code ? a.code : null;
}
