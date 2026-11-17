// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose } from '../src/ifcx/compose';
import { resolveStack, type Layer } from '../src/ifcx/layers';
import type { ComposedNode, IfcxFile, IfcxNode } from '../src/ifcx/types';
// Reference implementation of buildingSMART, used as an oracle.
import { LoadIfcxFile, Federate } from '../../References/IFC5-development-main/IFC5-development-main/src/ifcx-core/workflows';

const file = (data: IfcxNode[], id = 'f'): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});

const find = (n: ComposedNode, path: string) => {
  let cur: ComposedNode | undefined = n;
  for (const part of path.split('/').filter(Boolean)) cur = cur?.children.find(c => c.name === part);
  return cur;
};

describe('compose', () => {
  it('expande children y conserva el origin', () => {
    const r = compose([file([
      { path: 'a', children: { Body: 'b' } },
      { path: 'b', attributes: { x: 1 } },
    ])]);
    expect(r.root.children.map(c => c.name)).toEqual(['a']);
    const body = find(r.root, 'a/Body')!;
    expect(body.attributes).toEqual({ x: 1 });
    expect(body.origin).toBe('b');
    expect(r.byOrigin.get('b')![0].path).toBe('/a/Body');
  });

  it('inherits copia atributos e hijos, y lo local gana', () => {
    const r = compose([file([
      { path: 't', attributes: { color: 'red', h: 2 }, children: { Body: 'g' } },
      { path: 'g', attributes: { mesh: true } },
      { path: 'i', inherits: { type: 't' }, attributes: { color: 'blue' } },
    ])]);
    const i = find(r.root, 'i')!;
    expect(i.attributes).toEqual({ color: 'blue', h: 2 });
    expect(find(i, 'Body')!.attributes).toEqual({ mesh: true });
  });

  it('la capa posterior gana y null elimina', () => {
    const base = file([{ path: 'a', attributes: { p: 1, q: 2 }, children: { C: 'c' } }, { path: 'c' }], 'base');
    const over = file([{ path: 'a', attributes: { p: 9, q: null }, children: { C: null } }], 'over');
    const a = find(compose([base, over]).root, 'a')!;
    expect(a.attributes).toEqual({ p: 9 });
    expect(a.children).toHaveLength(0);
  });

  it('aplica sobrescrituras en rutas anidadas', () => {
    const r = compose([file([
      { path: 'a', children: { Body: 'b' } },
      { path: 'b', attributes: { v: 1 } },
      { path: 'a/Body', attributes: { v: 2 } },
    ])]);
    expect(find(r.root, 'a/Body')!.attributes).toEqual({ v: 2 });
    // la clase original no se contamina
    expect(r.byOrigin.get('b')!.length).toBe(1);
  });

  it('no se cuelga ante ciclos', () => {
    const r = compose([file([
      { path: 'r', children: { A: 'a' } },
      { path: 'a', children: { B: 'b' } },
      { path: 'b', children: { A: 'a' } },
    ])]);
    expect(r.warnings.some(w => w.includes('Cycle'))).toBe(true);
  });
});

describe('resolveStack', () => {
  it('ordena imports antes de la capa y tolera fallos', async () => {
    const lib = file([{ path: 'x' }], 'lib');
    const main: IfcxFile = { ...file([{ path: 'y' }], 'main'), imports: [{ uri: 'lib' }, { uri: 'missing' }] };
    const layers: Layer[] = [{ id: '1', name: 'main', file: main, enabled: true }];
    const res = await resolveStack(layers, async (u) => {
      if (u === 'lib') return lib;
      throw new Error('404');
    });
    expect(res.files.map(f => f.header.id)).toEqual(['lib', 'main']);
    expect(res.imports.find(i => i.uri === 'missing')!.ok).toBe(false);
  });
});

