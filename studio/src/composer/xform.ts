// Transformations of the composed nodes (translation, rotation and scale). Pure: no DOM.
// USD matrices (`usd::xformop.transform`) go by rows with the translation in the last row; read
// in order with Matrix4.fromArray (by columns) they give the same matrix three.js uses, so
// `elements` de three.js coincide con las filas USD aplanadas.
import * as THREE from 'three';
import type { ComposedNode } from '../ifcx/types';
import { transformOf } from '../render/geometry';

export type Vec3 = [number, number, number];
/** 4×4 by rows, translation in the last row (usd::xformop format). */
export type Mat4 = number[][];

/** Local transformation of the node (the identity if it has no xformop). */
const localMatrix = (node: ComposedNode): THREE.Matrix4 => transformOf(node.attributes) ?? new THREE.Matrix4();

/** Product of the transformations of the parent chain (from the root to the node, included). */
export function worldMatrix(node: ComposedNode): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  for (let n: ComposedNode | null = node; n; n = n.parent) m.premultiply(localMatrix(n));
  return m;
}

/** Origen local del elemento en el mundo. */
export function worldOrigin(node: ComposedNode): Vec3 {
  const e = worldMatrix(node).elements;
  return [e[12], e[13], e[14]];
}

/** Matriz three.js → filas USD. */
function toRows(m: THREE.Matrix4): Mat4 {
  const e = m.elements;
  return [0, 1, 2, 3].map((r) => e.slice(r * 4, r * 4 + 4));
}

export function translation(v: Vec3): Mat4 {
  return toRows(new THREE.Matrix4().makeTranslation(v[0], v[1], v[2]));
}

/**
 * New xformop of the node to move it `delta` in the world, compensating for its parents:
 * L' = P⁻¹ · T(delta) · P · L, con P la matriz del mundo del padre y L la local actual.
 */
export function localTransformFor(node: ComposedNode, delta: Vec3): Mat4 {
  const parent = node.parent ? worldMatrix(node.parent) : new THREE.Matrix4();
  const m = parent.clone().invert()
    .multiply(new THREE.Matrix4().makeTranslation(delta[0], delta[1], delta[2]))
    .multiply(parent)
    .multiply(localMatrix(node));
  return toRows(m);
}

/**
 * xformop of the node under `newParent` that leaves it where it is in the world: L' = Q⁻¹ · W, with Q the
 * matriz del mundo del padre nuevo y W la del nodo ahora (padre viejo × local).
 */
export function reparentTransform(node: ComposedNode, newParent: ComposedNode): Mat4 {
  return toRows(worldMatrix(newParent).invert().multiply(worldMatrix(node)));
}

// --- Rotation and scale -------------------------------------------------------------------
// Ángulos en grados, Euler XYZ (el orden de three.js); la escala es un factor por eje.

const RAD = Math.PI / 180;

/** Grados en (-180, 180], sin -0. */
export const normDeg = (d: number): number => {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  const v = r === -180 ? 180 : r;
  return Math.abs(v) < 1e-9 ? 0 : v;
};

/** Matriz (filas USD) que coloca en `t`, gira `rot` grados y escala `scale`: T · R · S. */
export function composeRows(t: Vec3, rot: Vec3, scale: Vec3): Mat4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, 'XYZ'));
  return toRows(new THREE.Matrix4().compose(new THREE.Vector3(...t), q, new THREE.Vector3(...scale)));
}

/** Position, rotation (degrees) and scale of a three.js matrix. */
function decompose(m: THREE.Matrix4): { t: Vec3; rot: Vec3; scale: Vec3 } {
  const t = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(t, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const r = (v: number) => normDeg(v / RAD);
  return { t: [t.x, t.y, t.z], rot: [r(e.x), r(e.y), r(e.z)], scale: [s.x, s.y, s.z] };
}

/** Giro (grados) y escala del elemento en el mundo. */
export function worldRotScale(node: ComposedNode): { rot: Vec3; scale: Vec3 } {
  const { rot, scale } = decompose(worldMatrix(node));
  return { rot, scale };
}

/**
 * New xformop of the node so that in the world it ends up with that rotation and scale, without moving its
 * origen: W' = T · R · S (T, el origen actual) y L' = P⁻¹ · W', con P la matriz del mundo del padre.
 */
export function localTransformWith(node: ComposedNode, rs: { rot?: Vec3; scale?: Vec3 }): Mat4 {
  const now = decompose(worldMatrix(node));
  const w = composeRows(now.t, rs.rot ?? now.rot, rs.scale ?? now.scale).flat();
  const parent = node.parent ? worldMatrix(node.parent) : new THREE.Matrix4();
  return toRows(parent.invert().multiply(new THREE.Matrix4().fromArray(w)));
}

/** Is `m` (almost) the local transformation those attributes give (the identity without xformop)? */
export function sameLocal(attributes: Record<string, unknown>, m: Mat4, eps = 1e-9): boolean {
  const e = (transformOf(attributes) ?? new THREE.Matrix4()).elements;
  return m.flat().every((v, i) => Math.abs(v - e[i]) <= eps);
}
