// Classification systems (such as OmniClass tables 21 and 22, imported by the user) as IFCx files: a root with
// `system` and one node per code, in a flat list (the root hangs them all) so that an element can inherit an item
// without dragging children. The levels come from the code itself. Pure.
import type { IfcxFile, IfcxNode, IfcxSchema } from '../ifcx/types';

/** Measurement the table gives to an item: unit and which quantity of the geometry measures it. */
export interface Medicion {
  unit: string;
  measure: string;
  quantity: string[];
}

export interface ClassEntry {
  code: string;
  title: string;
  level: number;
  medicion?: Medicion;
  /** Price per unit of its measurement (`prj::precio`): the one for the lines without APU of what hangs from it. */
  price?: number;
  /** Free reference of the code (`prj::referencia`): a code of a price base, of a supplier… */
  reference?: string;
  /** Where the price was chosen from (`prj::origen`): the document and its cell. */
  origin?: PriceOrigin;
}

/** The document (its path, or its name if it was pasted text) and the cell a price came from. */
export interface PriceOrigin {
  doc: string;
  cell: string;
}

/** What is written for each code in the layer of the table. */
export interface ClassEntryData {
  code: string;
  title: string;
  medicion?: Medicion;
  price?: number;
  reference?: string;
  origin?: PriceOrigin;
}

export interface ClassSystemInfo {
  id: string;
  name: string;
  table: string;
  title: string;
  edition: string;
  /** Subconjunto incluido en la app (no la tabla oficial completa). */
  starter: boolean;
}

export interface ClassSystem {
  info: ClassSystemInfo;
  /** File it was read from; missing in the tables that come with the app. */
  path?: string;
  /** Los items son nodos planos con `omniclass::TableN`: se pueden heredar. El formato anterior no. */
  flat: boolean;
  entries: ClassEntry[];
  byCode: Map<string, ClassEntry>;
  /** Direct children of a code (null: the roots), by code. */
  children(code: string | null): ClassEntry[];
  parent(code: string): ClassEntry | null;
  title(code: string): string | null;
}

export const K_CLASS_SYSTEM = 'studio::classification::system';
/** Previous format of an item (hierarchical, with title): only read. */
export const K_CLASS_ITEM = 'studio::classification::item';
export const K_MEDICION = 'prj::medicion';
/** Price per unit of the measurement of a code of a table. */
export const K_PRECIO = 'prj::precio';
/** Free reference of a code of a table. */
export const K_REFERENCIA = 'prj::referencia';
/** Where the price of a code was chosen from: `{ documento, celda }`. */
export const K_ORIGEN = 'prj::origen';

/** Schemas of the value attributes of a code (measurement, price, reference and origin). */
export const CODE_VALUE_SCHEMAS: Record<string, IfcxSchema> = {
  [K_MEDICION]: { value: { dataType: 'Object' } },
  [K_PRECIO]: { value: { dataType: 'Real' } },
  [K_REFERENCIA]: { value: { dataType: 'String' } },
  [K_ORIGEN]: { value: { dataType: 'Object', objectRestrictions: { values: { documento: { dataType: 'String' }, celda: { dataType: 'String' } } } } },
};

/** The optional fields of a code (measurement, price and reference) as attributes of its node. */
const extrasOf = (e: { medicion?: Medicion; price?: number; reference?: string; origin?: PriceOrigin }) => ({
  ...(e.medicion ? { [K_MEDICION]: e.medicion } : {}),
  ...(e.price !== undefined && Number.isFinite(e.price) ? { [K_PRECIO]: e.price } : {}),
  ...(e.reference ? { [K_REFERENCIA]: e.reference } : {}),
  ...(e.origin ? { [K_ORIGEN]: { documento: e.origin.doc, celda: e.origin.cell } } : {}),
});

