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
