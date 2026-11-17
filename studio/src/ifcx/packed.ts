// Packed meshes: points as a flat Float32Array (xyz) and indices/counts as a Uint32Array.
// This way they travel by transfer between threads and are built without copies or `.flat()`.
import type { IfcxFile } from './types';

const MESH = 'usd::usdgeom::mesh';

/**
 * Sustituye, en cada malla USD con `points` en forma de array, points/faceVertexIndices/faceVertexCounts
 * by typed arrays. It returns their buffers (to transfer them). Idempotent: what is already packed is not touched.
 */
export function packMeshes(file: IfcxFile): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [];
  for (const node of file.data) {
    const m = node.attributes?.[MESH] as Record<string, any> | undefined;
    if (!m || !Array.isArray(m.points)) continue;
    const pts = m.points as number[][];
    const flat = new Float32Array(pts.length * 3);
    for (let i = 0, o = 0; i < pts.length; i++) {
      const p = pts[i];
      flat[o++] = p[0]; flat[o++] = p[1]; flat[o++] = p[2];
    }
    m.points = flat;
    buffers.push(flat.buffer as ArrayBuffer);
    for (const key of ['faceVertexIndices', 'faceVertexCounts']) {
      const v = m[key];
      if (Array.isArray(v)) {
        const t = Uint32Array.from(v);
        m[key] = t;
        buffers.push(t.buffer as ArrayBuffer);
      }
    }
  }
  return buffers;
}

/** Number of vertices of a mesh, packed or not. */
export function meshVertexCount(m: unknown): number {
  const p = (m as { points?: ArrayLike<unknown> } | null | undefined)?.points;
  if (!p) return 0;
  return p instanceof Float32Array ? p.length / 3 : p.length;
}

/** Number of faces: the counts if they exist; otherwise, the indices divided by three. */
export function meshFaceCount(m: unknown): number {
  const o = m as { faceVertexCounts?: ArrayLike<unknown>; faceVertexIndices?: ArrayLike<unknown> } | null | undefined;
  if (o?.faceVertexCounts) return o.faceVertexCounts.length;
  return Math.floor((o?.faceVertexIndices?.length ?? 0) / 3);
}
