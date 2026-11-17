import type * as THREE from 'three';

/**
 * three.js does not expose the reserved vertex and index counts of a BatchedMesh (it does expose
 * maxInstanceCount). They live in the private `_maxVertexCount` and `_maxIndexCount` fields; this is
 * the only place that reads them, so a three.js upgrade fails here with a clear error instead of
 * silently shrinking the batch.
 */
interface BatchedMeshInternals {
  _maxVertexCount?: number;
  _maxIndexCount?: number;
}

function reserved(bm: THREE.BatchedMesh): { vertices: number; indices: number } {
  const raw = bm as unknown as BatchedMeshInternals;
  if (typeof raw._maxVertexCount !== 'number' || typeof raw._maxIndexCount !== 'number') {
    throw new Error('three.js BatchedMesh internals changed: _maxVertexCount and _maxIndexCount are missing');
  }
  return { vertices: raw._maxVertexCount, indices: raw._maxIndexCount };
}

/** Vertices the batch has reserved. */
export function maxVertexCount(bm: THREE.BatchedMesh): number {
  return reserved(bm).vertices;
}

/** Indices the batch has reserved. */
export function maxIndexCount(bm: THREE.BatchedMesh): number {
  return reserved(bm).indices;
}
