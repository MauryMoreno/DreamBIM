import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { explainElement } from '../src/assistant/studio/provenance';

const file = (data: IfcxNode[], id: string): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [], schemas: {}, data,
});
const L = (name: string, location: string): ProvenanceSource => ({ role: 'layer', name, uri: null, location });

const mat = file([{ path: 'mat', attributes: { 'bsi::ifc::prop::Name': 'Concrete', grade: 'C28' } }], 'mat');
const model = file([{ path: 'pile', inherits: { material: 'mat' }, attributes: { Depth: 12 } }], 'model');
const result = compose([mat, model], { sources: [L('mat', 'C:/p/lib/mat.ifcx'), L('model', 'C:/p/model.ifcx')] });
const pile = result.root.children.find((c) => c.name === 'pile')!;

describe('explainElement', () => {
  it('da las fuentes con ruta relativa al documento', () => {
    const e = explainElement(pile, result.provenance, 'C:/p/model.ifcx');
    expect(e.sources).toContain('model.ifcx');
  });

  it('gives the origin of each attribute: the local one and the inherited one with its route', () => {
    const e = explainElement(pile, result.provenance, 'C:/p/model.ifcx');
    expect(e.attributes.Depth).toEqual({ from: 'model.ifcx' });
    expect(e.attributes.grade).toEqual({ from: 'lib/mat.ifcx', via: ['material'] });
  });
});
