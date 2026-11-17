// Banco de carga: lee, parsea, compone y construye en Node los .ifcx dados (en orden de pila).
//
//   npm run bench -- ruta1.ifcx ruta2.ifcx ...
//   (con muchos nodos conviene: node --max-old-space-size=8000 node_modules/vite-node/vite-node.mjs scripts/bench-load.ts ...)
//
// Prints a read/parse/compose/build/bounds/batches table and the size of the model. build repeats what
// Viewer.build (buildObject + transformOf, sin escena ni GPU); bounds, las matrices y la Box3 de setModel;
// batches does, SceneBatches.rebuild of all the meshes (and the draw calls that result).

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { compose } from '../src/ifcx/compose';
import { parseIfcx } from '../src/ifcx/layers';
import type { ComposedNode } from '../src/ifcx/types';
import { SceneBatches } from '../src/render/batches';
import { buildObject, geometryKind, isInvisible, transformOf } from '../src/render/geometry';

const paths = process.argv.slice(2).filter((a) => a !== '--');
if (!paths.length) {
  console.error('uso: vite-node scripts/bench-load.ts a.ifcx [b.ifcx ...]  (en orden de pila)');
  process.exit(1);
}

const times: Record<string, number> = {};
function time<T>(name: string, fn: () => T): T {
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    times[name] = (times[name] ?? 0) + performance.now() - t0;
  }
}

const texts = time('read', () => paths.map((p) => readFileSync(p, 'utf8')));
const files = time('parse', () => texts.map((t) => parseIfcx(t)));
// the whole result stays alive so that the heap counts everything it retains
const composed = time('compose', () => compose(files));
const { root, warnings } = composed;
globalThis.gc?.();
console.log('heap MB', Math.round(process.memoryUsage().heapUsed / 2 ** 20));

const stats = { nodes: 0, meshes: 0 };
const geometries = new Set<THREE.BufferGeometry>();
const materials = new Set<THREE.Material>();
const modelRoot = new THREE.Group();
const meshes: THREE.Mesh[] = [];

function build(node: ComposedNode, parent: THREE.Object3D) {
  stats.nodes++;
  const a = node.attributes;
  if (isInvisible(a)) return;
  const kind = geometryKind(a);
  const obj = (kind && buildObject(node, kind)) || new THREE.Group();
  if (kind === 'mesh') {
    stats.meshes++;
    const m = obj as THREE.Mesh;
    meshes.push(m);
    geometries.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
  }
  const m = transformOf(a);
  if (m) {
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(m);
  }
  parent.add(obj);
  for (const c of node.children) build(c, obj);
}

time('build', () => {
  for (const c of root.children) build(c, modelRoot);
});
time('bounds', () => {
  modelRoot.updateMatrixWorld(true);
  new THREE.Box3().setFromObject(modelRoot);
});
// Same visibility as the viewer's isShown: layer 0 active and visible ancestors.
const isShown = (o: THREE.Object3D) => {
  if (!o.layers.isEnabled(0)) return false;
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (!c.visible) return false;
  return true;
};
const batches = new SceneBatches();
time('batches', () => batches.rebuild(meshes, isShown));

const fmt = (ms: number) => `${ms.toFixed(0)} ms`;
console.table(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, { ms: Math.round(v) }])));
console.log(
  `nodos ${stats.nodes}, mallas ${stats.meshes}, geometrías únicas ${geometries.size}, materiales ${materials.size}, avisos ${warnings.length}, rutas ${composed.byPath.size}, drawCalls ${batches.drawCalls} (lotes ${batches.root.children.length})`,
);
console.log(`total ${fmt(Object.values(times).reduce((a, b) => a + b, 0))}`);
