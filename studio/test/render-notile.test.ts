import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyNoTile, noTileStep, patchNoTile } from '../src/render/notile';

const shader = () => ({
  vertexShader: '',
  fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <normal_fragment_maps>\n}',
  uniforms: {} as Record<string, { value: unknown }>,
});

describe('texture anti-repetition', () => {
  it('it switches the sampling of color and relief to the one that breaks the repetition', () => {
    const s = shader();
    patchNoTile(s, [0.25, 0.5]);
    expect(s.fragmentShader).not.toContain('#include <map_fragment>');
    expect(s.fragmentShader).not.toContain('#include <normal_fragment_maps>');
    expect(s.fragmentShader).toContain('noTileSample( map, vMapUv )');
    expect(s.fragmentShader).toContain('noTileSample( normalMap, vNormalMapUv )');
    expect(s.fragmentShader).not.toMatch(/texture2D\( (map|normalMap), v(Map|NormalMap)Uv \)/);
    // the function is declared before main, after the common three utilities
    const decl = s.fragmentShader.indexOf('vec4 noTileSample(');
    expect(decl).toBeGreaterThan(s.fragmentShader.indexOf('#include <common>'));
    expect(decl).toBeLessThan(s.fragmentShader.indexOf('void main()'));
  });

  it('the step of the offsets goes in a uniform of the material (0 = free)', () => {
    const s = shader();
    patchNoTile(s, [0.25, 0]);
    expect(s.fragmentShader).toContain('uniform vec2 noTileStep;');
    expect((s.uniforms.noTileStep.value as THREE.Vector2).toArray()).toEqual([0.25, 0]);
  });

  it('materiales con distinto paso comparten programa, cada uno con su uniform', () => {
    const a = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const b = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    applyNoTile(a, [0.25, 0.25]);
    applyNoTile(b, [0, 0]);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).not.toBe(new THREE.MeshStandardMaterial().customProgramCacheKey());
    const sa = shader(), sb = shader();
    a.onBeforeCompile(sa as never, undefined as never);
    b.onBeforeCompile(sb as never, undefined as never);
    expect((sa.uniforms.noTileStep.value as THREE.Vector2).toArray()).toEqual([0.25, 0.25]);
    expect((sb.uniforms.noTileStep.value as THREE.Vector2).toArray()).toEqual([0, 0]);
  });

  it('noTileStep reads gltf.extras.ifcxNoTile.step; without it, or malformed, there is no anti-repetition', () => {
    expect(noTileStep({ extras: { ifcxNoTile: { step: [0.25, 0.5] } } })).toEqual([0.25, 0.5]);
    expect(noTileStep({})).toBeNull();
    expect(noTileStep({ extras: { ifcxNoTile: { step: [0.25] } } })).toBeNull();
    expect(noTileStep({ extras: { ifcxNoTile: { step: [-1, 0] } } })).toBeNull();
    expect(noTileStep({ extras: { ifcxNoTile: { step: ['a', 0] } } })).toBeNull();
  });
});
