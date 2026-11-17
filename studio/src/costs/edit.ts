// Edit an item or a heading line: it is written in the node of the code, in the IFCx file that defines it. Pure.
import type { IfcxFile, IfcxNode } from '../ifcx/types';
import type { CostCode, CostSystem, Measure, PriceOrigin } from './system';
import { CODE_VALUE_SCHEMAS } from '../classification/system';

/** What the dialog changes of a code (the code itself is not edited). */
export interface CodeEdit {
  name: string;
  /** Code of the heading line it hangs from; null = root. */
  parent: string | null;
  /** null = heading line. */
  medicion: { unit: string; measure: Measure } | null;
  /** Precio a mano; null = ninguno. */
  manualPrice: number | null;
  /** Which document the manual price came from; null = from none (it is cleared), without the key = it is not touched. */
  origin?: PriceOrigin | null;
}

export const SELF_PARENT = 'A code cannot hang from itself';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The origin as it is written in the file. */
const originAttr = (o: PriceOrigin) => ({ documento: o.doc, celda: o.cell });

/**
 * The file with the schemas of the code values its nodes use and it does not declare yet (a file written before
 * one of them existed, such as the origin, would otherwise load with a "Missing schema" warning).
 */
function withValueSchemas(file: IfcxFile): IfcxFile {
  const missing = Object.keys(CODE_VALUE_SCHEMAS).filter((k) => !file.schemas?.[k] && file.data.some((n) => n.attributes && k in n.attributes));
  if (missing.length === 0) return file;
  return { ...file, schemas: { ...file.schemas, ...Object.fromEntries(missing.map((k) => [k, CODE_VALUE_SCHEMAS[k]])) } };
}

/** Puts `value` in `key`, or removes the key if it is undefined. */
function put(attrs: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) delete attrs[key];
  else attrs[key] = value;
}

/** The code itself and everything that hangs from it. */
export function branch(system: CostSystem, code: string): Set<string> {
  const out = new Set<string>();
  const walk = (c: string) => {
    if (out.has(c)) return;
    out.add(c);
    for (const k of system.children(c)) walk(k.code);
  };
  walk(code);
  return out;
}

/**
 * Changes the node `path` of the file with what `edit` says. It returns the same file if nothing changes, or a text with the
 * reason if it cannot be done (the node is not in the file, or the parent would be the code itself or one of its descendants).
 * No modifica `file`.
 */
export function applyCodeEdit(file: IfcxFile, system: CostSystem, path: string, edit: CodeEdit): IfcxFile | string {
  const at = file.data.findIndex((n) => n.path === path);
  const code: CostCode | undefined = system.codes.find((c) => c.path === path);
  if (at < 0 || !code) return 'The cost item is not in this file';
  if (edit.parent !== null && branch(system, code.code).has(edit.parent)) return SELF_PARENT;

  const prev = file.data[at];
  const attrs: Record<string, unknown> = { ...prev.attributes };
  const head = isObject(attrs[system.attribute]) ? (attrs[system.attribute] as Record<string, unknown>) : {};
  attrs[system.attribute] = { ...head, name: edit.name, ...(edit.parent !== null ? { parent: edit.parent } : {}) };
  if (edit.parent === null) delete (attrs[system.attribute] as Record<string, unknown>).parent;
  const med = isObject(attrs['prj::medicion']) ? attrs['prj::medicion'] : {};
  put(attrs, 'prj::medicion', edit.medicion ? { ...med, unit: edit.medicion.unit, measure: edit.medicion.measure } : undefined);
  // la referencia a un APU de versiones anteriores ya no cuenta: se limpia al editar
  put(attrs, 'prj::referencia', undefined);
  put(attrs, 'prj::precio', edit.manualPrice ?? undefined);
  if ('origin' in edit) put(attrs, 'prj::origen', edit.origin ? originAttr(edit.origin) : undefined);

  if (JSON.stringify(attrs) === JSON.stringify(prev.attributes)) return file;
  const next: IfcxNode = { ...prev, attributes: attrs };
  return withValueSchemas({ ...file, data: file.data.map((n, i) => (i === at ? next : n)) });
}

/** Path of the node of a new code: `<system id>-<code>`, with whatever is not a letter, number or dot replaced by `-`. */
const codePath = (system: CostSystem, code: string): string => `${system.id}-${code.replace(/[^A-Za-z0-9.]+/g, '-')}`;

/** A code as the system editor leaves it: the same as `CodeEdit` plus the code. */
export interface SystemEntry extends CodeEdit {
  code: string;
}

/**
 * Writes the whole system as the editor leaves it: it changes the codes that remain, adds the new ones (with their path
 * `<system id>-<code>`) and removes those that are no longer there. It returns the same file if nothing changes, or a text with the
 * reason: empty or repeated code, or a parent that is not among the entries. It does not modify `file`.
 */
export function replaceSystemCodes(file: IfcxFile, system: CostSystem, entries: SystemEntry[]): IfcxFile | string {
  const codes = new Set<string>();
  for (const e of entries) {
    if (!e.code.trim()) return 'Enter a code';
    if (codes.has(e.code.trim())) return 'This code already exists';
    codes.add(e.code.trim());
  }
  if (entries.some((e) => e.parent !== null && !codes.has(e.parent))) return 'The heading does not exist';

  // those that are removed
  const gone = new Set(system.codes.filter((c) => !codes.has(c.code)).map((c) => c.path));
  let out: IfcxFile = gone.size ? { ...file, data: file.data.filter((n) => !gone.has(n.path)) } : file;
  // those that remain
  for (const e of entries) {
    const old = system.byCode.get(e.code.trim());
    if (!old) continue;
    const next = applyCodeEdit(out, system, old.path, {
      name: e.name.trim(), parent: e.parent, medicion: e.medicion, manualPrice: e.manualPrice,
      ...('origin' in e ? { origin: e.origin ?? null } : {}),
    });
    if (typeof next === 'string') return next;
    out = next;
  }
  // los nuevos, al final
  const added: IfcxNode[] = [];
  const taken = new Set(out.data.map((n) => n.path));
  for (const e of entries) {
    const code = e.code.trim();
    if (system.byCode.has(code)) continue;
    const base = codePath(system, code);
    let path = base;
    for (let i = 2; taken.has(path); i++) path = `${base}-${i}`;
    taken.add(path);
    added.push({
      path,
      attributes: {
        [system.attribute]: { code, name: e.name.trim(), ...(e.parent !== null ? { parent: e.parent } : {}) },
        ...(e.medicion ? { 'prj::medicion': { unit: e.medicion.unit, measure: e.medicion.measure } } : {}),
        ...(e.manualPrice !== null ? { 'prj::precio': e.manualPrice } : {}),
        ...(e.origin ? { 'prj::origen': originAttr(e.origin) } : {}),
      },
    });
  }
  const result = added.length ? { ...out, data: [...out.data, ...added] } : out;
  return result === file ? file : withValueSchemas(result);
}
