// Materials as IFCX nodes: `bsi::ifc::material` + presentation color and opacity. They are read from the
// composed model, with the file that defines each node (library, document or non-writable file).
import type { ComposeResult } from '../ifcx/compose';
import type { ProvenanceSource } from '../ifcx/types';
import { LAYER_COLORS } from '../composer/stack';
import type { MaterialDef, MaterialTexture } from './state';

export const K_MATERIAL = 'bsi::ifc::material';
export const K_DIFFUSE = 'bsi::ifc::presentation::diffuseColor';
export const K_OPACITY = 'bsi::ifc::presentation::opacity';
export const K_DENSITY = 'prj::material::densidad';
export const K_NAME = 'bsi::ifc::prop::Name';
export const K_DESCRIPTION = 'bsi::ifc::prop::Description';
/** Presentation material with textures, the one the viewer already paints. */
export const K_GLTF = 'gltf::material';
const K_CLASS = 'bsi::ifc::class';

/** Where the material can be written: local library, the document itself or nowhere. */
export type MaterialSite = 'library' | 'document' | 'readonly';

export interface MaterialNode {
  /** Ruta de datos del nodo (UUID). */
  path: string;
  def: MaterialDef;
  /** The weakest file that defines the node: where the material was born. */
  source: ProvenanceSource;
  site: MaterialSite;
}

const REMOTE = /^https?:\/\//i;

/** Color estable de un material sin color propio: uno de la paleta de capas. */
export function modelColor(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return LAYER_COLORS[h % LAYER_COLORS.length];
}

const hex2 = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');

/** `[r, g, b]` en 0–1 → '#rrggbb'. */
export const rgbToHex = (rgb: readonly number[]): string => '#' + rgb.slice(0, 3).map(hex2).join('');

/** '#rrggbb' → `[r, g, b]` en 0–1, con tres decimales (el archivo queda legible). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = (i: number) => Math.round((parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255) * 1000) / 1000;
  return [n(0), n(1), n(2)];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRgb = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((c) => typeof c === 'number');

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The color image of a `gltf::material` and the meters it covers; undefined if it has no image. */
function readTexture(g: unknown): MaterialTexture | undefined {
  if (!isObject(g)) return undefined;
  const pbr = g.pbrMetallicRoughness;
  const tex = isObject(pbr) ? pbr.baseColorTexture : undefined;
  const image = typeof tex === 'string' ? tex : isObject(tex) && typeof tex.texture === 'string' ? tex.texture : undefined;
  if (!image) return undefined;
  const ext = isObject(g.extensions) ? g.extensions.KHR_texture_transform : undefined;
  const scale = isObject(ext) && Array.isArray(ext.scale) ? ext.scale : [];
  // the repeat is stored with 6 decimals: when inverted, 1/10 of a millimeter is enough to recover the meters
  const size = (v: unknown) => (typeof v === 'number' && v > 0 && Number.isFinite(v) ? Math.round((1 / v) * 1e4) / 1e4 : 1);
  return { image, width: size(scale[0]), height: size(scale[1]) };
}

/**
 * `gltf::material` of a material with texture, as the viewer expects it: the untinted image, matte (the viewer
 * takes metal 1 if it is missing) and repeat per meter. The opacity goes in the alpha.
 */
export function gltfFor(def: MaterialDef): Record<string, unknown> | null {
  const t = def.texture;
  if (!t) return null;
  return {
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, def.opacity], metallicFactor: 0, roughnessFactor: 0.85, baseColorTexture: t.image },
    doubleSided: true,
    extensions: { KHR_texture_transform: { scale: [round6(1 / t.width), round6(1 / t.height)] } },
  };
}

/** Definition from the composed attributes of a node; null if it has no `bsi::ifc::material.code`. */
export function attrsToDef(attrs: Record<string, unknown>): MaterialDef | null {
  const m = attrs[K_MATERIAL];
  if (!isObject(m) || typeof m.code !== 'string') return null;
  const { code } = m;
  const name = attrs[K_NAME];
  const opacity = attrs[K_OPACITY];
  const density = attrs[K_DENSITY];
  const description = attrs[K_DESCRIPTION];
  const texture = readTexture(attrs[K_GLTF]);
  return {
    name: typeof name === 'string' && name ? name : code,
    code,
    color: isRgb(attrs[K_DIFFUSE]) ? rgbToHex(attrs[K_DIFFUSE]) : modelColor(code),
    opacity: typeof opacity === 'number' ? opacity : 1,
    ...(typeof description === 'string' && description ? { description } : {}),
    ...(typeof m.uri === 'string' && m.uri ? { uri: m.uri } : {}),
    ...(typeof density === 'number' ? { density } : {}),
    ...(texture ? { texture } : {}),
  };
}

/** Standard attributes of a material; only the keys with a value. */
export function defToAttrs(def: MaterialDef): Record<string, unknown> {
  return {
    [K_MATERIAL]: def.uri ? { code: def.code, uri: def.uri } : { code: def.code },
    ...(def.name !== def.code ? { [K_NAME]: def.name } : {}),
    ...(def.description ? { [K_DESCRIPTION]: def.description } : {}),
    [K_DIFFUSE]: hexToRgb(def.color),
    [K_OPACITY]: def.opacity,
    ...(def.density !== undefined ? { [K_DENSITY]: def.density } : {}),
    ...(def.texture ? { [K_GLTF]: gltfFor(def) } : {}),
  };
}

/**
 * Material nodes of the composed model: those that bring `bsi::ifc::material` and are not an element (without
 * `bsi::ifc::class`). A node that others inherit does not hang from the tree, that is why it is looked up in the provenance.
 * The first of each `code` wins. `isDocument`: is that source the document itself?
 */
export function materialNodes(result: ComposeResult, isDocument: (s: ProvenanceSource) => boolean): MaterialNode[] {
  const { provenance } = result;
  const out = new Map<string, MaterialNode>();
  for (const path of provenance.pathsWith(K_MATERIAL)) {
    if (provenance.hasOwn(path, K_CLASS)) continue;
    const attrs = provenance.attributesOf(path);
    const source = provenance.sourcesOf(path)[0];
    if (!attrs || !source || K_CLASS in attrs) continue;
    const def = attrsToDef(attrs);
    if (!def || out.has(def.code)) continue;
    const site: MaterialSite = isDocument(source)
      ? 'document'
      : source.role === 'import' && !REMOTE.test(source.location ?? source.uri ?? '')
        ? 'library'
        : 'readonly';
    out.set(def.code, { path, def, source, site });
  }
  return [...out.values()].sort((a, b) => a.def.name.localeCompare(b.def.name));
}