describe('resolveStack sources', () => {
  const lib = file([{ path: 'm', attributes: { x: 1 } }], 'lib');
  const doc = { ...file([{ path: 'a' }], 'doc'), imports: [{ uri: './lib.ifcx' }] };
  const layers: Layer[] = [{ id: 'L1', name: 'Doc', file: doc, enabled: true, location: 'C:/p/doc.ifcx' }];
  const fetcher = async () => lib;
  const locate = (uri: string, from?: string) => (from ? 'C:/p/lib.ifcx' : uri);

  it('va en paralelo a files: import antes que su capa', async () => {
    const r = await resolveStack(layers, fetcher, locate);
    expect(r.files).toEqual([lib, doc]);
    expect(r.sources).toEqual([
      { role: 'import', name: './lib.ifcx', uri: './lib.ifcx', location: 'C:/p/lib.ifcx' },
      { role: 'layer', name: 'Doc', uri: null, location: 'C:/p/doc.ifcx', layerId: 'L1' },
    ]);
  });

  it('an import that fails leaves no source; a disabled layer neither', async () => {
    const off: Layer = { id: 'L2', name: 'Off', file: file([], 'off'), enabled: false };
    const r = await resolveStack([...layers, off], async () => { throw new Error('x'); });
    expect(r.sources).toEqual([{ role: 'layer', name: 'Doc', uri: null, location: 'C:/p/doc.ifcx', layerId: 'L1' }]);
  });
});

