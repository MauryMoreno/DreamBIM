import { describe, expect, it } from 'vitest';
import { readLegacySidecar } from '../src/materials/state';
import type { IfcxFile } from '../src/ifcx/types';

const file = (data: IfcxFile['data']): IfcxFile => ({
  header: { id: 'studio-materials/casa', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});

describe('readLegacySidecar', () => {
  it('it reads only the assignments (edit path → code) and discards the definitions and their colors', () => {
    const f = file([
      { path: 'studio-material-C30', attributes: { 'studio::material::def': { name: 'Concrete C30', code: 'C30', color: '#8a8a8a', opacity: 1, density: 2400 } } },
      { path: 'w1', attributes: { 'bsi::ifc::material': { code: 'C30' } } },
      { path: 'w2', attributes: { 'bsi::ifc::material': { code: 'GLASS', uri: 'urn:mat:glass' } } },
    ]);
    expect(readLegacySidecar(f)).toEqual({ w1: 'C30', w2: 'GLASS' });
  });

  it('salta lo que no entiende', () => {
    const f = file([
      { path: 'basura', attributes: { 'studio::material::def': 42 } },
      { path: 'sin-code', attributes: { 'bsi::ifc::material': { uri: 'x' } } },
      { path: 'otro', attributes: { 'bsi::ifc::prop::Name': 'x' } },
      { path: 'w1', attributes: { 'bsi::ifc::material': { code: 'C30' } } },
    ]);
    expect(readLegacySidecar(f)).toEqual({ w1: 'C30' });
  });

  it('un archivo sin datos no da asignaciones', () => {
    expect(readLegacySidecar(file([]))).toEqual({});
  });
});
