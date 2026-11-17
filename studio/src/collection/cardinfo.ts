// Data of a Collection card: the IFCx parameters of the root element of a card, the count of
// meshes and materials and the triangle cost of each level of detail. Pure: it touches neither the DOM nor the disk.
import type { IfcxFile } from '../ifcx/types';
import { parts, sep, stem } from '../library/librarypanel';

export interface LodInfo {
  level: number;
  triangles: number;
  /** Metros; 0 en el nivel 0. */
  error: number;
}

export interface CardInfo {
  path: string;
  name: string;
  ifcClass: string | null;
  reference: string | null;
  description: string | null;
  /** First folder under the root ('' if the card is in the root). */
  discipline: string;
  /** Folder that contains the card, relative to the root. */
  typeFolder: string;
  /** Metros. */
  dims: { width?: number; depth?: number; height?: number };
  /** Otros bsi::ifc::prop::*, con la clave sin prefijo. */
  extra: [string, string][];
  meshes: number;
  materials: number;
  /** Siempre empieza por el nivel 0. */
  lods: LodInfo[];
}

const PROP = 'bsi::ifc::prop::';
const MESH = 'usd::usdgeom::mesh';
const SHOWN = new Set(['Name', 'Reference', 'Description', 'Width', 'Depth', 'Height']);

const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Triangles of a USD mesh: with counts, each face of n vertices gives n-2; without them, indices / 3. */
function triangles(m: { faceVertexIndices?: ArrayLike<number>; faceVertexCounts?: ArrayLike<number> }): number {
  const counts = m.faceVertexCounts;
  if (counts) {
    let t = 0;
    for (let i = 0; i < counts.length; i++) t += Math.max(counts[i] - 2, 0);
    return t;
  }
  return Math.floor((m.faceVertexIndices?.length ?? 0) / 3);
}

export function cardInfo(file: IfcxFile, path: string, root: string): CardInfo {
  const rootAttrs = (file.data.find((n) => n.attributes?.['bsi::ifc::class'])?.attributes ?? {}) as Record<string, unknown>;
  const rel = parts(path).slice(parts(root).length);
  const file_ = rel.at(-1) ?? path;
  const dims: CardInfo['dims'] = {};
  const w = num(rootAttrs[PROP + 'Width']);
  const d = num(rootAttrs[PROP + 'Depth']);
  const h = num(rootAttrs[PROP + 'Height']);
  if (w !== undefined) dims.width = w;
  if (d !== undefined) dims.depth = d;
  if (h !== undefined) dims.height = h;

  const extra: [string, string][] = [];
  for (const [k, v] of Object.entries(rootAttrs)) {
    if (!k.startsWith(PROP) || v === undefined || v === null) continue;
    const key = k.slice(PROP.length);
    if (!SHOWN.has(key)) extra.push([key, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  }

  // per mesh: triangles and error of each level (0 = original)
  const perMesh: Map<number, { tris: number; error: number }>[] = [];
  const colors = new Set<string>();
  for (const n of file.data) {
    const a = n.attributes as Record<string, any> | undefined;
    if (!a?.[MESH]) continue;
    const levels = new Map([[0, { tris: triangles(a[MESH]), error: 0 }]]);
    const lods = a['studio::lod'];
    if (lods && typeof lods === 'object') {
      for (const [k, l] of Object.entries<any>(lods)) {
        if (Number.isInteger(Number(k)) && Number(k) !== 0 && Number.isFinite(l?.error)) {
          levels.set(Number(k), { tris: triangles(l), error: l.error });
        }
      }
    }
    perMesh.push(levels);
    if (a['bsi::ifc::presentation::diffuseColor']) colors.add(JSON.stringify(a['bsi::ifc::presentation::diffuseColor']));
  }

  const all = [...new Set(perMesh.flatMap((m) => [...m.keys()]))].sort((x, y) => x - y);
  const lods: LodInfo[] = all.map((level) => {
    let triangles = 0;
    let error = 0;
    for (const m of perMesh) {
      // a mesh without this level counts the nearest one towards the original that it does have (like the viewer): the
      // lower one for the simplified ones and the original for the refined one (-1)
      const own = m.get(level);
      const toward = [...m.keys()].filter((k) => (level > 0 ? k >= 0 && k < level : k <= 0 && k > level));
      const use = own ?? m.get(toward.sort((x, y) => Math.abs(y) - Math.abs(x))[0]);
      triangles += use?.tris ?? 0;
      if (own) error = Math.max(error, own.error);
    }
    return { level, triangles, error };
  });
  if (!lods.length) lods.push({ level: 0, triangles: 0, error: 0 });

  return {
    path,
    name: text(rootAttrs[PROP + 'Name']) ?? stem(file_),
    ifcClass: text((rootAttrs['bsi::ifc::class'] as { code?: unknown } | undefined)?.code),
    reference: text(rootAttrs[PROP + 'Reference']),
    description: text(rootAttrs[PROP + 'Description']),
    discipline: rel.length > 1 ? rel[0] : '',
    typeFolder: rel.slice(0, -1).join(sep(root)),
    dims,
    extra,
    meshes: perMesh.length,
    materials: colors.size,
    lods,
  };
}
