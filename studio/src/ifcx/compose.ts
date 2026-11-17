// IFCX composition engine.
//
// The same three phases as the buildingSMART reference implementation:
//   1. Federation: the nodes of all the layers are concatenated in order (the last one wins).
//   2. Flattening: a single pre-composition node per data path.
//   3. Composition: `inherits` and `children` are expanded recursively.
//
// Diferencias propias:
//   - classes (root paths) are composed only once and cloned when reused,
//   - each composed node remembers its `origin` (data path) to resolve references,
//   - errores de ciclo/referencia inexistente se informan como advertencias, no abortan,
//   - variants: the chosen option of each set is composed like one more inheritance; an instance
//     ("P/d1") puede elegir otra, y la anterior se deshace,
//   - payloads: el contenido de otro archivo se compone en el nodo solo si ese archivo se carga.

import type { ComposedNode, IfcxFile, IfcxSchema, ProvenanceSource } from './types';
import { WorkNode, ComposeOptions, ComposeResult } from './compose/types';
import { flatten, findRoots } from './compose/flatten';
import { Composer } from './compose/composer';
import { makeProvenance } from './compose/provenance';
export type { ComposeOptions, ComposeResult } from './compose/types';
export { flatten, findRoots, flattenAttributes } from './compose/flatten';

/** Composes an ordered set of layers (index 0 = weakest, last = strongest). */
export function compose(layers: IfcxFile[], opts: ComposeOptions = {}): ComposeResult {
  const payloads = opts.payloads ?? new Map<string, IfcxFile>();
  // the payloads go below all the layers, and their roots are not roots of the model
  const all = [...payloads.values(), ...layers];
  const schemas: Record<string, IfcxSchema> = {};
  for (const l of all) Object.assign(schemas, l.schemas ?? {});

  const payloadRoots = new Map<string, string[]>();
  for (const [uri, f] of payloads) payloadRoots.set(uri, findRoots(flatten([f])));
  if (payloads.size > 0) {
    const layerRoots = new Set(findRoots(flatten(layers)));
    for (const [uri, roots] of payloadRoots) payloadRoots.set(uri, roots.filter((r) => !layerRoots.has(r)));
  }
  const hidden = new Set([...payloadRoots.values()].flat());

  const definedIn = new Map<string, number[]>();
  const nodes = flatten(all, definedIn);
  const composer = new Composer(nodes, payloads, payloadRoots);
  const roots = findRoots(nodes).filter((r) => !hidden.has(r));

  const byOrigin = new Map<string, ComposedNode[]>();
  const byPath = new Map<string, ComposedNode>();

  const root: ComposedNode = {
    path: '', name: 'root', origin: '', attributes: {}, children: [], parent: null,
  };
  byPath.set('', root);

  const toComposed = (w: WorkNode, name: string, parent: ComposedNode): ComposedNode => {
    const path = `${parent.path}/${name}`;
    const n: ComposedNode = {
      path, name, origin: w.origin, attributes: Object.fromEntries(w.attributes), children: [], parent,
    };
    if (w.variants.size) {
      n.variantSets = {};
      for (const [k, v] of w.variants) n.variantSets[k] = { options: [...v.options.keys()], selected: v.selected };
    }
    if (w.payloads.size) {
      n.payloads = {};
      for (const [k, p] of w.payloads) n.payloads[k] = { ...p, loaded: w.loaded.has(k) };
    }
    byPath.set(path, n);
    const list = byOrigin.get(w.origin);
    if (list) list.push(n); else byOrigin.set(w.origin, [n]);
    for (const [cn, cw] of w.children) n.children.push(toComposed(cw, cn, n));
    return n;
  };

  for (const r of roots) {
    const w = composer.resolve(r);
    if (w) root.children.push(toComposed(w, r, root));
  }

  const layerSources = opts.sources?.length === layers.length
    ? opts.sources
    : layers.map((l, i): ProvenanceSource => ({ role: 'layer', name: l.header?.id || `layer ${i}`, uri: null }));
  const sources: ProvenanceSource[] = [
    ...[...payloads.keys()].map((uri): ProvenanceSource => ({ role: 'payload', name: uri, uri, location: uri })),
    ...layerSources,
  ];
  const provenance = makeProvenance(all, nodes, payloads, payloadRoots, definedIn, sources);

  return { root, schemas, warnings: composer.warnings, byOrigin, byPath, provenance };
}