/** Price and reference read from the attributes of a table node. */
export function priceRefOf(attrs: Record<string, unknown> | undefined): { price?: number; reference?: string; origin?: PriceOrigin } {
  const p = attrs?.[K_PRECIO];
  const r = attrs?.[K_REFERENCIA];
  const o = attrs?.[K_ORIGEN] as { documento?: unknown; celda?: unknown } | undefined;
  return {
    ...(typeof p === 'number' && Number.isFinite(p) ? { price: p } : {}),
    ...(typeof r === 'string' && r.trim() ? { reference: r.trim() } : {}),
    ...(o && typeof o.documento === 'string' && typeof o.celda === 'string' ? { origin: { doc: o.documento, cell: o.celda } } : {}),
  };
}

/** Attribute of the code of the table `table` ('21' or '22'): `{ code, name }`. */
export const tableKey = (table: string): string => `omniclass::Table${table}`;

// 'NN-AA BB CC' con hasta seis pares tras el prefijo (la tabla 23 llega a seis niveles) y una parte decimal
// opcional ('22-03 31 13.13')
const CODE_RE = /^(\d{2})-(\d{2}(?: \d{2}){0,5})(\.\d+)?$/;

/** Prefix, pairs without trailing zeros and decimal part; null if it is not a code. */
export function significant(code: string): string[] | null {
  const m = CODE_RE.exec(code.trim());
  if (!m) return null;
  const pairs = m[2].split(' ');
  while (pairs.length > 1 && pairs[pairs.length - 1] === '00') pairs.pop();
  return [m[1], ...pairs, ...(m[3] ? [m[3]] : [])];
}

/** Level of the code: 1 for '21-02 00 00', 2 for '21-02 10 00'… 0 if it is not a code. */
export function levelOf(code: string): number {
  const s = significant(code);
  return s ? s.length - 1 : 0;
}

/** Is `code` inside `prefix`? It is compared by whole pairs: '21-02' contains '21-02 10 10', not '21-020…'. */
export function isPrefix(prefix: string, code: string): boolean {
  const a = significant(prefix);
  const b = significant(code);
  return !!a && !!b && a.length <= b.length && a.every((x, i) => x === b[i]);
}

/**
 * The parent of each code: the one in the list with the highest level that is a proper prefix of it (null if it has none). It is looked up
 * by its significant pairs, removing one at a time: linear in the number of codes (comparing each code with
 * all the others took seconds with the 2600 of table 23).
 */
function parentsOf(codes: readonly string[]): Map<string, string | null> {
  const byKey = new Map<string, string>();
  const keyOf = new Map<string, string[]>();
  for (const c of codes) {
    const parts = significant(c);
    if (!parts) continue;
    keyOf.set(c, parts);
    const key = parts.join('|');
    if (!byKey.has(key)) byKey.set(key, c);
  }
  const out = new Map<string, string | null>();
  for (const c of codes) {
    const parts = keyOf.get(c);
    let parent: string | null = null;
    for (let n = (parts?.length ?? 0) - 1; parts && n >= 2 && parent === null; n--) parent = byKey.get(parts.slice(0, n).join('|')) ?? null;
    out.set(c, parent);
  }
  return out;
}

const slug = (code: string) => code.replace(/[ .]/g, '_');

/** Path of the node of a code in the file of its system: deterministic, so that reimporting does not break references. */
export const itemPath = (systemId: string, code: string): string => `${systemId}-${slug(code)}`;

/**
 * The IFCx file of a system: the root hangs all the codes and each one is a flat node with its
 * `omniclass::TableN { code, name }` (and its measurement if it has one).
 */
