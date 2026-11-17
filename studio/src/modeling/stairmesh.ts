// Meshes (Manifold) of the flights, the landing and the railings of a stair. World coordinates.
import {
  GUARD_HEIGHT,
  HANDRAIL_HEIGHT,
  LANDING_THICKNESS,
  STAIR_TREAD,
} from './constants';
import { loadManifold } from './manifold';
import type { Manifold as ManifoldHandle } from 'manifold-3d';
import type { PlacedStair } from './staircheck';
import { toUsdMesh, type UsdMesh } from './wallmesh';
import type { Vec3 } from '../composer/xform';

const RAIL = 0.05;
const POST = 0.04;

/** Takes a local solid (z relative to the base level) to the world, rotating it with the stair. */
async function toWorld(local: ManifoldHandle, p: PlacedStair): Promise<UsdMesh> {
  const girado = local.rotate([0, 0, p.angle]);
  const movido = girado.translate([p.origin[0], p.origin[1], p.baseZ]);
  try {
    return toUsdMesh(movido.getMesh());
  } finally {
    movido.delete();
    girado.delete();
    local.delete();
  }
}

/** Mesh of the flight `index`: the union of its solid steps. */
export async function flightMesh(p: PlacedStair, index: number): Promise<UsdMesh> {
  const { Manifold } = await loadManifold();
  const f = p.layout.flights[index];
  const r = p.layout.riser;
  const w = p.layout.width;
  const cajas: ManifoldHandle[] = [];
  try {
    for (let i = 0; i < f.risers - 1; i++) {
      const top = f.z0 + (i + 1) * r;
      const bottom = Math.max(f.z0, top - (r + 0.15));
      const xa = f.x0 + f.dir * i * STAIR_TREAD;
      const xb = xa + f.dir * STAIR_TREAD;
      const caja = Manifold.cube([Math.abs(xb - xa), w, top - bottom], true)
        .translate([(xa + xb) / 2, f.y, (top + bottom) / 2]);
      cajas.push(caja);
    }
    const union = Manifold.union(cajas);
    return await toWorld(union, p);
  } finally {
    for (const c of cajas) c.delete();
  }
}

/** Mesh of the landing (a slab of LANDING_THICKNESS); null if the stair is straight. */
export async function landingMesh(p: PlacedStair): Promise<UsdMesh | null> {
  const l = p.layout.landing;
  if (!l) return null;
  const { Manifold } = await loadManifold();
  const local = Manifold.cube([l.x1 - l.x0, l.y1 - l.y0, LANDING_THICKNESS], true)
    .translate([(l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2, l.z - LANDING_THICKNESS / 2]);
  return toWorld(local, p);
}

/** Bar between two points (a rectangular capsule); its end cubes give the exact height. */
function bar(from: Vec3, to: Vec3, height: number, size: number, Manifold: typeof ManifoldHandle): ManifoldHandle {
  const a = Manifold.cube([size, size, size], true).translate([from[0], from[1], from[2] + height - size / 2]);
  const b = Manifold.cube([size, size, size], true).translate([to[0], to[1], to[2] + height - size / 2]);
  try {
    return Manifold.hull([a, b]);
  } finally {
    a.delete();
    b.delete();
  }
}

function post(at: Vec3, height: number, Manifold: typeof ManifoldHandle): ManifoldHandle {
  const a = Manifold.cube([POST, POST, POST], true).translate([at[0], at[1], at[2] + POST / 2]);
  const b = Manifold.cube([POST, POST, POST], true).translate([at[0], at[1], at[2] + height - POST / 2]);
  try {
    return Manifold.hull([a, b]);
  } finally {
    a.delete();
    b.delete();
  }
}

/** Malla de una baranda ('guard') o de un pasamanos de pared ('handrail'), en el mundo. */
export async function railMesh(rail: PlacedStair['rails'][number]): Promise<UsdMesh> {
  const { Manifold } = await loadManifold();
  const height = rail.kind === 'handrail' ? HANDRAIL_HEIGHT : GUARD_HEIGHT;
  const piezas: ManifoldHandle[] = [];
  try {
    piezas.push(bar(rail.from, rail.to, height, RAIL, Manifold));
    if (rail.kind === 'guard') {
      piezas.push(bar(rail.from, rail.to, height / 2, RAIL, Manifold));
      const dx = rail.to[0] - rail.from[0];
      const dy = rail.to[1] - rail.from[1];
      const dz = rail.to[2] - rail.from[2];
      const len = Math.hypot(dx, dy);
      const n = Math.max(1, Math.ceil(len / 1.2));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        piezas.push(post([rail.from[0] + dx * t, rail.from[1] + dy * t, rail.from[2] + dz * t], height, Manifold));
      }
    }
    const union = Manifold.union(piezas);
    try {
      return toUsdMesh(union.getMesh());
    } finally {
      union.delete();
    }
  } finally {
    for (const x of piezas) x.delete();
  }
}
