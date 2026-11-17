// Conversion of IFCX attributes (USD / point clouds / glTF) to Three.js objects.

import * as THREE from 'three';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import type { ComposedNode } from '../ifcx/types';
import { applyNoTile, noTileStep } from './notile';

type Attrs = Record<string, any>;

export const GEOMETRY_KINDS = ['mesh', 'curve', 'points'] as const;
export type GeometryKind = (typeof GEOMETRY_KINDS)[number];

export function geometryKind(a: Attrs): GeometryKind | null {
  if (a['usd::usdgeom::mesh']?.points) return 'mesh';
  if (a['usd::usdgeom::basiscurves']?.points) return 'curve';
  if (a['pcd::base64'] || a['points::array']?.positions || a['points::base64']?.positions) return 'points';
  return null;
}

export function isInvisible(a: Attrs) {
  return a['usd::usdgeom::visibility']?.visibility === 'invisible';
}

export function transformOf(a: Attrs): THREE.Matrix4 | null {
  const t = a['usd::xformop']?.transform;
  if (!Array.isArray(t)) return null;
  // USD stores matrices by rows with the translation in the last row.
  return new THREE.Matrix4().fromArray(t.flat());
}

// --- Materials ------------------------------------------------------------

const materialCache = new Map<string, THREE.Material>();

function lookup(node: ComposedNode, test: (a: Attrs) => boolean): Attrs | null {
  for (let n: ComposedNode | null = node; n; n = n.parent) if (test(n.attributes)) return n.attributes;
  return null;
}

// --- Textures ---------------------------------------------------------------
// Textures arrive as a URL or data URI in gltf::material. They load asynchronously; the viewer
// registers in onTextureLoad to redraw when they finish.

let onTextureLoad: () => void = () => {};
export function setTextureListener(fn: () => void) { onTextureLoad = fn; }

const textureCache = new Map<string, THREE.Texture>();
const textureIds = new Map<string, number>();
const textureId = (uri: string | undefined) => {
  if (!uri) return 0;
  let id = textureIds.get(uri);
  if (!id) textureIds.set(uri, id = textureIds.size + 1);
  return id;
};