describe('provenance', () => {
  const mat = file([{ path: 'mat', attributes: { 'bsi::ifc::prop::Name': 'Concrete', grade: 'C28' } }], 'mat');
  const ficha = file([{ path: 'ficha', inherits: { material: 'mat' }, attributes: { 'bsi::ifc::prop::Name': 'Pile 762', 'bsi::ifc::class': { code: 'IfcPile' } } }], 'ficha');
  const model = file([
    { path: 'pile', inherits: { ficha: 'ficha' }, attributes: { Depth: 12 } },
    { path: 'beam', attributes: { Depth: 1 } },
  ], 'model');
  const S = (name: string) => ({ role: 'layer' as const, name, uri: null });
  const r = compose([mat, ficha, model], { sources: [S('mat'), S('ficha'), S('model')] });

  it('inheritsOf returns the own inheritances of the node', () => {
    expect(r.provenance.inheritsOf('pile')).toEqual({ ficha: 'ficha' });
    expect(r.provenance.inheritsOf('beam')).toEqual({});
    expect(r.provenance.inheritsOf('nope')).toEqual({});
  });

  it('sourcesOf lists the sources that write the path, from weak to strong', () => {
    expect(r.provenance.sourcesOf('pile')).toEqual([S('model')]);
    const over = file([{ path: 'pile', attributes: { Depth: 13 } }], 'over');
    const r2 = compose([mat, ficha, model, over], { sources: [S('mat'), S('ficha'), S('model'), S('over')] });
    expect(r2.provenance.sourcesOf('pile')).toEqual([S('model'), S('over')]);
    expect(r2.provenance.sourcesOf('nope')).toEqual([]);
  });

  it('attributesOf compone una ruta de datos a demanda', () => {
    expect(r.provenance.attributesOf('ficha')).toEqual({
      'bsi::ifc::prop::Name': 'Pile 762', 'bsi::ifc::class': { code: 'IfcPile' }, grade: 'C28',
    });
    expect(r.provenance.attributesOf('nope')).toBeNull();
  });

  it('sin sources usa header.id (o "layer i")', () => {
    expect(compose([mat]).provenance.sources).toEqual([{ role: 'layer', name: 'mat', uri: null }]);
    expect(compose([file([], '')]).provenance.sources).toEqual([{ role: 'layer', name: 'layer 0', uri: null }]);
  });

  it('los payloads van primero', () => {
    const rp = compose([model], { payloads: new Map([['./p.ifcx', mat]]) });
    expect(rp.provenance.sources[0]).toEqual({ role: 'payload', name: './p.ifcx', uri: './p.ifcx', location: './p.ifcx' });
    expect(rp.provenance.sources[1]).toEqual({ role: 'layer', name: 'model', uri: null });
  });

  it('sources de otra longitud se ignoran', () => {
    const rs = compose([mat, ficha], { sources: [S('x')] });
    expect(rs.provenance.sources.map(s => s.name)).toEqual(['mat', 'ficha']);
  });

  it('el resultado no cambia', () => {
    const plain = compose([mat, ficha, model]);
    expect(r.root).toEqual(plain.root);
    expect(r.byPath).toEqual(plain.byPath);
    expect(r.warnings).toEqual(plain.warnings);
  });

  describe('explain', () => {
    const P = r.provenance;
    const pile = find(r.root, 'pile')!;
    const fichaO = { kind: 'inherited', via: ['ficha'], target: 'ficha', source: S('ficha') };
    // all the composed keys have an origin, and no more
    const invariant = (res: ReturnType<typeof compose>) => {
      const walk = (n: ComposedNode) => {
        expect(Object.keys(res.provenance.explain(n)).sort(), n.path).toEqual(Object.keys(n.attributes).sort());
        n.children.forEach(walk);
      };
      walk(res.root);
    };

    it('modelo -> ficha -> material', () => {
      const e = P.explain(pile);
      expect(e.Depth).toEqual({ kind: 'local', path: 'pile', source: S('model') });
      expect(e['bsi::ifc::class']).toEqual(fichaO);
      expect(e.grade).toEqual({ kind: 'inherited', via: ['ficha', 'material'], target: 'mat', source: S('mat') });
      expect(P.explain(r.root)).toEqual({});
      invariant(r);
    });

    it('local tapa a heredado', () => {
      const m = file([{ path: 'pile', inherits: { ficha: 'ficha' }, attributes: { 'bsi::ifc::class': { code: 'IfcSlab' } } }], 'model');
      const rr = compose([mat, ficha, m], { sources: [S('mat'), S('ficha'), S('model')] });
      const e = rr.provenance.explain(find(rr.root, 'pile')!);
      expect(e['bsi::ifc::class']).toEqual({ kind: 'local', path: 'pile', source: S('model'), overrides: fichaO });
      invariant(rr);
    });

    it('two inheritances write the same key: the last one wins', () => {
      const rr = compose([file([
        { path: 'x', inherits: { a: 'A', b: 'B' } },
        { path: 'A', attributes: { k: 1 } },
        { path: 'B', attributes: { k: 2 } },
      ])]);
      const e = rr.provenance.explain(find(rr.root, 'x')!);
      expect(e.k).toMatchObject({ kind: 'inherited', via: ['b'], target: 'B' });
      invariant(rr);
    });

    it('strongest source that writes the key', () => {
      const srcs = [S('mat'), S('ficha'), S('model'), S('over')];
      const r1 = compose([mat, ficha, model, file([{ path: 'pile', attributes: { Depth: 13 } }], 'over')], { sources: srcs });
      expect(r1.provenance.explain(find(r1.root, 'pile')!).Depth).toEqual({ kind: 'local', path: 'pile', source: S('over') });
      const r2 = compose([mat, ficha, model, file([{ path: 'pile', attributes: { Other: 1 } }], 'over')], { sources: srcs });
      const e2 = r2.provenance.explain(find(r2.root, 'pile')!);
      expect(e2.Depth).toEqual({ kind: 'local', path: 'pile', source: S('model') });
      expect(e2.Other).toEqual({ kind: 'local', path: 'pile', source: S('over') });
    });

    it('nodo anidado uuid/Body', () => {
      const f2 = file([{ path: 'ficha', children: { Body: 'g' } }, { path: 'g', attributes: { mesh: 1, color: 'red' } }], 'ficha');
      const m2 = file([
        { path: 'pile', inherits: { ficha: 'ficha' } },
        { path: 'pile/Body', attributes: { color: 'blue' } },
      ], 'model');
      const rr = compose([f2, m2], { sources: [S('ficha'), S('model')] });
      const e = rr.provenance.explain(find(rr.root, 'pile/Body')!);
      const g = { kind: 'inherited', via: ['ficha'], target: 'g', source: S('ficha') };
      expect(e.color).toEqual({ kind: 'local', path: 'pile/Body', source: S('model'), overrides: g });
      expect(e.mesh).toEqual(g);
      invariant(rr);
    });

    it('anidado profundo: herencias y hijos dentro de un hijo heredado', () => {
      const rr = compose([file([
        { path: 'ficha', children: { Body: 'g' } },
        { path: 'ficha/Body', attributes: { color: 'green' } },
        { path: 'g', attributes: { mesh: 1, color: 'red' }, children: { Sub: 'h' } },
        { path: 'h', attributes: { q: 1 } },
        { path: 'ex', attributes: { z: 1, mesh: 2 } },
        { path: 'x2', attributes: { w: 1 } },
        { path: 'pile', inherits: { ficha: 'ficha' } },
        { path: 'pile/Body', inherits: { extra: 'ex' }, children: { Extra: 'x2' } },
        { path: 'pile/Body/Sub', attributes: { q: 2 } },
        { path: 'pile/Body/Extra', attributes: { w: null, v: 3 } },
        { path: 'alias', inherits: { t: 'ficha/Body' } },
        { path: 'gone', inherits: { ficha: 'ficha' }, children: { Body: null } },
        { path: 'gone/Body', attributes: { lost: 1 } },
      ])]);
      const P2 = rr.provenance;
      const body = P2.explain(find(rr.root, 'pile/Body')!);
      expect(body.mesh).toMatchObject({ kind: 'inherited', via: ['extra'], target: 'ex' });
      expect(body.color).toMatchObject({ kind: 'inherited', via: ['ficha'], target: 'ficha/Body' });
      expect(body.z).toMatchObject({ kind: 'inherited', via: ['extra'], target: 'ex' });
      expect(P2.explain(find(rr.root, 'pile/Body/Sub')!).q).toMatchObject({ kind: 'local', path: 'pile/Body/Sub', overrides: { via: ['ficha'], target: 'h' } });
      expect(P2.explain(find(rr.root, 'pile/Body/Extra')!)).toEqual({ v: { kind: 'local', path: 'pile/Body/Extra', source: expect.anything() } });
      expect(P2.explain(find(rr.root, 'alias')!).color).toMatchObject({ via: ['t'], target: 'ficha/Body' });
      invariant(rr);
    });

    it('null borra', () => {
      const m = file([{ path: 'pile', inherits: { ficha: 'ficha' }, attributes: { grade: null } }], 'model');
      const rr = compose([mat, ficha, m]);
      expect('grade' in rr.provenance.explain(find(rr.root, 'pile')!)).toBe(false);
      invariant(rr);
    });

    it('a key that comes only from a variant has no entry', () => {
      const rr = compose([file([
        { path: 'w', attributes: { k: 0 }, variants: { set: { o1: 'opt' } } },
        { path: 'opt', attributes: { v: 1 } },
      ])]);
      const w = find(rr.root, 'w')!;
      expect(w.attributes.v).toBe(1);
      const e = rr.provenance.explain(w);
      expect('v' in e).toBe(false);
    });

    it('variants: explain empty (out of scope) so as not to give a false origin', () => {
      // (a) la variante elegida sobrescribe un atributo local
      const ra = compose([file([
        { path: 'w', attributes: { k: 0 }, variants: { set: { o1: 'opt' } } },
        { path: 'opt', attributes: { k: 1 } },
      ])]);
      const w = find(ra.root, 'w')!;
      expect(w.attributes.k).toBe(1);
      expect(ra.provenance.explain(w)).toEqual({});
      // (b) variante en la ficha, heredada por la instancia
      const rb = compose([file([
        { path: 'ficha', attributes: { k: 0 }, variants: { set: { o1: 'opt' } } },
        { path: 'opt', attributes: { k: 1 } },
        { path: 'inst', inherits: { ficha: 'ficha' }, attributes: { own: 1 } },
      ])]);
      expect(rb.provenance.explain(find(rb.root, 'inst')!)).toEqual({});
      // (c) variante en un antecesor que sustituye a un hijo
      const rc = compose([file([
        { path: 'p', children: { Body: 'g1' }, variants: { set: { o1: 'opt' } } },
        { path: 'g1', attributes: { m: 1 } },
        { path: 'opt', children: { Body: 'g2' } },
        { path: 'g2', attributes: { m: 2 } },
      ])]);
      const body = find(rc.root, 'p/Body')!;
      expect(body.attributes.m).toBe(2);
      expect(rc.provenance.explain(body)).toEqual({});
    });

    it('ciclos: termina', () => {
      const rr = compose([file([
        { path: 'c', inherits: { a: 'a' }, attributes: { own: 1 } },
        { path: 'a', inherits: { b: 'b' }, attributes: { fa: 1 } },
        { path: 'b', inherits: { a: 'a' }, attributes: { fb: 1 } },
      ])]);
      expect(() => rr.provenance.explain(find(rr.root, 'c')!)).not.toThrow();
      invariant(rr);
      const rc = compose([file([
        { path: 'r', children: { A: 'a' } },
        { path: 'a', children: { B: 'b' }, attributes: { x: 1 } },
        { path: 'b', children: { A: 'a' }, attributes: { y: 1 } },
      ])]);
      invariant(rc);
    });
  });
});

