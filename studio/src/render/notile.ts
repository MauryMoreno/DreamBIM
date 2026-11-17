// Texture anti-repetition: a 1-2 m tile repeated identically on a 20 m wall shows the grid. Instead of
// reading the image as it is, each point blends two shifted reads of the tile (technique 3 of "texture
// repetition" by Inigo Quilez); a smooth noise, changing every ~3 tiles, decides which shifts and how
// much of each. It applies to colour and relief with the same shifts, so the image and its relief keep
// matching. Cost: two reads instead of one.
//
// An arbitrary shift blurs textures with pieces (bricks, tiles, formwork joints): the joints of the two
// reads do not match. That is why each material states its step, in fractions of the tile
// (`gltf::material.extras.ifcxNoTile.step`, written by the tool that bakes the material): shifts are
// rounded to multiples of that step and the joints keep lining up. 0 on an axis = free shift; 1 = none.
// Without a step, the texture is read as always.
import * as THREE from 'three';

const NO_TILE_GLSL = /* glsl */ `
uniform vec2 noTileStep;
float noTileHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noTileNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( noTileHash( i ), noTileHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( noTileHash( i + vec2( 0.0, 1.0 ) ), noTileHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
vec2 noTileOffset( float i ) {
  vec2 o = sin( vec2( 3.0, 7.0 ) * i ) * 2.0;
  // to multiples of the piece step, so the joints of the two reads match
  return mix( o, floor( o / max( noTileStep, 1e-6 ) + 0.5 ) * noTileStep, step( 1e-6, noTileStep ) );
}
vec4 noTileSample( sampler2D samp, vec2 uv ) {
  float l = noTileNoise( uv * 0.37 ) * 8.0;
  float ia = floor( l ), f = fract( l );
  vec2 offa = noTileOffset( ia );
  vec2 offb = noTileOffset( ia + 1.0 );
  // derivatives of the unshifted uv: the mip does not jump at the edge between shifts
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  vec4 a = textureGrad( samp, uv + offa, dx, dy );
  vec4 b = textureGrad( samp, uv + offb, dx, dy );
  return mix( a, b, smoothstep( 0.2, 0.8, f - 0.1 * dot( a - b, vec4( 1.0 ) ) ) );
}
`;

type Shader = { fragmentShader: string; uniforms: Record<string, { value: unknown }> };
export type NoTileStep = [number, number];

/** Anti-repetition step of a `gltf::material` (extras.ifcxNoTile.step), or null if it is not well formed. */
export function noTileStep(gltf: any): NoTileStep | null {
  const s = gltf?.extras?.ifcxNoTile?.step;
  if (!Array.isArray(s) || s.length !== 2) return null;
  if (!s.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  return [s[0], s[1]];
}

/** Replaces the colour and relief reads in the three shader with the anti-repetition ones. */
export function patchNoTile(shader: Shader, step: NoTileStep): void {
  const map = THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'noTileSample( map, vMapUv )');
  const normal = THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', 'noTileSample( normalMap, vNormalMapUv )');
  shader.uniforms.noTileStep = { value: new THREE.Vector2(step[0], step[1]) };
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + NO_TILE_GLSL)
    .replace('#include <map_fragment>', map)
    .replace('#include <normal_fragment_maps>', normal);
}

/** The material reads its textures without visible repetition; all share the program (the step is a uniform). */
export function applyNoTile(m: THREE.Material, step: NoTileStep): void {
  m.onBeforeCompile = (shader) => patchNoTile(shader as unknown as Shader, step);
  m.customProgramCacheKey = () => 'ifcx-notile';
}
