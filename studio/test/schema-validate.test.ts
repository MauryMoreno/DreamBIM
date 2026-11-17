// El visor de buildingSMART rechaza el archivo entero si un atributo no tiene esquema o su valor no
// it meets it. Studio opens it anyway, but it has to warn when loading.
import { describe, expect, it } from 'vitest';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import { parseIfcx } from '../src/ifcx/layers';
import { packMeshes } from '../src/ifcx/packed';
import { loadModel } from '../src/model/load';
import { BUNDLED_SCHEMAS } from '../src/model/schemas';
import { isSchemaWarning, schemaWarnings } from '../src/model/validate';

const file = (data: IfcxNode[], schemas: IfcxFile['schemas'] = {}): IfcxFile => ({
  header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'a', timestamp: 't' },
  imports: [],
  schemas,
  data,
});

const level = { 'x::level': { value: { dataType: 'Object' as const, objectRestrictions: { values: { elevation: { dataType: 'Real' as const } } } } } };

describe('schemaWarnings', () => {
  it('sin avisos si todo atributo tiene esquema y lo cumple', () => {
    expect(schemaWarnings([file([{ path: 'L', attributes: { 'x::level': { elevation: 3 } } }], level)])).toEqual([]);
  });

  it('an attribute without a schema: one warning per attribute, with how many nodes and an example', () => {
    const w = schemaWarnings([file([
      { path: 'A', attributes: { ifcx_level: { elevation: 0 } } },
      { path: 'B', attributes: { ifcx_level: { elevation: 3 } } },
    ])]);
    expect(w).toEqual(['Missing schema "ifcx_level" (2 nodes, e.g. "A")']);
    expect(w.every(isSchemaWarning)).toBe(true);
  });

  it('el esquema puede venir de otro archivo de la pila (un import)', () => {
    const imported = file([], level);
    expect(schemaWarnings([imported, file([{ path: 'L', attributes: { 'x::level': { elevation: 3 } } }])])).toEqual([]);
  });

  it('valores que no cumplen el esquema', () => {
    const schemas = {
      ...level,
      'x::name': { value: { dataType: 'String' as const } },
      'x::flag': { value: { dataType: 'Boolean' as const } },
      'x::rgb': { value: { dataType: 'Array' as const, arrayRestrictions: { value: { dataType: 'Real' as const } } } },
      'x::kind': { value: { dataType: 'Enum' as const, enumRestrictions: { options: ['a', 'b'] } } },
    };
    const w = schemaWarnings([file([
      { path: 'N', attributes: { 'x::level': {}, 'x::name': 3, 'x::flag': 'yes', 'x::rgb': [1, 'x'], 'x::kind': 'c' } },
    ], schemas)]);
    expect(w).toEqual([
      'Invalid "x::level" (1 node, e.g. "N"): missing key "elevation"',
      'Invalid "x::name" (1 node, e.g. "N"): expected String',
      'Invalid "x::flag" (1 node, e.g. "N"): expected Boolean',
      'Invalid "x::rgb" (1 node, e.g. "N"): [1]: expected Real',
      'Invalid "x::kind" (1 node, e.g. "N"): expected one of a, b',
    ]);
  });

  it('a packed mesh (typed arrays) satisfies the USD mesh schema', () => {
    const usd = parseIfcx(BUNDLED_SCHEMAS['https://ifcx.dev/@openusd.org/usd@v1.ifcx']);
    const f = file([{ path: 'm', attributes: { 'usd::usdgeom::mesh': { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faceVertexIndices: [0, 1, 2] } } }]);
    packMeshes(f);
    expect(schemaWarnings([usd, f])).toEqual([]);
  });

  it('a typed array does not satisfy an array of strings', () => {
    const names = { 'x::names': { value: { dataType: 'Array' as const, arrayRestrictions: { value: { dataType: 'String' as const } } } } };
    const f = file([{ path: 'n', attributes: { 'x::names': new Uint32Array([1, 2]) } }], names);
    expect(schemaWarnings([f])).toHaveLength(1);
  });

  it('loadModel incluye los avisos de esquema', async () => {
    const text = JSON.stringify(file([{ path: 'A', attributes: { ifcx_level: { elevation: 0 } } }]));
    const m = await loadModel('x', null, text, async () => file([]));
    expect(m.warnings).toContain('Missing schema "ifcx_level" (1 node, e.g. "A")');
  });
});
