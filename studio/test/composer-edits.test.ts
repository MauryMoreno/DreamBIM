import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import { localTransformFor, reparentTransform, translation, worldMatrix, worldOrigin, type Mat4 } from '../src/composer/xform';
import { clearAttr, clearVariant, editPath, freeName, insideOwnOrigin, marksOf, movePrefix, orphans, reparent, setAttr, setInherit, setVariant, setXform } from '../src/composer/edits';

const file = (data: IfcxNode[]): IfcxFile => ({
  header: { id: 't', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});

const xf = (m: Mat4) => ({ 'usd::xformop': { transform: m } });
const scaled = (s: number, t: [number, number, number]): Mat4 => [
  [s, 0, 0, 0], [0, s, 0, 0], [0, 0, s, 0], [t[0], t[1], t[2], 1],
];

/** Rotation `deg` about Z, scale (sx, sy, sz) and translation t, by rows (USD). */
const parentChild = (m: Mat4) =>
  file([
    { path: 'P', children: { c: 'C' }, attributes: xf(m) },
    { path: 'C', attributes: { 'bsi::ifc::prop::Name': 'child' } },
  ]);

describe('xform', () => {
  it('translation is row-major with the translation in the last row', () => {
    expect(translation([1, 2, 3])).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [1, 2, 3, 1]]);
  });

  it('worldMatrix multiplies the chain of parents; worldOrigin is its translation', () => {
    const r = compose([
      file([
        { path: 'A', children: { b: 'B' }, attributes: xf(translation([1, 0, 0])) },
        { path: 'B', children: { c: 'C' }, attributes: xf(scaled(2, [0, 5, 0])) },
        { path: 'C', attributes: xf(translation([1, 1, 1])) },
      ]),
    ]);
    const c = r.byPath.get('/A/b/c')!;
    expect(worldOrigin(c)).toEqual([3, 7, 2]);
    expect(worldMatrix(c).elements[0]).toBe(2);
  });

  it('localTransformFor compensates the parent', () => {
    const f = parentChild(translation([10, 0, 0]));
    const r = compose([f]);
    const node = r.byPath.get('/P/c')!;
    expect(worldOrigin(node)).toEqual([10, 0, 0]);
    const m = localTransformFor(node, [1, 2, 3]);
    expect(m[3]).toEqual([1, 2, 3, 1]);

    const edits = setXform([], editPath(node, r), m);
    const after = compose([f, file(edits)]).byPath.get('/P/c')!;
    expect(worldOrigin(after)).toEqual([11, 2, 3]);

    // con el padre escalado ×2 el cambio local es la mitad
    const s = compose([parentChild(scaled(2, [10, 0, 0]))]).byPath.get('/P/c')!;
    const ms = localTransformFor(s, [1, 2, 3]);
    ms[3].forEach((v, i) => expect(v).toBeCloseTo([0.5, 1, 1.5, 1][i], 12));
  });

  it('localTransformFor keeps the existing local transform of the node', () => {
    const r = compose([
      file([
        { path: 'P', children: { c: 'C' }, attributes: xf(translation([10, 0, 0])) },
        { path: 'C', attributes: xf(translation([0, 4, 0])) },
      ]),
    ]);
    const m = localTransformFor(r.byPath.get('/P/c')!, [1, 0, 0]);
    expect(m[3]).toEqual([1, 4, 0, 1]);
  });
});

