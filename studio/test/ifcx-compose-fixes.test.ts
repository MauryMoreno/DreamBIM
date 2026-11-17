// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';

const file = (data: IfcxNode[], id = 'f'): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [], schemas: {}, data,
});

describe('variants', () => {
  it('an instance that selects another option keeps the attributes it writes itself', () => {
    const r = compose([file([
      { path: 'R', children: { d1: 'P' } },
      { path: 'P', variants: { size: { a: 'A', b: 'B' } } },
      { path: 'A', attributes: { color: 'fromA', onlyA: 1 } },
      { path: 'B', attributes: { other: 2 } },
      { path: 'R/d1', attributes: { color: 'instance' }, variantSelection: { size: 'b' } },
    ])]);
    expect(r.byPath.get('/R/d1')?.attributes).toEqual({ color: 'instance', other: 2 });
    expect(r.warnings).toEqual([]);
  });

  it('the selected option still wins over an attribute of the instance it also writes', () => {
    const r = compose([file([
      { path: 'R', children: { d1: 'P' } },
      { path: 'P', variants: { size: { a: 'A', b: 'B' } } },
      { path: 'A', attributes: { color: 'fromA' } },
      { path: 'B', attributes: { color: 'fromB' } },
      { path: 'R/d1', attributes: { color: 'instance' }, variantSelection: { size: 'b' } },
    ])]);
    expect(r.byPath.get('/R/d1')?.attributes).toEqual({ color: 'fromB' });
  });
});

describe('payloads', () => {
  it('a payload file that also writes the model root does not hide the model', () => {
    const model = file([
      { path: 'proj', children: { w: 'wall' } },
      { path: 'wall', payloads: { detail: { uri: './d.ifcx' } } },
    ]);
    const payload = file([
      { path: 'proj', attributes: { extra: 1 } },
      { path: 'det', attributes: { x: 1 } },
    ], 'p');
    const r = compose([model], { payloads: new Map([['./d.ifcx', payload]]) });
    expect(r.root.children.map((c) => c.path)).toEqual(['/proj']);
    expect(r.byPath.has('/proj/w/det')).toBe(true);
    expect(r.byPath.has('/proj/w/proj')).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe('provenance.hasOwn', () => {
  it('is true only for a key the data node writes itself with a value', () => {
    const r = compose([file([
      { path: 'a', inherits: { c: 'cls' }, attributes: { own: 1, gone: null } },
      { path: 'cls', attributes: { inherited: 2 } },
    ])]);
    expect(r.provenance.hasOwn('a', 'own')).toBe(true);
    expect(r.provenance.hasOwn('a', 'gone')).toBe(false);
    expect(r.provenance.hasOwn('a', 'inherited')).toBe(false);
    expect(r.provenance.hasOwn('missing', 'own')).toBe(false);
  });
});