// --- Equivalence with the reference implementation on the official examples ---

type Ref = { children: Map<string, Ref>; attributes: Map<string, unknown> };

function compare(mine: ComposedNode, ref: Ref, path: string, errs: string[]) {
  if (errs.length > 5) return;
  const mk = mine.children.map(c => c.name).sort();
  const rk = [...ref.children.keys()].sort();
  if (JSON.stringify(mk) !== JSON.stringify(rk)) {
    errs.push(`${path}: hijos ${mk.join(',')} != ${rk.join(',')}`);
    return;
  }
  const ma = JSON.stringify(Object.keys(mine.attributes).sort().map(k => [k, mine.attributes[k]]));
  const ra = JSON.stringify([...ref.attributes.keys()].sort().map(k => [k, ref.attributes.get(k)]));
  if (ma !== ra) errs.push(`${path}: atributos distintos`);
  for (const c of mine.children) compare(c, ref.children.get(c.name)!, `${path}/${c.name}`, errs);
}

const EX_DIR = fileURLToPath(new URL('../../References/IFC5-development-main/IFC5-development-main/examples/', import.meta.url));
const examples = globSync('**/*.ifcx', { cwd: EX_DIR })
  .map(p => p.replace(/\\/g, '/'))
  // the heaviest models are tested separately (the reference takes too long with them)
  .filter(p => !/TeklaHouse|Hero Model|Railway_project_IFC5|Roadway/.test(p));

