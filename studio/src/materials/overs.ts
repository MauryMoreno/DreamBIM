// Editing materials as IFCX nodes: which attributes to write in the over layer of the document. Pure: it receives and
// returns lists of nodes without mutating them (a list equal to the received one = nothing to change).
import type { ComposeResult } from '../ifcx/compose';
import type { ComposedNode, IfcxNode } from '../ifcx/types';
import { clearAttr, setAttr, setInherit } from '../composer/edits';
import { defToAttrs, gltfFor, hexToRgb, K_DENSITY, K_DESCRIPTION, K_DIFFUSE, K_GLTF, K_MATERIAL, K_NAME, K_OPACITY } from './nodes';
import type { MaterialDef } from './state';

/** Clave de `inherits` con la que un elemento referencia su material. */
export const INHERIT_KEY = 'material';

/** Atributos de un material que el panel puede sobrescribir. */
export const OVERRIDABLE_KEYS: readonly string[] = [K_NAME, K_MATERIAL, K_DIFFUSE, K_OPACITY, K_DENSITY, K_DESCRIPTION, K_GLTF];

/** Reason why the definition is not valid, or null. */
export function checkDef(def: MaterialDef): string | null {
  if (!def.name || !def.code) return 'A material needs a name and a code';
  if (!/^#[0-9a-f]{6}$/i.test(def.color) || !(def.opacity >= 0 && def.opacity <= 1)) return 'Enter a valid color and opacity';
  const t = def.texture;
  if (t && !(t.width > 0 && Number.isFinite(t.width) && t.height > 0 && Number.isFinite(t.height))) {
    return 'The texture size must be a positive number of meters';
  }
  return null;
}

const sameTexture = (a: MaterialDef['texture'], b: MaterialDef['texture']) =>
  a === b || (!!a && !!b && a.image === b.image && a.width === b.width && a.height === b.height);

/** Atributos que cambian al pasar de `from` a `to`; `null` = quitar el atributo. */
export function defChanges(from: MaterialDef, to: MaterialDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (to.name !== from.name) out[K_NAME] = to.name;
  if (to.code !== from.code || (to.uri ?? '') !== (from.uri ?? '')) out[K_MATERIAL] = to.uri ? { code: to.code, uri: to.uri } : { code: to.code };
  if (to.color.toLowerCase() !== from.color.toLowerCase()) out[K_DIFFUSE] = hexToRgb(to.color);
  if (to.opacity !== from.opacity) out[K_OPACITY] = to.opacity;
  if (to.density !== from.density) out[K_DENSITY] = to.density ?? null;
  if ((to.description ?? '') !== (from.description ?? '')) out[K_DESCRIPTION] = to.description || null;
  // the gltf carries the opacity in its alpha; if the texture does not change it is not touched (it may bring more things that Studio does not edit)
  if (!sameTexture(from.texture, to.texture) || (to.texture && to.opacity !== from.opacity)) out[K_GLTF] = gltfFor(to);
  return out;
}

/** Escribe esos atributos en el nodo `path` de la lista. */
export function writeAttrs(list: IfcxNode[], path: string, attrs: Record<string, unknown>): IfcxNode[] {
  return Object.entries(attrs).reduce((acc, [k, v]) => setAttr(acc, path, k, v), list);
}

/** Removes those attributes from the node `path`; the same list if there were none. */
export function clearKeys(list: IfcxNode[], path: string, keys: readonly string[]): IfcxNode[] {
  return keys.reduce((acc, k) => clearAttr(acc, path, k), list);
}

/** Nodo nuevo de un material, con una ruta propia. */
export function newMaterialNode(def: MaterialDef): IfcxNode {
  return { path: crypto.randomUUID(), attributes: defToAttrs(def) };
}

/** How an element has its material today. */
export interface ElementMaterial {
  /** Path of the material node it inherits. */
  inherited: string | null;
  /** `code` de un `bsi::ifc::material` escrito en el propio elemento. */
  localCode: string | null;
}

export function elementMaterial(node: ComposedNode, result: ComposeResult): ElementMaterial {
  const inherited = result.provenance.inheritsOf(node.origin)[INHERIT_KEY] ?? null;
  const local = result.provenance.explain(node)[K_MATERIAL];
  const m = node.attributes[K_MATERIAL] as { code?: unknown } | undefined;
  return { inherited, localCode: local?.kind === 'local' && typeof m?.code === 'string' ? m.code : null };
}

/** Which material it is assigned to: a node (by reference) or only a code that no node defines. */
export type AssignTarget = { node: string | null; code: string; uri?: string };

/**
 * Asigna (o con `target` null quita) el material del elemento en `path`. Si el elemento trae su propio
 * `bsi::ifc::material`, it is overridden with that of the node so that it does not contradict what is inherited. If it is already so,
 * devuelve la misma lista.
 */
export function assignTo(list: IfcxNode[], path: string, target: AssignTarget | null, now: ElementMaterial): IfcxNode[] {
  let out = list;
  if (target === null) {
    if (now.inherited !== null) out = setInherit(out, path, INHERIT_KEY, null);
    if (now.localCode !== null) out = setAttr(out, path, K_MATERIAL, null);
    return out;
  }
  if (target.node !== null) {
    if (now.inherited !== target.node) out = setInherit(out, path, INHERIT_KEY, target.node);
    // the own attributes are applied after what is inherited: a `null` would also erase the inherited one,
    // so the own material is overridden with the code of the node
    if (now.localCode !== null && now.localCode !== target.code) out = setAttr(out, path, K_MATERIAL, materialValue(target));
    return out;
  }
  if (now.inherited === null && now.localCode === target.code) return out;
  if (now.inherited !== null) out = setInherit(out, path, INHERIT_KEY, null);
  return setAttr(out, path, K_MATERIAL, materialValue(target));
}

const materialValue = (t: AssignTarget) => (t.uri ? { code: t.code, uri: t.uri } : { code: t.code });