describe('edits', () => {
  it('editPath: a single instance → origin; reused → parent/name', () => {
    const r = compose([
      file([
        { path: 'R', children: { a: 'A', b: 'B' } },
        { path: 'A', children: { door: 'D' } },
        { path: 'B', children: { door2: 'D' } },
        { path: 'D' },
        { path: 'S', children: { one: 'O' } },
        { path: 'O' },
      ]),
    ]);
    expect(editPath(r.byPath.get('/S/one')!, r)).toBe('O');
    expect(editPath(r.byPath.get('/R/a/door')!, r)).toBe('A/door');
    expect(editPath(r.byPath.get('/R/b/door2')!, r)).toBe('B/door2');
  });

  it('moving a reused element only moves that instance', () => {
    const f = file([
      { path: 'R', children: { a: 'A', b: 'B' } },
      { path: 'A', children: { door: 'D' } },
      { path: 'B', children: { door: 'D' } },
      { path: 'D' },
    ]);
    const r = compose([f]);
    const node = r.byPath.get('/R/a/door')!;
    const edits = setXform([], editPath(node, r), localTransformFor(node, [1, 0, 0]));
    const after = compose([f, file(edits)]);
    expect(worldOrigin(after.byPath.get('/R/a/door')!)).toEqual([1, 0, 0]);
    expect(worldOrigin(after.byPath.get('/R/b/door')!)).toEqual([0, 0, 0]);
  });

  it('setXform upserts without touching the input array', () => {
    const start: IfcxNode[] = [{ path: 'X', attributes: { k: 1 } }];
    const a = setXform(start, 'X', translation([1, 0, 0]));
    expect(start).toEqual([{ path: 'X', attributes: { k: 1 } }]);
    expect(a).toEqual([{ path: 'X', attributes: { k: 1, ...xf(translation([1, 0, 0])) } }]);
    const b = setXform(a, 'X', translation([2, 0, 0]));
    expect(b).toHaveLength(1);
    expect(b[0].attributes!['usd::xformop']).toEqual({ transform: translation([2, 0, 0]) });
    expect(setXform(b, 'Y', translation([0, 0, 1])).map((n) => n.path)).toEqual(['X', 'Y']);
  });

  it('setAttr and clearAttr: removing the last entry drops the empty node', () => {
    const a = setAttr([], 'X', 'bsi::ifc::prop::Name', 'Door');
    expect(a).toEqual([{ path: 'X', attributes: { 'bsi::ifc::prop::Name': 'Door' } }]);
    const b = setXform(a, 'X', translation([1, 0, 0]));
    const c = clearAttr(b, 'X', 'bsi::ifc::prop::Name');
    expect(c).toEqual([{ path: 'X', attributes: xf(translation([1, 0, 0])) }]);
    expect(clearAttr(c, 'X', 'usd::xformop')).toEqual([]);
    expect(clearAttr(c, 'nope', 'usd::xformop')).toBe(c);
    // the edit of the instance that no longer exists is indeed orphan
    const d: IfcxNode[] = [{ path: 'X', children: { a: null }, attributes: { k: 1 } }];
    expect(clearAttr(d, 'X', 'k')).toEqual([{ path: 'X', children: { a: null }, attributes: {} }]);
  });

  it('reparent: the old parent drops the child and the new one adds it', () => {
    const e = reparent([], { origin: 'W', name: 'w1' }, 'L1', 'L2');
    expect(e).toEqual([
      { path: 'L1', children: { w1: null } },
      { path: 'L2', children: { w1: 'W' } },
    ]);
  });

  it('reparent writes null on the old one and the reference on the new one', () => {
    const start: IfcxNode[] = [{ path: 'L1', attributes: { k: 1 } }];
    const e = reparent(start, { origin: 'W', name: 'w1' }, 'L1', 'L2', new Set(['x']));
    expect(start).toEqual([{ path: 'L1', attributes: { k: 1 } }]);
    expect(e).toEqual([
      { path: 'L1', attributes: { k: 1 }, children: { w1: null } },
      { path: 'L2', children: { w1: 'W' } },
    ]);
  });

  it('name clash → suffix -2', () => {
    expect(freeName('w', new Set(['a']))).toBe('w');
    expect(freeName('w', new Set(['w']))).toBe('w-2');
    expect(freeName('w', new Set(['w', 'w-2']))).toBe('w-3');
    const e = reparent([], { origin: 'W', name: 'w' }, 'L1', 'L2', new Set(['w']));
    expect(e).toEqual([
      { path: 'L1', children: { w: null } },
      { path: 'L2', children: { 'w-2': 'W' } },
    ]);
  });

  it('keeps world position', () => {
    const z = (v: number) => xf(translation([0, 0, v]));
    const f = file([
      { path: 'B', children: { l1: 'L1', l2: 'L2' } },
      { path: 'L1', children: { w: 'W' }, attributes: z(0) },
      { path: 'L2', attributes: z(3) },
      { path: 'W', attributes: xf(translation([4, 5, 0])) },
    ]);
    const r = compose([f]);
    const node = r.byPath.get('/B/l1/w')!;
    const to = r.byPath.get('/B/l2')!;
    const before = worldOrigin(node);
    let edits = reparent([], { origin: 'W', name: 'w' }, 'L1', 'L2', new Set());
    edits = setXform(edits, 'W', reparentTransform(node, to));
    const after = compose([f, file(edits)]);
    expect(after.byPath.has('/B/l1/w')).toBe(false);
    const moved = after.byPath.get('/B/l2/w')!;
    expect(moved.parent!.origin).toBe('L2');
    worldOrigin(moved).forEach((v, i) => expect(v).toBeCloseTo(before[i], 12));
    expect(before).toEqual([4, 5, 0]);
  });

  it('keeps the full world matrix with rotated and non-uniformly scaled parents', () => {
    /** it adds the inheritance without mutating the received list */
    const rzs = (deg: number, sc: [number, number, number], t: [number, number, number]): Mat4 => {
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return [[c * sc[0], s * sc[0], 0, 0], [-s * sc[1], c * sc[1], 0, 0], [0, 0, sc[2], 0], [...t, 1]];
    };
    const f = file([
      { path: 'B', children: { l1: 'L1', l2: 'L2' } },
      { path: 'L1', children: { w: 'W' }, attributes: xf(rzs(30, [1, 1, 1], [1, 2, 0])) },
      { path: 'L2', attributes: xf(rzs(90, [2, 1, 0.5], [0, 0, 3])) },
      { path: 'W', attributes: xf(rzs(15, [1, 3, 1], [4, 5, 0])) },
    ]);
    const r = compose([f]);
    const node = r.byPath.get('/B/l1/w')!;
    const before = worldMatrix(node).elements;
    let edits = reparent([], { origin: 'W', name: 'w' }, 'L1', 'L2');
    edits = setXform(edits, 'W', reparentTransform(node, r.byPath.get('/B/l2')!));
    const after = worldMatrix(compose([f, file(edits)]).byPath.get('/B/l2/w')!).elements;
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 9));
  });

  it('insideOwnOrigin: itself, its descendants and any other instance of its origin', () => {
    const r = compose([
      file([
        { path: 'R', children: { a: 'A', b: 'B' } },
        { path: 'A', children: { n: 'N' } },
        { path: 'B', children: { n: 'N' } },
        { path: 'N', children: { c: 'C' } },
        { path: 'C' },
      ]),
    ]);
    const n = r.byPath.get('/R/a/n')!;
    for (const p of ['/R/a/n', '/R/a/n/c', '/R/b/n', '/R/b/n/c']) expect(insideOwnOrigin(n, r.byPath.get(p)!)).toBe(true);
    for (const p of ['/R/a', '/R/b', '/R']) expect(insideOwnOrigin(n, r.byPath.get(p)!)).toBe(false);
  });

  it('movePrefix carries the per-instance edits of a node to its new path', () => {
    const e: IfcxNode[] = [
      { path: 'A/door', attributes: { k: 1 } },
      { path: 'A/door/knob', attributes: { k: 2 } },
      { path: 'A/doorway', attributes: { k: 3 } },
    ];
    expect(movePrefix(e, 'A/door', 'L2/door-2').map((n) => n.path)).toEqual(['L2/door-2', 'L2/door-2/knob', 'A/doorway']);
    expect(e[0].path).toBe('A/door');
  });

  it('the relocated mark of a reused element written per instance', () => {
    const base = file([
      { path: 'R', children: { a: 'A', b: 'B', l2: 'L2' } },
      { path: 'A', children: { door: 'D' } },
      { path: 'B', children: { door: 'D' } },
      { path: 'L2' },
      { path: 'D' },
    ]);
    let edits = reparent([], { origin: 'D', name: 'door' }, 'A', 'L2', new Set());
    edits = setXform(edits, 'L2/door', translation([1, 0, 0]));
    expect(marksOf(edits, base).get('D')).toEqual(['moved', 'relocated']);
    expect(orphans(edits, base)).toEqual([]);
    // Minimal DataTransfer: happy-dom does not create it in synthetic events.
    expect(orphans(setXform(edits, 'A/door', translation([0, 1, 0])), base)).toEqual(['A/door']);
  });

  it('marksOf detects moved, relocated and edited; orphans lists edits without a base node', () => {
    const base = file([
      { path: 'R', children: { a: 'A', b: 'B' } },
      { path: 'A', children: { door: 'D' } },
      { path: 'B', children: { door: 'D' } },
      { path: 'D' },
      { path: 'L1', children: { w: 'W' } },
      { path: 'L2' },
      { path: 'W' },
      { path: 'T', inherits: { t: 'A' } },
    ]);
    let edits = setXform([], 'A', translation([1, 0, 0]));
    edits = setAttr(edits, 'A', 'bsi::ifc::prop::Name', 'x');
    edits = setXform(edits, 'B/door', translation([0, 1, 0]));
    edits = reparent(edits, { origin: 'W', name: 'w' }, 'L1', 'L2');
    edits = setAttr(edits, 'T/door', 'k', 1); // hijo heredado de A
    edits = setXform(edits, 'gone', translation([0, 0, 1]));
    edits = setXform(edits, 'A/nope', translation([0, 0, 1]));
    const marks = marksOf(edits, base);
    expect(marks.get('A')).toEqual(['moved', 'edited']);
    expect(marks.get('D')).toEqual(['moved', 'edited']);
    expect(marks.get('W')).toEqual(['relocated']);
    expect(marks.has('gone')).toBe(false);
    expect(marks.has('L1')).toBe(false);
    expect(orphans(edits, base)).toEqual(['gone', 'A/nope']);
  });
});