describe('equivalencia con la referencia', () => {
  it.each(examples)('%s', (p) => {
    const f = JSON.parse(readFileSync(join(EX_DIR, p), 'utf-8')) as IfcxFile;
    let ref: Ref;
    try {
      ref = LoadIfcxFile(Federate([f as any]), false, true) as unknown as Ref;
    } catch (e) {
      console.warn(`referencia falla con ${p}: ${(e as Error).message}`);
      return; // no oracle for this file
    }
    const mine = compose([f]);
    const errs: string[] = [];
    compare(mine.root, ref, '', errs);
    expect(errs).toEqual([]);
    // explain da origen a todas las claves compuestas (sin variantes ni payloads en estos ejemplos)
    if (!f.data.some(n => n.variants || n.payloads)) {
      const walk = (n: ComposedNode) => {
        const e = Object.keys(mine.provenance.explain(n)).sort();
        if (e.join('|') !== Object.keys(n.attributes).sort().join('|')) errs.push(`${n.path}: explain incompleto`);
        n.children.forEach(walk);
      };
      walk(mine.root);
      expect(errs).toEqual([]);
    }
  });
});

// Modelos grandes: solo con HEAVY=1 (tardan varios segundos en la referencia).
const heavy = globSync('**/*.ifcx', { cwd: EX_DIR })
  .map(p => p.replace(/\\/g, '/'))
  .filter(p => /TeklaHouse|Hero Model|Railway_project_IFC5|Roadway/.test(p));

describe.runIf(process.env.HEAVY)('equivalencia (modelos grandes)', () => {
  it.each(heavy)('%s', (p) => {
    const f = JSON.parse(readFileSync(join(EX_DIR, p), 'utf-8')) as IfcxFile;
    let t = performance.now();
    const mine = compose([f]);
    const tMine = performance.now() - t;
    t = performance.now();
    const ref = LoadIfcxFile(Federate([f as any]), false, true) as unknown as Ref;
    const tRef = performance.now() - t;
    console.log(`${p}: propio ${tMine.toFixed(0)} ms, referencia ${tRef.toFixed(0)} ms, nodos ${mine.byPath.size}`);
    const errs: string[] = [];
    compare(mine.root, ref, '', errs);
    expect(errs).toEqual([]);
  }, 120_000);
});