export function buildSystem(info: ClassSystemInfo, entries: ClassEntryData[]): IfcxFile {
  const key = tableKey(info.table);
  const root: IfcxNode = { path: info.id, children: {}, attributes: { [K_CLASS_SYSTEM]: { ...info } } };
  const items: IfcxNode[] = [];
  for (const e of entries) {
    const path = itemPath(info.id, e.code);
    items.push({
      path,
      attributes: { [key]: { code: e.code, name: e.title }, ...extrasOf(e) },
    });
    root.children![slug(e.code)] = path;
  }
  return {
    header: { id: `studio-classification/${info.id}`, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
    imports: [],
    schemas: {
      [K_CLASS_SYSTEM]: { value: { dataType: 'Object' } },
      [key]: { value: { dataType: 'Object' } },
      ...CODE_VALUE_SCHEMAS,
    },
    data: [root, ...items],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The measurement of a `prj::medicion`, or undefined if it has no unit and measure. */
export function medicionOf(v: unknown): Medicion | undefined {
  if (!isObject(v) || typeof v.unit !== 'string' || typeof v.measure !== 'string') return undefined;
  return { unit: v.unit, measure: v.measure, quantity: Array.isArray(v.quantity) ? v.quantity.filter((q): q is string => typeof q === 'string') : [] };
}

/**
 * Reads a system file (the flat format and the previous one); null if it has no root. It ignores the entries
 * it does not understand. `path`: the file it was read from.
 */
export function systemFromFile(file: IfcxFile, path?: string): ClassSystem | null {
  let info: ClassSystemInfo | null = null;
  for (const n of file.data ?? []) {
    const sys = n.attributes?.[K_CLASS_SYSTEM];
    if (isObject(sys) && typeof sys.id === 'string' && typeof sys.table === 'string') {
      info = {
        id: sys.id,
        name: typeof sys.name === 'string' ? sys.name : 'OmniClass',
        table: sys.table,
        title: typeof sys.title === 'string' ? sys.title : '',
        edition: typeof sys.edition === 'string' ? sys.edition : '',
        starter: sys.starter === true,
      };
      break;
    }
  }
  if (!info) return null;
  const key = tableKey(info.table);
  const byCodeRead = new Map<string, ClassEntry>();
  let flat = false;
  for (const n of file.data ?? []) {
    const v = n.attributes?.[key];
    if (isObject(v) && typeof v.code === 'string' && levelOf(v.code) > 0) {
      const medicion = medicionOf(n.attributes?.[K_MEDICION]);
      byCodeRead.set(v.code, {
        code: v.code, title: typeof v.name === 'string' ? v.name : '', level: levelOf(v.code), ...(medicion ? { medicion } : {}), ...priceRefOf(n.attributes),
      });
      flat = true;
      continue;
    }
    const item = n.attributes?.[K_CLASS_ITEM];
    if (isObject(item) && typeof item.code === 'string' && typeof item.title === 'string' && levelOf(item.code) > 0 && !byCodeRead.has(item.code)) {
      byCodeRead.set(item.code, { code: item.code, title: item.title, level: levelOf(item.code) });
    }
  }
  const entries = [...byCodeRead.values()];
  entries.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const byCode = new Map(entries.map((e) => [e.code, e]));
  const parents = parentsOf(entries.map((e) => e.code));
  const kids = new Map<string | null, ClassEntry[]>();
  for (const e of entries) {
    const p = parents.get(e.code) ?? null;
    const list = kids.get(p);
    if (list) list.push(e);
    else kids.set(p, [e]);
  }
  return {
    info,
    ...(path !== undefined ? { path } : {}),
    flat,
    entries,
    byCode,
    children: (code) => kids.get(code) ?? [],
    parent: (code) => {
      const p = parents.get(code);
      return p ? byCode.get(p) ?? null : null;
    },
    title: (code) => byCode.get(code)?.title ?? null,
  };
}

/** A table read from a file: it is imported into a document with the path of that file. */
export interface ClassTableRef {
  path: string;
  system: ClassSystem;
}

/**
 * The file of a table with its codes replaced by `entries`: the root node and the codes of that table are rebuilt
 * (`buildSystem`) and the rest of the file (header, imports, other nodes) is kept. The information of the table
 * (id, edition…) is what the file already had.
 */
export function replaceTableEntries(prev: IfcxFile, info: ClassSystemInfo, entries: ClassEntryData[]): IfcxFile {
  const own = systemFromFile(prev)?.info ?? info;
  const fresh = buildSystem(own, entries);
  const key = tableKey(own.table);
  const keep = (prev.data ?? []).filter((n) => n.path !== own.id && n.attributes?.[K_CLASS_SYSTEM] === undefined && n.attributes?.[key] === undefined);
  return { ...prev, schemas: { ...(prev.schemas ?? {}), ...fresh.schemas }, data: [...fresh.data, ...keep] };
}
