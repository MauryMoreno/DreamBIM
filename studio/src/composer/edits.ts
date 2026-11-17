// Edit layer of a linked file: IFCx nodes that are composed right on top of its file.
// Funciones puras: nunca cambian la lista recibida, devuelven otra.
import { flatten, type ComposeResult } from '../ifcx/compose';
import type { ComposedNode, IfcxFile, IfcxNode } from '../ifcx/types';
import type { EditMark } from './stagepanel';
import type { Mat4 } from './xform';

export const K_XFORM = 'usd::xformop';

const head = (p: string) => p.split('/')[0];

/**
 * Edit path of the node: its origin if it is used only once; if it is reused, `parent/name`, which
 * only affects that instance (per-instance override, as in Revit).
 */
export function editPath(node: ComposedNode, result: ComposeResult): string {
  const uses = result.byOrigin.get(node.origin)?.length ?? 0;
  const parent = node.parent;
  return uses > 1 && parent?.origin ? `${parent.origin}/${node.name}` : node.origin;
}

/** Replaces (or appends) the node at `path` with what `change` returns; null removes it. */
function upsert(edits: IfcxNode[], path: string, change: (n: IfcxNode) => IfcxNode | null): IfcxNode[] {
  const i = edits.findIndex((n) => n.path === path);
  const next = change(i >= 0 ? edits[i] : { path });
  const out = [...edits];
  if (i >= 0) {
    if (next) out[i] = next;
    else out.splice(i, 1);
  } else if (next) out.push(next);
  return out;
}

export function setAttr(edits: IfcxNode[], path: string, key: string, value: unknown): IfcxNode[] {
  return upsert(edits, path, (n) => ({ ...n, attributes: { ...n.attributes, [key]: value } }));
}

/** Escribe `inherits[key] = target` en ese nodo (null anula la herencia que traiga el archivo). */
export function setInherit(edits: IfcxNode[], path: string, key: string, target: string | null): IfcxNode[] {
  return upsert(edits, path, (n) => ({ ...n, inherits: { ...n.inherits, [key]: target } }));
}

export function setXform(edits: IfcxNode[], path: string, m: Mat4): IfcxNode[] {
  return setAttr(edits, path, K_XFORM, { transform: m.map((r) => [...r]) });
}

/** Chooses the option `option` of the variant set `set` on that node. */
export function setVariant(edits: IfcxNode[], path: string, set: string, option: string): IfcxNode[] {
  return upsert(edits, path, (n) => ({ ...n, variantSelection: { ...n.variantSelection, [set]: option } }));
}

const isEmpty = (o: object | undefined) => !o || Object.keys(o).length === 0;
/** Does the edit node have nothing left? Then it is redundant. */
const blank = (n: IfcxNode) =>
  isEmpty(n.attributes) && isEmpty(n.children) && isEmpty(n.inherits) && isEmpty(n.variantSelection);

/** Deletes the entry; a node left empty disappears. Without that entry it returns the same list. */
export function clearAttr(edits: IfcxNode[], path: string, key: string): IfcxNode[] {
  const n = edits.find((x) => x.path === path);
  if (!n?.attributes || !(key in n.attributes)) return edits;
  return upsert(edits, path, (old) => {
    const { [key]: _gone, ...attributes } = old.attributes ?? {};
    const next: IfcxNode = { ...old, attributes };
    return blank(next) ? null : next;
  });
}

/** Removes the selection of `set` (that of the file comes back), like clearAttr. */
export function clearVariant(edits: IfcxNode[], path: string, set: string): IfcxNode[] {
  const n = edits.find((x) => x.path === path);
  if (!n?.variantSelection || !(set in n.variantSelection)) return edits;
  return upsert(edits, path, (old) => {
    const { [set]: _gone, ...variantSelection } = old.variantSelection ?? {};
    const next: IfcxNode = { ...old, variantSelection };
    return blank(next) ? null : next;
  });
}

/**
 * Is `target` inside `node`? It counts the node itself, its descendants and any other instance
 * of the same origin (or what hangs from it): relocating there would put the element inside itself.
 */
export function insideOwnOrigin(node: ComposedNode, target: ComposedNode): boolean {
  for (let a: ComposedNode | null = target; a; a = a.parent) if (a === node || a.origin === node.origin) return true;
  return false;
}

