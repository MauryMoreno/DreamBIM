// Pure logic of the Properties panel: groups and formats the attributes of a node.
// Sin DOM, para poder probarla con nodos construidos a mano.
import type { ComposedNode, IfcxSchema } from '../ifcx/types';
import { meshFaceCount, meshVertexCount } from '../ifcx/packed';
import { unitFor } from '../ifcx/units';
import { classCode, displayName } from '../ifcx/names';
import { studioGroups, type StudioProps } from './studio';
import { attributeMarks, referencesGroup, type RefContext } from './references';

/** How a row is edited (only in editable documents); `commit` resolves false if it was rejected. */
export type RowEdit =
  | { kind: 'text'; commit(v: string): Promise<boolean> }
  | { kind: 'length'; commit(v: number): Promise<boolean> }
  | { kind: 'number'; commit(v: number): Promise<boolean> }
  | { kind: 'bool'; checked: boolean; commit(v: boolean): Promise<boolean> }
  | { kind: 'select'; options: { value: string; label: string }[]; selected: string; commit(v: string): Promise<boolean> };
/** Where an attribute comes from: inherited (key chain) or local covering another; `title` = file. */
export interface RowMark { kind: 'inherited' | 'overrides'; text: string; title: string }
export interface RowAction { label: 'Copy path' | 'Open'; run(): void }
/**
 * `reset` (solo filas editadas de un elemento enlazado) quita la sobrescritura. `mark`, `actions`,
 * `indent`, `missing` and `title` (tooltip) are only set by References and the provenance marks.
 */
export interface PropertyRow {
  label: string;
  value: string;
  key: string;
  edit?: RowEdit;
  reset?: () => Promise<boolean>;
  mark?: RowMark;
  actions?: RowAction[];
  indent?: number;
  missing?: boolean;
  title?: string;
}
export interface PropertyGroup { title: string; rows: PropertyRow[] }
export interface TypeHeader { family: string; type: string }

/** Attributes of a linked element in an editable document: they are overridden in its edit layer. */
export interface LinkedProps {
  /** Does the edit layer already override that key on this node? */
  edited(key: string): boolean;
  set(key: string, value: string | number | boolean): Promise<boolean>;
  reset(key: string): Promise<boolean>;
  /** Variant selection of the node, in the same edit layer. */
  variantEdited?(set: string): boolean;
  setVariant?(set: string, option: string): Promise<boolean>;
  resetVariant?(set: string): Promise<boolean>;
}

/** Loads or unloads the payload of that uri (session state, not file state). */
export type PayloadToggle = (uri: string, on: boolean) => Promise<boolean>;

export type SimpleValue = string | number | boolean;

const PROP_PREFIX = 'bsi::ifc::prop::';
const MAX_SUMMARY = 80;

/** Groups with their own title, in the order they are shown after "IFC Properties". */
const NAMED_GROUPS: [group: string, title: string][] = [
  ['bsi::ifc::presentation', 'Presentation'],
  ['bsi::ifc::system', 'Systems'],
  ['bsi::ifc-mat::prop', 'Material'],
  ['usd::usdgeom', 'Geometry'],
  ['usd', 'Transform'],
];

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const num = (x: number) => (Math.abs(x) < 1e-9 ? '0' : nf.format(x));
const count = (n: number) => String(n);

export function typeHeader(node: ComposedNode): TypeHeader {
  return { family: classCode(node) ?? 'Element', type: displayName(node) };
}

function splitKey(key: string): [group: string, label: string] {
  const i = key.lastIndexOf('::');
  return i < 0 ? ['', key] : [key.slice(0, i), key.slice(i + 2)];
}

function nearestStorey(node: ComposedNode): ComposedNode | null {
  for (let p = node.parent; p; p = p.parent) if (classCode(p) === 'IfcBuildingStorey') return p;
  return null;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > MAX_SUMMARY ? flat.slice(0, MAX_SUMMARY - 1) + '…' : flat;
}

function isRef(v: unknown): v is { ref: string } {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && typeof (v as { ref?: unknown }).ref === 'string' && Object.keys(v).length === 1;
}

/**
 * Can that attribute of a linked element be overridden? Only simple values (text, finite
 * number or boolean); the class and the usd::* and gltf::* attributes (geometry, transformation) cannot.
 */
export function linkedEditable(key: string, v: unknown): v is SimpleValue {
  if (key === 'bsi::ifc::class' || key.startsWith('usd::') || key.startsWith('gltf::')) return false;
  return typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

/** Number without thousands separator, so it can be read again with parseLength. */
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6, useGrouping: false });

/** Row of an overridable attribute: its field and, if already edited, Reset. */
function linkedRow(row: PropertyRow, v: SimpleValue, linked: LinkedProps): PropertyRow {
  const key = row.key;
  const out: PropertyRow =
    typeof v === 'string' ? { ...row, value: v, edit: { kind: 'text', commit: (x) => linked.set(key, x) } }
    : typeof v === 'number' ? { ...row, value: plain.format(v), edit: { kind: 'number', commit: (x) => linked.set(key, x) } }
    : { ...row, edit: { kind: 'bool', checked: v, commit: (x) => linked.set(key, x) } };
  if (linked.edited(key)) out.reset = () => linked.reset(key);
  return out;
}

