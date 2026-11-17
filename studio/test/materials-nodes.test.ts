// Materials as IFCX nodes: they are read from the composed model, with the file that defines them.
import { describe, expect, it } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { attrsToDef, defToAttrs, hexToRgb, K_GLTF, materialNodes, rgbToHex } from '../src/materials/nodes';

const M = '3468fdec-1163-5d95-8eab-6826478c56f2';
const CODE = 'Hormigón armado 28 MPa';
const GREEN = [0.2, 0.7, 0.3];

const file = (id: string, data: IfcxNode[]): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});

const lib = file('lib', [
  {
    path: M,
    attributes: {
      'bsi::ifc::material': { code: CODE, uri: '' },
      'bsi::ifc::presentation::diffuseColor': GREEN,
      'prj::material::densidad': 2500,
    },
  },
]);

const pile: IfcxNode = {
  path: 'P',
  inherits: { material: M },
  attributes: { 'bsi::ifc::class': { code: 'IfcPile' } },
};

const libSource = (location: string): ProvenanceSource => ({ role: 'import', name: 'lib', uri: '../lib.ifcx', location });
const docSource: ProvenanceSource = { role: 'layer', name: 'm', uri: null, layerId: 'base' };
const isDocument = (s: ProvenanceSource) => s.layerId === 'base';

describe('materialNodes', () => {
  it('lee el material de una biblioteca importada, con su archivo y su color', () => {
    const r = compose([lib, file('m', [pile])], { sources: [libSource('C:/b/lib.ifcx'), docSource] });
    const nodes = materialNodes(r, isDocument);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].path).toBe(M);
    expect(nodes[0].def.code).toBe(CODE);
    expect(nodes[0].def.color).toBe(rgbToHex(GREEN));
    expect(nodes[0].def.density).toBe(2500);
    expect(nodes[0].site).toBe('library');
    expect(nodes[0].source.location).toBe('C:/b/lib.ifcx');
  });

  it('un elemento con clase no es un material aunque herede el code', () => {
    const r = compose([lib, file('m', [{ ...pile, attributes: { ...pile.attributes, 'bsi::ifc::material': { code: CODE } } }])], {
      sources: [libSource('C:/b/lib.ifcx'), docSource],
    });
    expect(materialNodes(r, isDocument).map((n) => n.path)).toEqual([M]);
  });

  it('una biblioteca remota es de solo lectura', () => {
    const r = compose([lib, file('m', [pile])], { sources: [libSource('https://x.org/lib.ifcx'), docSource] });
    expect(materialNodes(r, isDocument)[0].site).toBe('readonly');
  });

  it('un material definido en el propio documento es del documento', () => {
    const r = compose([file('m', [...lib.data, pile])], { sources: [docSource] });
    expect(materialNodes(r, isDocument)[0].site).toBe('document');
  });

  it('an over of the document changes the color but the source is still the library', () => {
    const over: IfcxNode = { path: M, attributes: { 'bsi::ifc::presentation::diffuseColor': [1, 0, 0] } };
    const r = compose([lib, file('m', [pile, over])], { sources: [libSource('C:/b/lib.ifcx'), docSource] });
    const [n] = materialNodes(r, isDocument);
    expect(n.def.color).toBe(rgbToHex([1, 0, 0]));
    expect(n.source.location).toBe('C:/b/lib.ifcx');
    expect(n.site).toBe('library');
  });
});

describe('definition ↔ attributes', () => {
  it('defToAttrs writes only the standard attributes and attrsToDef reads them back', () => {
    const def = { name: CODE, code: CODE, color: rgbToHex(GREEN), opacity: 0.5, density: 2500 };
    const attrs = defToAttrs(def);
    expect(Object.keys(attrs).sort()).toEqual([
      'bsi::ifc::material',
      'bsi::ifc::presentation::diffuseColor',
      'bsi::ifc::presentation::opacity',
      'prj::material::densidad',
    ]);
    expect(attrsToDef(attrs)).toEqual(def);
  });

  it('sin densidad no se escribe la clave; sin color usa uno estable', () => {
    expect('prj::material::densidad' in defToAttrs({ name: 'A', code: 'A', color: '#000000', opacity: 1 })).toBe(false);
    const d = attrsToDef({ 'bsi::ifc::material': { code: 'A' } })!;
    expect(d.opacity).toBe(1);
    expect(d.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(attrsToDef({})).toBeNull();
  });

  it('hexToRgb y rgbToHex son inversos', () => {
    expect(rgbToHex(hexToRgb('#33b34d'))).toBe('#33b34d');
  });
});

describe('textura en gltf::material', () => {
  const IMG = 'data:image/jpeg;base64,AAAA';
  const base = { name: 'Brick', code: 'Brick', color: '#aa5533', opacity: 1 };

  it('a material with a texture writes gltf::material as the viewer expects it: without metallic shine and with the repeat per meter', () => {
    const attrs = defToAttrs({ ...base, texture: { image: IMG, width: 2, height: 0.5 } });
    expect(attrs[K_GLTF]).toEqual({
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85, baseColorTexture: IMG },
      doubleSided: true,
      extensions: { KHR_texture_transform: { scale: [0.5, 2] } },
    });
  });

  it('la opacidad del material va en el alfa del gltf', () => {
    const attrs = defToAttrs({ ...base, opacity: 0.4, texture: { image: IMG, width: 1, height: 1 } });
    expect((attrs[K_GLTF] as any).pbrMetallicRoughness.baseColorFactor).toEqual([1, 1, 1, 0.4]);
  });

  it('sin textura no se escribe gltf::material', () => {
    expect(K_GLTF in defToAttrs(base)).toBe(false);
  });

  it('ida y vuelta: lo que se escribe se lee igual', () => {
    const def = { ...base, texture: { image: IMG, width: 2, height: 0.5 } };
    expect(attrsToDef(defToAttrs(def))).toEqual(def);
  });

  it('it reads the color texture of a material that already has it (a baked library material) and its real size', () => {
    const d = attrsToDef({
      'bsi::ifc::material': { code: 'LADRILLO' },
      [K_GLTF]: {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9, baseColorTexture: IMG },
        normalTexture: { texture: 'data:image/jpeg;base64,BBBB', scale: 1 },
        extensions: { KHR_texture_transform: { scale: [0.25, 0.5] } },
      },
    })!;
    expect(d.texture).toEqual({ image: IMG, width: 4, height: 2 });
  });

  it('the size read from a rounded repeat is the true one: 0.416667 per meter is 2.4 m, not 2.399998', () => {
    const d = attrsToDef({
      'bsi::ifc::material': { code: 'H' },
      [K_GLTF]: { pbrMetallicRoughness: { baseColorTexture: IMG }, extensions: { KHR_texture_transform: { scale: [0.416667, 0.833333] } } },
    })!;
    expect(d.texture).toEqual({ image: IMG, width: 2.4, height: 1.2 });
  });

  it('a gltf without a color image, or with an impossible repeat, is not a usable texture', () => {
    expect(attrsToDef({ 'bsi::ifc::material': { code: 'A' }, [K_GLTF]: { pbrMetallicRoughness: {} } })!.texture).toBeUndefined();
    const d = attrsToDef({
      'bsi::ifc::material': { code: 'A' },
      [K_GLTF]: { pbrMetallicRoughness: { baseColorTexture: IMG }, extensions: { KHR_texture_transform: { scale: [0, -1] } } },
    })!;
    expect(d.texture).toEqual({ image: IMG, width: 1, height: 1 });
  });
});