/** `name` if it is not in `taken`; otherwise, the first free `name-2`, `name-3`… */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}-${i}`)) i++;
  return `${name}-${i}`;
}

/**
 * Changes parent: the old one (`from`, edit path) releases the child (`null`) and the new one (`to`)
 * adds it with its origin. If the name is already among the children of the new one (`taken`), -2, -3… is appended.
 * (freeName con el mismo `taken` da el nombre resultante).
 */
export function reparent(
  edits: IfcxNode[], child: { origin: string; name: string }, from: string, to: string,
  taken: ReadonlySet<string> = new Set(),
): IfcxNode[] {
  const withChild = (name: string, ref: string | null) => (n: IfcxNode): IfcxNode => ({ ...n, children: { ...n.children, [name]: ref } });
  return upsert(upsert(edits, from, withChild(child.name, null)), to, withChild(freeName(child.name, taken), child.origin));
}

/** Moves the edits of the path `from` (and those below) to `to`, e.g. those of a relocated instance. */
export function movePrefix(edits: IfcxNode[], from: string, to: string): IfcxNode[] {
  if (from === to) return edits;
  return edits.map((n) =>
    n.path === from || n.path.startsWith(`${from}/`) ? { ...n, path: to + n.path.slice(from.length) } : n,
  );
}

// --- Lectura frente al archivo base ------------------------------------------------------

type Flat = ReturnType<typeof flatten>;
/** Maximum depth when following `inherits` (avoids cycles). */
const MAX_DEPTH = 32;

/** Referencia del hijo `name` del nodo de datos `path`, siguiendo sus `inherits`; null si no tiene. */
function childRef(flat: Flat, path: string, name: string, depth = 0): string | null {
  if (depth > MAX_DEPTH) return null;
  const f = flat.get(path);
  if (!f) return null;
  if (name in f.children) return f.children[name];
  for (const ref of Object.values(f.inherits)) {
    const r = childRef(flat, ref, name, depth + 1);
    if (r) return r;
  }
  return null;
}

/**
 * Origin of the node an edit path points to ("uuid" or "uuid/child/…"); null if it does not exist.
 * The root has to be in the file (`base`); the children are looked up with the edits applied
 * (`flat`), so a per-instance path of a relocated child ("newParent/child") does exist. A nested path
 * with its own data ("grandfather/parent") rules over the children of its reference, as when composing.
 */
function baseOrigin(base: Flat, flat: Flat, path: string): string | null {
  const [first, ...rest] = path.split('/');
  if (!base.has(first)) return null;
  let ref = first;
  let at = first;
  for (const name of rest) {
    const own = flat.get(at)?.children;
    const r = own && name in own ? own[name] : childRef(flat, ref, name);
    if (!r) return null;
    ref = r;
    at = `${at}/${name}`;
  }
  return head(ref);
}

/** The file with the edits on top (as it is composed). */
const withEdits = (file: IfcxFile, edits: IfcxNode[]): Flat => flatten([file, { ...file, data: edits }]);

const ORDER: EditMark[] = ['moved', 'relocated', 'edited'];

/** origin -> marks ('moved' position, 'relocated' parent changed, 'edited' properties). */
export function marksOf(edits: IfcxNode[], file: IfcxFile): Map<string, EditMark[]> {
  const base = flatten([file]);
  const flat = withEdits(file, edits);
  const found = new Map<string, Set<EditMark>>();
  const mark = (origin: string, m: EditMark) => {
    const s = found.get(origin) ?? new Set<EditMark>();
    s.add(m);
    found.set(origin, s);
  };
  for (const n of edits) {
    const origin = baseOrigin(base, flat, n.path);
    if (!origin) continue; // orphan
    for (const k of Object.keys(n.attributes ?? {})) mark(origin, k === K_XFORM ? 'moved' : 'edited');
    if (!isEmpty(n.variantSelection)) mark(origin, 'edited');
    for (const [name, ref] of Object.entries(n.children ?? {})) {
      // a child that goes back to its starting place does not count as relocated
      if (ref && childRef(base, n.path, name) !== ref) mark(head(ref), 'relocated');
    }
  }
  return new Map([...found].map(([o, s]) => [o, ORDER.filter((m) => s.has(m))]));
}

/** Edit paths whose node does not exist in the file (with the own edits applied). */
export function orphans(edits: IfcxNode[], file: IfcxFile): string[] {
  const base = flatten([file]);
  const flat = withEdits(file, edits);
  return edits.filter((n) => !baseOrigin(base, flat, n.path)).map((n) => n.path);
}
