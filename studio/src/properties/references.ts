// Pure logic of the References group and of the provenance marks per attribute. No DOM.
import type { AttributeOrigin, ComposedNode, Provenance, ProvenanceSource } from '../ifcx/types';
import { linkUri, sameFile } from '../composer/uri';
import type { PropertyGroup, PropertyRow, RowAction, RowMark } from './groups';

export interface RefContext {
  provenance: Provenance;
  /** Open document: the paths are shown relative to it. */
  docPath: string | null;
  open?(path: string): void;
  copy?(text: string): void;
}

const NAME = 'bsi::ifc::prop::Name';
const MATERIAL = 'bsi::ifc::material';
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const head = (p: string) => p.split('/')[0];

/** Path relative to the document, without "./"; without a location, the name; a url, as it is. */
export function sourceLabel(s: ProvenanceSource, docPath: string | null): string {
  const loc = s.location;
  if (!loc) return s.name;
  if (URL_RE.test(loc) || !docPath) return loc;
  const rel = linkUri(docPath, loc);
  return rel.startsWith('./') ? rel.slice(2) : rel;
}

/**
 * Nombre del destino: su Name; si no, el code de bsi::ifc::material (solo si el destino no hereda: si
 * no, the material would be that of its inheritance); otherwise, the path.
 */
function targetName(attrs: Record<string, unknown>, target: string, inherits: boolean): string {
  const n = attrs[NAME];
  if (typeof n === 'string' && n) return n;
  const m = inherits ? undefined : attrs[MATERIAL];
  const code = m && typeof m === 'object' ? (m as { code?: unknown }).code : undefined;
  return typeof code === 'string' && code ? code : target;
}

/** Row of a resolved inheritance: name of the target and file where it is defined, with its actions. */
function refRow(label: string, key: string, indent: number, name: string, src: ProvenanceSource | undefined, ctx: RefContext): PropertyRow {
  if (!src) return { label, value: name, key, indent };
  const row: PropertyRow = { label, value: `${name} · ${sourceLabel(src, ctx.docPath)}`, key, indent, title: src.location ?? src.name };
  const loc = src.location;
  const { open, copy } = ctx;
  const actions: RowAction[] = [];
  if (loc && copy) actions.push({ label: 'Copy path', run: () => copy(loc) });
  // Open no tiene sentido sobre el propio documento
  if (loc && open && !URL_RE.test(loc) && !(ctx.docPath && sameFile(loc, ctx.docPath))) actions.push({ label: 'Open', run: () => open(loc) });
  if (actions.length) row.actions = actions;
  return row;
}

/** null si el nodo no tiene herencias y lo define un solo archivo. */
export function referencesGroup(node: ComposedNode, ctx: RefContext): PropertyGroup | null {
  const P = ctx.provenance;
  const rows: PropertyRow[] = [];
  // `chain` = rutas ya visitadas en esta rama (guarda de ciclo)
  const walk = (inherits: Record<string, string>, keys: string[], indent: number, chain: Set<string>) => {
    for (const [k, target] of Object.entries(inherits)) {
      if (chain.has(target)) continue;
      const ks = [...keys, k];
      const key = `ifcx::ref::${ks.join('/')}`;
      // attributesOf recomposes the subtree: a single call per row
      const attrs = P.attributesOf(target);
      if (!attrs) {
        rows.push({ label: k, value: `${target} · not found`, key, indent, missing: true });
        continue;
      }
      const own = P.inheritsOf(target);
      const name = targetName(attrs, target, Object.keys(own).length > 0);
      // the weakest source = where the card is defined
      rows.push(refRow(k, key, indent, name, P.sourcesOf(head(target))[0], ctx));
      walk(own, ks, indent + 1, new Set(chain).add(target));
    }
  };
  walk(P.inheritsOf(node.origin), [], 0, new Set([node.origin]));

  // the overlays of the sidecars (classification, materials) are not files of the model
  const defined = P.sourcesOf(node.origin).filter((s) => !s.layerId?.startsWith('overlay:'));
  if (defined.length > 1) {
    rows.push({
      label: 'Defined in',
      value: defined.map((s) => sourceLabel(s, ctx.docPath)).join(', '),
      key: 'ifcx::defined-in',
      title: defined.map((s) => s.location ?? s.name).join(', '),
    });
  }
  return rows.length ? { title: 'References', rows } : null;
}

function markOf(o: AttributeOrigin, docPath: string | null): RowMark | null {
  if (o.kind === 'inherited') return { kind: 'inherited', text: o.via.join(' › '), title: sourceLabel(o.source, docPath) };
  const ov = o.overrides;
  if (!ov) return null;
  const label = sourceLabel(ov.source, docPath);
  return { kind: 'overrides', text: `overrides ${ov.kind === 'inherited' ? ov.via.join(' › ') : label}`, title: label };
}

/** Mark per attribute key (only inherited ones and local ones that cover). */
export function attributeMarks(node: ComposedNode, ctx: RefContext): Map<string, RowMark> {
  const out = new Map<string, RowMark>();
  // explain puede omitir claves (variantes, borrados): sin entrada, sin marca
  for (const [key, o] of Object.entries(ctx.provenance.explain(node))) {
    const m = markOf(o, ctx.docPath);
    if (m) out.set(key, m);
  }
  return out;
}