function loadTexture(uri: string, srgb: boolean, repeat: [number, number]): THREE.Texture {
  let base = textureCache.get(uri);
  if (!base) {
    base = new THREE.TextureLoader().load(uri, () => onTextureLoad(), undefined,
      () => console.warn('[ifcx] could not load texture', uri.slice(0, 80)));
    textureCache.set(uri, base);
  }
  const t = base.clone(); // shares the image; each material can have its own scale
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

const texUri = (t: unknown): string | undefined =>
  typeof t === 'string' ? t : typeof (t as any)?.texture === 'string' ? (t as any).texture : undefined;

/**
 * Material of a mesh: that of the nearest node (itself or an ancestor) defining a glTF material or
 * colour, like the USD binding. Thus a piece with its own colour does not take the material of what
 * it hangs from (a piece of furniture hanging from a wall). In one node, glTF wins over colour.
 */
export function surfaceMaterial(node: ComposedNode): THREE.Material {
  const own = lookup(node, a => !!a['gltf::material'] || Array.isArray(a['bsi::ifc::presentation::diffuseColor']));
  const gltf = own?.['gltf::material'];
  if (gltf) {
    const pbr = gltf.pbrMetallicRoughness ?? {};
    const c = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const colorTex = texUri(pbr.baseColorTexture);
    const normalTex = texUri(gltf.normalTexture);
    // KHR_texture_transform.scale: repeats per metre (the viewer UVs are in metres)
    const repeat: [number, number] = gltf.extensions?.KHR_texture_transform?.scale ?? [1, 1];
    // the IFC colour of the same node: what Shaded and Consistent Colors paint (Textures paints the image)
    const shade = own['bsi::ifc::presentation::diffuseColor'];
    const shadeColor = Array.isArray(shade) && shade.length >= 3 ? shade.slice(0, 3) as number[] : undefined;
    // anti-repetition only if the material states the step of its pieces (see notile.ts)
    const tileStep = colorTex || normalTex ? noTileStep(gltf) : null;
    const key = `pbr:${c}:${pbr.metallicFactor}:${pbr.roughnessFactor}:${gltf.doubleSided}` +
      `:t${textureId(colorTex)}:n${textureId(normalTex)}:${repeat}:s${shadeColor ?? ''}:r${tileStep ?? ''}`;
    let m = materialCache.get(key);
    if (!m) {
      // defaults per the glTF 2.0 specification
      const transparent = (c[3] ?? 1) < 1 || gltf.alphaMode === 'BLEND';
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c[0], c[1], c[2]),
        metalness: pbr.metallicFactor ?? 1,
        roughness: pbr.roughnessFactor ?? 1,
        opacity: c[3] ?? 1,
        transparent,
        depthWrite: !transparent, // glass must not hide what is behind it
        side: gltf.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      if (colorTex) mat.map = loadTexture(colorTex, true, repeat);
      if (normalTex) {
        mat.normalMap = loadTexture(normalTex, false, repeat);
        const s = gltf.normalTexture?.scale ?? 1;
        mat.normalScale.set(s, s);
      }
      // IFCX meshes carry no texture coordinates: they have to be generated (see texturedGeometry)
      mat.userData.needsUV = !!(colorTex || normalTex);
      if (tileStep) applyNoTile(mat, tileStep); // a repeated tile on a large wall shows the grid
      if (shadeColor) mat.userData.shadeColor = shadeColor; // sRGB, like every IFC diffuseColor
      materialCache.set(key, m = mat);
    }
    return m;
  }
  const color: number[] = own?.['bsi::ifc::presentation::diffuseColor'] ?? [0.62, 0.62, 0.6];
  const opacity: number = own?.['bsi::ifc::presentation::opacity'] ?? 1;
  const key = `std:${color}:${opacity}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      roughness: 0.85,
      metalness: 0.0,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    m.userData.srgbColor = true; // IFC diffuseColor: sRGB (Shaded and Consistent Colors reinterpret it)
    materialCache.set(key, m);
  }
  return m;
}

function lineMaterial(node: ComposedNode): THREE.LineBasicMaterial {
  const holder = lookup(node, a => Array.isArray(a['bsi::ifc::presentation::diffuseColor']));
  const color: number[] = holder?.['bsi::ifc::presentation::diffuseColor'] ?? [0.2, 0.2, 0.2];
  const key = `line:${color}`;
  let m = materialCache.get(key) as THREE.LineBasicMaterial | undefined;
  if (!m) {
    m = new THREE.LineBasicMaterial({ color: new THREE.Color(color[0], color[1], color[2]).multiplyScalar(0.8) });
    materialCache.set(key, m);
  }
  return m;
}

// --- Geometry (cached by array identity: reused classes share buffers) ----------------------

const geomCache = new WeakMap<object, THREE.BufferGeometry>();

function meshGeometry(mesh: Attrs): THREE.BufferGeometry {
  let g = geomCache.get(mesh.points);
  if (g) return g;
  g = new THREE.BufferGeometry();
  // positions: typed arrays as they are; if they come as [[x,y,z],...], they are copied into a preallocated Float32Array (no .flat())
  const pts = mesh.points as ArrayLike<any>;
  let pos: Float32Array;
  if (pts instanceof Float32Array) pos = pts;
  else {
    pos = new Float32Array(pts.length * 3);
    for (let i = 0, o = 0; i < pts.length; i++) {
      const p = pts[i];
      pos[o++] = p[0]; pos[o++] = p[1]; pos[o++] = p[2];
    }
  }
  const nv = pos.length / 3;
  const idx: ArrayLike<number> = mesh.faceVertexIndices ?? [];
  const counts: ArrayLike<number> | undefined = mesh.faceVertexCounts;
  let allTris = true;
  if (counts) for (let i = 0; i < counts.length; i++) if (counts[i] !== 3) { allTris = false; break; }
  const Idx = nv < 65536 ? Uint16Array : Uint32Array;
  let tris: Uint16Array | Uint32Array;
  if (counts && !allTris) {
    // arbitrary polygons: fan triangulation, with the index sized to the exact length
    let n = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i] > 2) n += counts[i] - 2;
    tris = new Idx(n * 3);
    let o = 0, w = 0;
    for (let k = 0; k < counts.length; k++) {
      const c = counts[k];
      for (let i = 1; i < c - 1; i++) { tris[w++] = idx[o]; tris[w++] = idx[o + i]; tris[w++] = idx[o + i + 1]; }
      o += c;
    }
  } else {
    tris = Idx.from(idx);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(tris, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  geomCache.set(mesh.points, g);
  return g;
}

const texturedCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * UV variant of a mesh: box projection per triangle, in metres of local coordinates. On vertical
 * faces V follows the Z axis, so brick courses stay horizontal.
 */
export function texturedGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let t = texturedCache.get(g);
  if (t) return t;
  t = g.index ? g.toNonIndexed() : g.clone();
  const p = t.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u: number, w: number;
      if (az >= ax && az >= ay) { u = v.x; w = v.y; } // horizontal
      else if (ax >= ay) { u = v.y; w = v.z; } // vertical, faces ±X
      else { u = v.x; w = v.z; } // vertical, faces ±Y
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = w;
    }
  }
  t.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  t.computeVertexNormals();
  t.computeBoundingSphere();
  texturedCache.set(g, t);
  return t;
}

/**
 * Volume (|sum of tetrahedra with the origin|) and area of a triangulated mesh, in its local units.
 * Volume is only meaningful if the mesh is a closed solid.
 */
export function measureGeometry(g: THREE.BufferGeometry): { volume: number; area: number } {
  const p = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let volume = 0, area = 0;
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i);
    b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2);
    area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
    volume += a.dot(ab.copy(b).cross(c)) / 6;
  }
  return { volume: Math.abs(volume), area };
}

function b64ToBuffer(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function pointsObject(geometry: THREE.BufferGeometry, colored: boolean) {
  const material = new THREE.PointsMaterial({
    size: 3,
    sizeAttenuation: false,
    vertexColors: colored,
    color: colored ? 0xffffff : 0x333333,
  });
  return new THREE.Points(geometry, material);
}

/**
 * Mesh of level of detail `level` (`studio::lod`; 0 = the original, -1 = the refined one). If the mesh
 * does not have that level, the nearest one towards the original that it does have.
 */
export function lodMesh(a: Attrs, level: number): Attrs {
  const mesh = a['usd::usdgeom::mesh'];
  const lods = a['studio::lod'];
  if (!level || !lods || typeof lods !== 'object') return mesh;
  const toward = Object.keys(lods).map(Number)
    .filter((k) => Number.isInteger(k) && (level > 0 ? k > 0 && k <= level : k < 0 && k >= level))
    .sort((x, y) => Math.abs(y) - Math.abs(x));
  const l = toward.length ? lods[String(toward[0])] : null;
  return l?.points && l.faceVertexIndices ? l : mesh;
}

/** Mesh geometry of a node at level of detail `level`, with UVs if its material needs them. */
export function meshGeometryOf(node: ComposedNode, material: THREE.Material, level = 0): THREE.BufferGeometry {
  const g = meshGeometry(lodMesh(node.attributes as Attrs, level));
  return material.userData.needsUV ? texturedGeometry(g) : g;
}

export function buildObject(node: ComposedNode, kind: GeometryKind, level = 0): THREE.Object3D | null {
  const a = node.attributes as Attrs;
  if (kind === 'mesh') {
    const material = surfaceMaterial(node);
    return new THREE.Mesh(meshGeometryOf(node, material, level), material);
  }
  if (kind === 'curve') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a['usd::usdgeom::basiscurves'].points.flat(), 3));
    return new THREE.Line(g, lineMaterial(node));
  }
  if (a['pcd::base64']) {
    const pts = new PCDLoader().parse(b64ToBuffer(a['pcd::base64']));
    const m = pts.material as THREE.PointsMaterial;
    m.size = 2;
    m.sizeAttenuation = false;
    return pts;
  }
  const g = new THREE.BufferGeometry();
  if (a['points::array']?.positions) {
    const p = a['points::array'];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.positions.flat(), 3));
    if (p.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(p.colors.flat(), 3));
    return pointsObject(g, !!p.colors);
  }
  const p = a['points::base64'];
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(b64ToBuffer(p.positions)), 3));
  if (p.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(b64ToBuffer(p.colors)), 3));
  return pointsObject(g, !!p.colors);
}