describe('variant selection edits', () => {
  it('setVariant writes the selection; clearVariant removes it and drops the empty node', () => {
    const a = setVariant([], 'P/d1', 'tipo', 'doble');
    expect(a).toEqual([{ path: 'P/d1', variantSelection: { tipo: 'doble' } }]);
    const b = setAttr(a, 'P/d1', 'k', 1);
    expect(clearVariant(b, 'P/d1', 'tipo')).toEqual([{ path: 'P/d1', attributes: { k: 1 }, variantSelection: {} }]);
    expect(clearVariant(a, 'P/d1', 'tipo')).toEqual([]);
    expect(clearVariant(a, 'P/d1', 'nope')).toBe(a);
  });

  it('clearAttr keeps a node that still holds a variant selection', () => {
    const a = setAttr(setVariant([], 'X', 's', 'o'), 'X', 'k', 1);
    expect(clearAttr(a, 'X', 'k')).toEqual([{ path: 'X', variantSelection: { s: 'o' }, attributes: {} }]);
  });

  it('a variant selection marks the element as edited', () => {
    const base = file([
      { path: 'P', children: { d: 'door' } },
      { path: 'door', variants: { tipo: { a: 'A', b: 'B' } } },
      { path: 'A' }, { path: 'B' },
    ]);
    expect(marksOf(setVariant([], 'door', 'tipo', 'b'), base).get('door')).toEqual(['edited']);
  });
});

describe('setInherit', () => {
  it('edit layer: its own checkbox and count, without handle or ×', () => {
    const before: IfcxNode[] = [];
    expect(setInherit(before, 'W', 'material', 'M')).toEqual([{ path: 'W', inherits: { material: 'M' } }]);
    expect(before).toEqual([]);
  });

  it('conserva los atributos de la entrada y con null deja la herencia anulada', () => {
    const edits: IfcxNode[] = [{ path: 'W', attributes: { a: 1 }, inherits: { material: 'M' } }];
    expect(setInherit(edits, 'W', 'material', null)).toEqual([{ path: 'W', attributes: { a: 1 }, inherits: { material: null } }]);
  });
});
