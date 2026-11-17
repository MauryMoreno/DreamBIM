// Compares a generated IFCX with the official buildingSMART IFCX and validates its schema.
//
//   npx vite-node scripts/compare-ifcx.ts -- official.ifcx generated.ifcx [--json report.json]
//
// Criteria (per entity with bsi::ifc::class, paired by UUID):
//   - exists in both, same class and same parent (nearest classified entity)
//   - the official bsi::ifc::prop::* properties are present with the same value
//   - bounding box in world coordinates of its own geometry (tolerance 1 mm)
// Also: validation of the generated one with the schema validator of the reference.

import { readFileSync, writeFileSync } from 'node:fs';
import { compose } from '../src/ifcx/compose';
import type { ComposedNode, IfcxFile } from '../src/ifcx/types';
import { compose3 } from '../../References/IFC5-development-main/IFC5-development-main/src/viewer/compose-flattened';

type M = number[]; // 4x4 by rows, USD convention (row vector)
const I: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const mul = (a: M, b: M): M => {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
};
const apply = (p: number[], m: M) => [0, 1, 2].map(j => p[0] * m[j] + p[1] * m[4 + j] + p[2] * m[8 + j] + m[12 + j]);

interface Entity {
  node: ComposedNode;
  cls: string;
  parent: string | null;
  props: Record<string, unknown>;
  bbox: [number[], number[]] | null;
  triangles: number;
  key: string;
}

const clsOf = (n: ComposedNode) => (n.attributes['bsi::ifc::class'] as any)?.code as string | undefined;