function formatValue(key: string, v: unknown, unit: string | null): string {
  const o = (v ?? {}) as Record<string, unknown[] | undefined>;
  if (key === 'usd::usdgeom::mesh' && v && typeof v === 'object') {
    const verts = meshVertexCount(v);
    const faces = meshFaceCount(v);
    return `${count(verts)} vertices · ${count(faces)} faces`;
  }
  if (key === 'usd::usdgeom::basiscurves' && v && typeof v === 'object') return `${count(o.points?.length ?? 0)} points`;
  if (key === 'points::array' && v && typeof v === 'object') {
    return `${count(o.positions?.length ?? 0)} points${o.colors ? ' with color' : ''}`;
  }
  if (key === 'usd::xformop' && v && typeof v === 'object') {
    const t = (v as { transform?: unknown }).transform;
    if (Array.isArray(t) && Array.isArray(t[3]) && t[3].length >= 3) {
      return oneLine(`Translation ${t[3].slice(0, 3).map((c) => num(Number(c))).join(', ')}`);
    }
  }
  if (key === 'bsi::ifc::presentation::diffuseColor' && Array.isArray(v) && v.length >= 3 && v.every((c) => typeof c === 'number')) {
    return '#' + (v as number[]).slice(0, 3).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
  }
  return generic(v, unit);
}

function generic(v: unknown, unit: string | null): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return oneLine(unit ? `${num(v)} ${unit}` : num(v));
  if (typeof v === 'string') return oneLine(v);
  if (isRef(v)) return oneLine(v.ref);
  if (Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every((x) => typeof x === 'number')) {
    return oneLine((v as number[]).map(num).join(', ') + (unit ? ` ${unit}` : ''));
  }
  try {
    return oneLine(JSON.stringify(v) ?? String(v));
  } catch {
    return oneLine(String(v));
  }
}

/** A set of variants: its selection, which with `linked` is chosen in a dropdown. */
function variantRow(set: string, v: { options: string[]; selected: string | null }, linked?: LinkedProps): PropertyRow {
  const row: PropertyRow = { label: set, value: v.selected ?? '—', key: `ifcx::variant::${set}` };
  const { setVariant, resetVariant, variantEdited } = linked ?? {};
  if (!setVariant) return row;
  row.edit = {
    kind: 'select',
    options: v.options.map((o) => ({ value: o, label: o })),
    selected: v.selected ?? '',
    commit: (o) => setVariant(set, o),
  };
  if (resetVariant && variantEdited?.(set)) row.reset = () => resetVariant(set);
  return row;
}

function payloadRow(name: string, p: { uri: string; loaded: boolean }, toggle?: PayloadToggle): PropertyRow {
  const row: PropertyRow = { label: name, value: `${p.loaded ? 'Loaded' : 'Not loaded'} · ${p.uri}`, key: `ifcx::payload::${name}` };
  if (toggle) row.edit = { kind: 'bool', checked: p.loaded, commit: (on) => toggle(p.uri, on) };
  return row;
}

export function buildPropertyGroups(
  node: ComposedNode,
  schemas: Record<string, IfcxSchema>,
  studio?: StudioProps,
  linked?: LinkedProps,
  payloads?: PayloadToggle,
  refs?: RefContext,
): PropertyGroup[] {
  const out: PropertyGroup[] = [];
  // explain only once per build, and only with refs
  const marks = refs ? attributeMarks(node, refs) : null;
  const withMark = (row: PropertyRow, key: string): PropertyRow => {
    const mark = marks?.get(key);
    return mark ? { ...row, mark } : row;
  };
  const own = studio ? studioGroups(node, studio) : null;

  const storey = nearestStorey(node);
  if (own) out.push({ title: 'Constraints', rows: own.constraints });
  else if (storey) out.push({ title: 'Constraints', rows: [{ label: 'Level', value: displayName(storey), key: 'ifcx::level' }] });

  const cls = classCode(node);
  const identity: PropertyRow[] = [own?.name ?? { label: 'Name', value: displayName(node), key: 'ifcx::name' }];
  if (cls) identity.push(withMark({ label: 'IFC Class', value: cls, key: 'ifcx::class' }, 'bsi::ifc::class'));
  identity.push({ label: 'Identifier', value: node.origin, key: 'ifcx::origin' });
  out.push({ title: 'Identity Data', rows: identity });
  const references = refs ? referencesGroup(node, refs) : null;
  if (references) out.push(references);
  if (node.variantSets) {
    out.push({ title: 'Variants', rows: Object.entries(node.variantSets).map(([set, v]) => variantRow(set, v, linked)) });
  }
  if (node.payloads) {
    out.push({ title: 'Payloads', rows: Object.entries(node.payloads).map(([name, p]) => payloadRow(name, p, payloads)) });
  }

  const ifcProps: PropertyRow[] = [];
  const named = new Map<string, PropertyRow[]>(NAMED_GROUPS.map(([g]) => [g, []]));
  const others: PropertyRow[] = [];

  for (const [key, v] of Object.entries(node.attributes)) {
    if (key === 'bsi::ifc::class') continue; // ya se muestra como "Clase IFC"
    const value = formatValue(key, v, unitFor(key, schemas));
    const [g, label] = splitKey(key);
    const shown = { label: key.startsWith(PROP_PREFIX) || named.has(g) || !g ? label : key, value, key };
    const row = withMark(linked && linkedEditable(key, v) ? linkedRow(shown, v, linked) : shown, key);
    if (key.startsWith(PROP_PREFIX)) ifcProps.push(row);
    else if (named.has(g)) named.get(g)!.push(row);
    else others.push(row);
  }

  if (ifcProps.length) out.push({ title: 'IFC Properties', rows: ifcProps });
  for (const [g, title] of NAMED_GROUPS) {
    const rows = named.get(g)!;
    if (rows.length) out.push({ title, rows });
  }
  if (others.length) out.push({ title: 'Other', rows: others });
  return out;
}
