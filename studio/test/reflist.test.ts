import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { ComposedNode, IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { referenceFiles, referencedBy } from '../src/composer/reflist';

const file = (data: IfcxNode[], id = 'f'): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});
const imp = (location: string): ProvenanceSource => ({ role: 'import', name: location, uri: location, location });
const layer = (name: string, location?: string, layerId?: string): ProvenanceSource => ({
  role: 'layer', name, uri: null, ...(location && { location }), ...(layerId && { layerId }),
});

const DOC = 'C:/p/model.ifcx';
const FICHA = 'C:/p/lib/ficha.ifcx';
const MAT = 'C:/p/lib/mat.ifcx';

// modelo -> ficha -> material; dos pilotes heredan de la ficha y una viga no hereda de nada
const mat = file([{ path: 'mat', attributes: { g: 'C28' } }], 'mat');
const ficha = file([{ path: 'ficha', inherits: { material: 'mat' }, attributes: { k: 1 } }], 'ficha');
const model = file([
  { path: 'pile1', inherits: { ficha: 'ficha' } },
  { path: 'pile2', inherits: { ficha: 'ficha' } },
  { path: 'beam', attributes: { d: 1 } },
], 'model');
const build = (extra: { f: IfcxFile; s: ProvenanceSource }[] = []) =>
  compose([mat, ficha, model, ...extra.map((e) => e.f)], {
    sources: [imp(MAT), imp(FICHA), layer('model', DOC, 'doc'), ...extra.map((e) => e.s)],
  });
const find = (r: ReturnType<typeof compose>, name: string): ComposedNode => r.root.children.find((c) => c.name === name)!;

describe('referenceFiles', () => {
  it('it goes from the strongest source to the weakest, with role and path relative to the document', () => {
    const rows = referenceFiles(build(), DOC);
    expect(rows.map((r) => [r.role, r.label])).toEqual([
      ['document', 'model.ifcx'],
      ['import', 'lib/ficha.ifcx'],
      ['import', 'lib/mat.ifcx'],
    ]);
    expect(rows[1]).toMatchObject({ name: 'ficha.ifcx', location: FICHA, title: FICHA });
  });

  it('it counts the elements that use each file, also by indirect inheritance', () => {
    const rows = referenceFiles(build(), DOC);
    expect(rows.map((r) => r.usedBy)).toEqual([0, 2, 2]);
  });

  it('it does not list the edit layers or the sidecar overlays, and they are still not "the document"', () => {
    const r = build([
      { f: file([{ path: 'beam', attributes: { c: 1 } }], 'ov'), s: layer('studio-classification/overlay', undefined, 'overlay:ov') },
    ]);
    const rows = referenceFiles(r, DOC);
    expect(rows.map((x) => x.role)).toEqual(['document', 'import', 'import']);
    const withEdits = compose([model, file([], 'e')], { sources: [layer('model', DOC, 'doc'), layer('model (edits)', undefined, 'L1:edits')] });
    expect(referenceFiles(withEdits, DOC).map((x) => x.name)).toEqual(['model.ifcx']);
  });

  it('a file linked with "+" is a layer and the document is the last real layer', () => {
    const r = compose([mat, model], { sources: [layer('mat', MAT, 'L1'), layer('model', DOC, 'doc')] });
    expect(referenceFiles(r, DOC).map((x) => x.role)).toEqual(['document', 'layer']);
  });

  it('an unsaved document (without a location) is named by the layer', () => {
    const r = compose([model], { sources: [layer('Untitled')] });
    const rows = referenceFiles(r, null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'document', name: 'Untitled', label: 'Untitled' });
    expect(rows[0].location).toBeUndefined();
  });

  it('two sources with the same location come out once', () => {
    const r = compose([model, model], { sources: [layer('base', DOC, 'base'), layer('model', DOC, 'doc')] });
    expect(referenceFiles(r, DOC)).toHaveLength(1);
  });

  it('una url se muestra tal cual', () => {
    const url = 'https://ifcx.dev/x/ifc@v5a.ifcx';
    const r = compose([mat, model], { sources: [imp(url), layer('model', DOC, 'doc')] });
    const row = referenceFiles(r, DOC).find((x) => x.role === 'import')!;
    expect(row).toMatchObject({ label: url, location: url, name: 'ifc@v5a.ifcx' });
  });

  it('herencias en ciclo terminan', () => {
    const cyc = file([{ path: 'a', inherits: { x: 'b' } }, { path: 'b', inherits: { x: 'a' } }, { path: 'i', inherits: { x: 'a' } }], 'cyc');
    const r = compose([cyc], { sources: [layer('cyc', DOC, 'doc')] });
    expect(() => referenceFiles(r, DOC)).not.toThrow();
    expect(() => referencedBy(r, find(r, 'i'))).not.toThrow();
  });

  it('a model without inheritances counts no use', () => {
    const r = compose([file([{ path: 'a', attributes: { x: 1 } }])], { sources: [layer('m', DOC, 'doc')] });
    expect(referenceFiles(r, DOC).map((x) => x.usedBy)).toEqual([0]);
  });
});

describe('referencedBy', () => {
  it('it gives the files the element reaches through its inheritances, without its own', () => {
    const r = build();
    expect([...referencedBy(r, find(r, 'pile1'))].sort()).toEqual([FICHA, MAT].sort());
  });

  it('un elemento sin herencias no referencia nada', () => {
    const r = build();
    expect(referencedBy(r, find(r, 'beam')).size).toBe(0);
  });

  it('it uses the same key as the rows (location, or the name if there is none)', () => {
    const r = build();
    const keys = new Set(referenceFiles(r, DOC).map((x) => x.key));
    for (const k of referencedBy(r, find(r, 'pile2'))) expect(keys.has(k)).toBe(true);
  });
});