// Algunos ejemplos oficiales (p.ej. Railway, de SierraSoft) usan el GlobalId IFC tal cual como path.
const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
const IS_GUID = /^[0-3][0-9A-Za-z_$]{21}$/;
function guidToUuid(g: string): string {
  let n = 0n;
  for (const c of g) n = n * 64n + BigInt(B64.indexOf(c));
  const h = n.toString(16).padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function entities(file: IfcxFile) {
  const { root, warnings } = compose([file]);
  const out = new Map<string, Entity>();
  const walk = (n: ComposedNode, world: M, owner: Entity | null) => {
    const t = (n.attributes['usd::xformop'] as any)?.transform as number[][] | undefined;
    const w = t ? mul(t.flat(), world) : world;
    let cur = owner;
    const guid = IS_GUID.test(n.origin);
    const cls = clsOf(n) ?? (guid ? '?' : undefined);
    const key = guid ? guidToUuid(n.origin) : n.origin;
    if (cls && !out.has(key)) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.attributes)) if (k.startsWith('bsi::ifc::prop::')) props[k.slice(16)] = v;
      cur = { node: n, cls, parent: owner ? owner.key : null, props, bbox: null, triangles: 0, key };
      out.set(key, cur);
    }
    const mesh = n.attributes['usd::usdgeom::mesh'] as any;
    const hidden = (n.attributes['usd::usdgeom::visibility'] as any)?.visibility === 'invisible';
    if (mesh?.points && cur && !hidden) {
      cur.triangles += (mesh.faceVertexIndices?.length ?? 0) / 3;
      for (const p of mesh.points as number[][]) {
        const q = apply(p, w);
        if (!cur.bbox) cur.bbox = [q.slice(), q.slice()];
        for (let i = 0; i < 3; i++) { cur.bbox[0][i] = Math.min(cur.bbox[0][i], q[i]); cur.bbox[1][i] = Math.max(cur.bbox[1][i], q[i]); }
      }
    }
    for (const c of n.children) walk(c, w, cur);
  };
  walk(root, I, null);
  return { entities: out, warnings };
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  if (typeof a === 'string' && typeof b === 'string') {
    // the official one sometimes stores quantities as "3 m"; we compare the number
    const na = parseFloat(a), nb = parseFloat(b);
    return a === b || (!isNaN(na) && na === nb);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Opens the file exactly as the official viewer does (layers, remote imports and validation). */
async function validate(file: IfcxFile): Promise<string> {
  try {
    await compose3([file as any]);
    return 'ok (opens in the reference viewer)';
  } catch (e) {
    return (e as Error).message.slice(0, 400);
  }
}

export async function compareFiles(officialPath: string, generatedPath: string) {
  const official = JSON.parse(readFileSync(officialPath, 'utf-8')) as IfcxFile;
  const generated = JSON.parse(readFileSync(generatedPath, 'utf-8')) as IfcxFile;
  const A = entities(official).entities;
  const B = entities(generated).entities;

  const missing: string[] = [], classDiff: string[] = [], parentDiff: string[] = [], propMissing: string[] = [],
    propDiff: string[] = [], geomDiff: string[] = [], geomMissing: string[] = [];
  const offsets: number[][] = [];
  let matched = 0, propsChecked = 0, geomChecked = 0;

  for (const [id, a] of A) {
    const b = B.get(id);
    if (!b) { missing.push(`${a.cls} ${a.node.name}`); continue; }
    matched++;
    if (a.cls !== '?' && a.cls !== b.cls) classDiff.push(`${a.node.name}: ${a.cls} → ${b.cls}`);
    if (a.parent !== b.parent && a.parent && A.has(a.parent)) parentDiff.push(`${a.node.name}: parent ${A.get(a.parent)!.node.name} → ${b.parent ? B.get(b.parent)?.node.name : '—'}`);
    for (const [k, v] of Object.entries(a.props)) {
      propsChecked++;
      if (!(k in b.props)) propMissing.push(`${a.node.name}.${k}`);
      else if (!same(v, b.props[k])) propDiff.push(`${a.node.name}.${k}: ${JSON.stringify(v)} → ${JSON.stringify(b.props[k])}`);
    }
    if (a.bbox) {
      geomChecked++;
      if (!b.bbox) geomMissing.push(`${a.cls} ${a.node.name}`);
      else {
        const d = Math.max(...[0, 1].flatMap(i => [0, 1, 2].map(j => Math.abs(a.bbox![i][j] - b.bbox![i][j]))));
        if (d > 1e-3) {
          geomDiff.push(`${a.cls} ${a.node.name}: off by ${d.toFixed(4)} m`);
          offsets.push([0, 1, 2].map(j => b.bbox![0][j] - a.bbox![0][j]).concat([0, 1, 2].map(j => b.bbox![1][j] - a.bbox![1][j])));
        }
      }
    }
  }
  const extra = [...B.keys()].filter(k => !A.has(k)).map(k => `${B.get(k)!.cls} ${B.get(k)!.node.name}`);
  const schema = await validate(generated);

  // are all the deviations the same translation? (e.g. the official one recentered coordinates by hand)
  let constantOffset: number[] | null = null;
  if (offsets.length && geomDiff.length === geomChecked - geomMissing.length) {
    const o = offsets[0];
    const rigid = o.slice(0, 3).every((v, j) => Math.abs(v - o[j + 3]) < 1e-3);
    if (rigid && offsets.every(x => x.every((v, j) => Math.abs(v - o[j]) < 1e-3))) constantOffset = o.slice(0, 3);
  }

  return {
    official: officialPath, generated: generatedPath,
    entities: { official: A.size, generated: B.size, matched, missing, extra },
    classDiff, parentDiff,
    props: { checked: propsChecked, missing: propMissing, different: propDiff },
    geometry: { checked: geomChecked, missing: geomMissing, different: geomDiff, constantOffset },
    schema,
  };
}

type Result = Awaited<ReturnType<typeof compareFiles>>;

export function summary(r: Result): string {
  const pct = (ok: number, total: number) => (total ? `${((ok / total) * 100).toFixed(1)}%` : '—');
  const lines = [
    `Entities:    ${r.entities.matched}/${r.entities.official} official ones found (${pct(r.entities.matched, r.entities.official)}), ${r.entities.extra.length} extra`,
    `Class:       ${r.classDiff.length} different · Parent: ${r.parentDiff.length} different`,
    `Properties:  ${r.props.checked - r.props.missing.length - r.props.different.length}/${r.props.checked} equal (${r.props.missing.length} missing, ${r.props.different.length} different)`,
    `Geometry:    ${r.geometry.checked - r.geometry.missing.length - r.geometry.different.length}/${r.geometry.checked} boxes match within ±1 mm (${r.geometry.missing.length} without geometry, ${r.geometry.different.length} off)`,
    `Schema:      ${r.schema}`,
  ];
  if (r.geometry.constantOffset) {
    lines.splice(4, 0, `             all shifted by the same translation (${r.geometry.constantOffset.map(v => v.toFixed(3)).join(', ')}) m: the shape matches`);
  }
  const show = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`  ${title}:`);
    items.slice(0, 6).forEach(i => lines.push(`    - ${i}`));
    if (items.length > 6) lines.push(`    … and ${items.length - 6} more`);
  };
  show('missing', r.entities.missing);
  show('extra', r.entities.extra);
  show('class', r.classDiff);
  show('parent', r.parentDiff);
  show('missing properties', r.props.missing);
  show('different properties', r.props.different);
  show('without geometry', r.geometry.missing);
  show('geometry off', r.geometry.different);
  return lines.join('\n');
}

// CLI
const args = process.argv.slice(2).filter(a => a !== '--');
if (args.length >= 2 && import.meta.url.includes('compare-ifcx')) {
  const jsonIdx = args.indexOf('--json');
  const r = await compareFiles(args[0], args[1]);
  console.log(summary(r));
  if (jsonIdx >= 0) writeFileSync(args[jsonIdx + 1], JSON.stringify(r, null, 2));
}
