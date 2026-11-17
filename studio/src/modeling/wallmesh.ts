import { loadManifold } from './manifold';
import { polygonArea, type Vec2 } from './footprint';
import type { WallHole } from './hosting';

export interface UsdMesh {
  points: number[][];
  faceVertexIndices: number[];
}

const redondea = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // +0 evita -0

/** Manifold mesh to the mesh written in `usd::usdgeom::mesh` (unshared vertices). */
export function toUsdMesh(m: { triVerts: ArrayLike<number>; vertProperties: ArrayLike<number>; numProp: number }): UsdMesh {
  const { triVerts, vertProperties, numProp } = m;
  const points: number[][] = [];
  const faceVertexIndices: number[] = [];
  for (let i = 0; i < triVerts.length; i++) {
    const o = triVerts[i] * numProp;
    points.push([redondea(vertProperties[o]), redondea(vertProperties[o + 1]), redondea(vertProperties[o + 2])]);
    faceVertexIndices.push(i);
  }
  return { points, faceVertexIndices };
}

/** Extrudes a 2D footprint along Z; unshared vertices per triangle (flat shading). */
export async function extrudeFootprint(footprint: Vec2[], baseZ: number, height: number): Promise<UsdMesh> {
  const { CrossSection } = await loadManifold();
  const seccion = new CrossSection([footprint]);
  const solido = seccion.extrude(height);
  const movido = solido.translate([0, 0, baseZ]);
  try {
    return toUsdMesh(movido.getMesh());
  } finally {
    movido.delete();
    solido.delete();
    seccion.delete();
  }
}

/** Extrudes a footprint subtracting the openings (polygons in plan) through its whole depth. */
export async function extrudeWithHoles(footprint: Vec2[], baseZ: number, height: number, holes: Vec2[][]): Promise<UsdMesh> {
  if (!holes.length) return extrudeFootprint(footprint, baseZ, height);
  const { CrossSection } = await loadManifold();
  const seccion = new CrossSection([footprint]);
  const base = seccion.extrude(height);
  const solido = base.translate([0, 0, baseZ]);
  const temporales: { delete(): void }[] = [];
  let actual = solido;
  try {
    for (const hole of holes) {
      const poligono = polygonArea(hole) < 0 ? [...hole].reverse() : hole;
      const hs = new CrossSection([poligono]);
      // a little taller than the floor so that the cut is not coplanar with its faces
      const pieza = hs.extrude(height + 0.02);
      const movida = pieza.translate([0, 0, baseZ - 0.01]);
      temporales.push(hs, pieza, movida);
      const siguiente = actual.subtract(movida);
      if (actual !== solido) actual.delete();
      actual = siguiente;
    }
    return toUsdMesh(actual.getMesh());
  } finally {
    for (const t of temporales) t.delete();
    if (actual !== solido) actual.delete();
    solido.delete();
    base.delete();
    seccion.delete();
  }
}

/**
 * Extrudes a footprint and subtracts the openings of its hosted pieces. `depth` is the depth of the box that
 * is subtracted, centered on the axis of the wall: it must exceed its thickness so that the opening goes through it.
 */
export async function extrudeWall(
  footprint: Vec2[],
  baseZ: number,
  height: number,
  holes: WallHole[],
  depth: number,
): Promise<UsdMesh> {
  const { CrossSection, Manifold } = await loadManifold();
  const seccion = new CrossSection([footprint]);
  const base = seccion.extrude(height);
  const solido = base.translate([0, 0, baseZ]);
  const temporales: { delete(): void }[] = [];
  let actual = solido;
  try {
    for (const h of holes) {
      const caja = Manifold.cube([h.width, depth, h.z1 - h.z0], true);
      const girada = caja.rotate([0, 0, h.angle]);
      const movida = girada.translate([h.center[0], h.center[1], (h.z0 + h.z1) / 2]);
      temporales.push(caja, girada, movida);
      const siguiente = actual.subtract(movida);
      if (actual !== solido) actual.delete();
      actual = siguiente;
    }
    return toUsdMesh(actual.getMesh());
  } finally {
    for (const t of temporales) t.delete();
    if (actual !== solido) actual.delete();
    solido.delete();
    base.delete();
    seccion.delete();
  }
}
