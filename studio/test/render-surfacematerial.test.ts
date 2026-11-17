import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { surfaceMaterial } from '../src/render/geometry';
import type { ComposedNode } from '../src/ifcx/types';

const node = (attributes: Record<string, unknown>): ComposedNode =>
  ({ name: 'n', path: 'p', origin: 'o', attributes, children: [], parent: null }) as unknown as ComposedNode;
const gltf = (extra: Record<string, unknown> = {}) => ({
  pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 },
  ...extra,
});

describe('surfaceMaterial con gltf::material', () => {
  it('it keeps the diffuseColor of the same node for the color styles (shadeColor)', () => {
    const m = surfaceMaterial(node({ 'gltf::material': gltf(), 'bsi::ifc::presentation::diffuseColor': [0.2, 0.4, 0.8] }));
    expect(m.userData.shadeColor).toEqual([0.2, 0.4, 0.8]);
    expect((m as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff); // the texture is not tinted
  });

  it('dos materiales con el mismo glTF y distinto color no comparten material', () => {
    const a = surfaceMaterial(node({ 'gltf::material': gltf({ doubleSided: true }), 'bsi::ifc::presentation::diffuseColor': [0.1, 0.2, 0.3] }));
    const b = surfaceMaterial(node({ 'gltf::material': gltf({ doubleSided: true }), 'bsi::ifc::presentation::diffuseColor': [0.9, 0.2, 0.3] }));
    expect(a).not.toBe(b);
    expect(b.userData.shadeColor).toEqual([0.9, 0.2, 0.3]);
  });

  it('with a texture and extras.ifcxNoTile it reads without visible repetition; if either is missing, the normal three shader', () => {
    const tex = { normalTexture: { texture: 'data:image/png;base64,AA==' } };
    const extras = { extras: { ifcxNoTile: { step: [0.25, 0.25] } } };
    expect(surfaceMaterial(node({ 'gltf::material': gltf({ ...tex, ...extras }) })).customProgramCacheKey()).toBe('ifcx-notile');
    expect(surfaceMaterial(node({ 'gltf::material': gltf({ ...tex, alphaMode: 'MASK' }) })).customProgramCacheKey()).not.toBe('ifcx-notile');
    expect(surfaceMaterial(node({ 'gltf::material': gltf({ ...extras, doubleSided: false }) })).customProgramCacheKey()).not.toBe('ifcx-notile');
  });

  it('two materials equal except for the anti-repetition step do not share a material', () => {
    const tex = { normalTexture: { texture: 'data:image/png;base64,AB==' } };
    const a = surfaceMaterial(node({ 'gltf::material': gltf({ ...tex, extras: { ifcxNoTile: { step: [0.25, 0.25] } } }) }));
    const b = surfaceMaterial(node({ 'gltf::material': gltf({ ...tex, extras: { ifcxNoTile: { step: [0, 0] } } }) }));
    expect(a).not.toBe(b);
  });

  it('without diffuseColor there is no shadeColor (the color styles use the baseColorFactor)', () => {
    const m = surfaceMaterial(node({ 'gltf::material': gltf({ alphaMode: 'OPAQUE' }) }));
    expect(m.userData.shadeColor).toBeUndefined();
  });
});
