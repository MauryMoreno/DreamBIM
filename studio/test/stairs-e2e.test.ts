// Prueba de extremo a extremo: edificio de 3 niveles con escaleras apiladas, guardado y deshacer.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { sessionFromFile, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import type { ComposedNode } from '../src/ifcx/types';
import { parseBuildRequest } from '../src/modeling/build';
import { parsePlaceStairs } from '../src/modeling/stairplace';
import { placeStair } from '../src/modeling/staircheck';
import { pointInPolygon } from '../src/modeling/plan2d';
import type { Vec2 } from '../src/modeling/footprint';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel = vi.fn((m: LoadedModel | null) => {
    if (m) this.models.push(m);
  });
  updateModel = vi.fn((m: LoadedModel) => {
    this.models.push(m);
  });
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

function make() {
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async () => {
      throw new Error('not found');
    }),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  return { ctrl: new DocumentController(deps), ws, deps };
}

const BUILD = parseBuildRequest({
  levels: [
    { name: 'Level 1', elevation: 0, layout: 'a' },
    { name: 'Level 2', elevation: 3, layout: 'a' },
    { name: 'Level 3', elevation: 6, layout: 'a' },
  ],
  layouts: {
    a: {
      walls: [
        { from: [0, 0], to: [10, 0], thickness: 0.3 },
        { from: [10, 0], to: [10, 8], thickness: 0.3 },
        { from: [10, 8], to: [0, 8], thickness: 0.3 },
        { from: [0, 8], to: [0, 0], thickness: 0.3 },
        { from: [2, 3], to: [8, 3], thickness: 0.15 },
        { from: [2, 5], to: [8, 5], thickness: 0.15 },
      ],
      floors: [[[0, 0], [10, 0], [10, 8], [0, 8]]],
    },
  },
});

const code = (n: ComposedNode): string | null =>
  (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code ?? null;

const nodes = (m: LoadedModel) => [...m.result.byPath.values()];
const ofClass = (m: LoadedModel, cls: string) => nodes(m).filter((n) => code(n) === cls);

/** Estrictamente dentro: el borde compartido con un muro pegado no cuenta. */
function inside(p: Vec2, poly: Vec2[]): boolean {
  if (!pointInPolygon(p, poly)) return false;
  return poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) return true;
    return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len > 1e-6;
  });
}

/** Zonas libres de todas las escaleras, con su rango vertical. */
function clearZones(ctrl: DocumentController): { poly: Vec2[]; z0: number; z1: number }[] {
  const s = ctrl.session!;
  return s.doc.stairs.flatMap((stair) => {
    const placed = placeStair(s.doc, stair);
    const base = s.doc.levels.find((l) => l.id === stair.baseLevelId)!;
    const top = s.doc.levels.find((l) => l.id === stair.topLevelId)!;
    return [
      { poly: placed.bottomClear, z0: base.elevation, z1: base.elevation + 2.05 },
      { poly: placed.topClear, z0: top.elevation, z1: top.elevation + 2.05 },
    ];
  });
}

/** Mallas de muros y escaleras (no de los suelos) con su clase. */
function structureMeshes(m: LoadedModel): { nodes: ComposedNode[]; cls: string | null } {
  const out: ComposedNode[] = [];
  for (const n of nodes(m)) {
    if (!(n.attributes['usd::usdgeom::mesh'] as unknown)) continue;
    let e: ComposedNode | null = n.parent;
    let cls: string | null = null;
    while (e) {
      const c = code(e);
      if (c === 'IfcWall' || c === 'IfcStairFlight' || c === 'IfcSlab') {
        const landing = e.attributes['bsi::ifc::prop::PredefinedType'] === 'LANDING';
        if (c !== 'IfcSlab' || landing) cls = c;
        break;
      }
      e = e.parent;
    }
    if (cls) out.push(n);
  }
  return { nodes: out, cls: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('escaleras de extremo a extremo', () => {
  it('apila dos escaleras en 3 niveles, guarda, reabre y deshace', async () => {
    const { ctrl, ws } = make();
    await ctrl.newDocument();
    await ctrl.buildModel(BUILD);
    const s = ctrl.session!;

    const spots1 = ctrl.stairSpots({ from: 'Level 1', to: 'Level 2', shape: 'u', width: 1.1, limit: 10 });
    expect(spots1.spots.length).toBeGreaterThan(0);
    const first = spots1.spots[0];
    await ctrl.placeStairs(parsePlaceStairs({
      items: [{ from: 'Level 1', to: 'Level 2', shape: 'u', at: first.origin, rotation: first.angle, turn: first.turn }],
    }), false);

    const spots2 = ctrl.stairSpots({ from: 'Level 2', to: 'Level 3', shape: 'u', width: 1.1, limit: 10 });
    expect(spots2.spots[0].stacked).toBe(true);
    const second = spots2.spots[0];
    await ctrl.placeStairs(parsePlaceStairs({
      items: [{ from: 'Level 2', to: 'Level 3', shape: 'u', at: second.origin, rotation: second.angle, turn: second.turn }],
    }), false);

    const m = ws.models.at(-1)!;
    expect(ofClass(m, 'IfcStair')).toHaveLength(2);
    expect(ofClass(m, 'IfcStairFlight')).toHaveLength(4);
    const landings = ofClass(m, 'IfcSlab').filter((n) => n.attributes['bsi::ifc::prop::PredefinedType'] === 'LANDING');
    expect(landings).toHaveLength(2);

    // todas las contrahuellas iguales y <= 0,178
    const risers = ofClass(m, 'IfcStairFlight').map((n) => n.attributes['bsi::ifc::prop::RiserHeight'] as number);
    expect(new Set(risers).size).toBe(1);
    expect(risers[0]).toBeLessThanOrEqual(0.178 + 1e-12);

    // one railing for each line of the layout
    const expectedRails = s.doc.stairs.reduce((n, stair) => n + placeStair(s.doc, stair).rails.length, 0);
    expect(ofClass(m, 'IfcRailing')).toHaveLength(expectedRails);

    // los suelos 2 y 3 pierden su hueco; el 1 no
    const floorVolumes = s.doc.floors.map((f) => {
      const node = m.result.byOrigin.get(f.id)![0];
      return node.attributes['bsi::ifc::prop::NetVolume'] as number;
    });
    expect(floorVolumes[0]).toBeCloseTo(80 * 0.3);
    expect(floorVolumes[1]).toBeLessThan(80 * 0.3);
    expect(floorVolumes[2]).toBeLessThan(80 * 0.3);

    // no wall or stair vertex inside the clear zones, between the level and 2.05 m
    const zones = clearZones(ctrl);
    const meshes = structureMeshes(m);
    expect(meshes.nodes.length).toBeGreaterThan(0);
    for (const body of meshes.nodes) {
      const mesh = body.attributes['usd::usdgeom::mesh'] as { points: number[][] };
      for (const p of mesh.points) {
        for (const z of zones) {
          if (p[2] >= z.z0 - 1e-6 && p[2] <= z.z1 + 1e-6 && inside([p[0], p[1]], z.poly)) {
            throw new Error(`vértice (${p[0]}, ${p[1]}, ${p[2]}) dentro de una zona libre`);
          }
        }
      }
    }

    // guardar y reabrir conserva las escaleras
    const text = await s.serialize();
    const reopened = sessionFromFile(JSON.parse(text), 'C:/x.ifcx')!;
    expect(reopened.doc.stairs).toEqual(s.doc.stairs);

    // deshacer dos veces: sin escaleras y con los suelos enteros
    await ctrl.undo();
    await ctrl.undo();
    expect(s.doc.stairs).toEqual([]);
    const after = ws.models.at(-1)!;
    expect(ofClass(after, 'IfcStair')).toHaveLength(0);
    for (const f of s.doc.floors) {
      expect(after.result.byOrigin.get(f.id)![0].attributes['bsi::ifc::prop::NetVolume']).toBeCloseTo(80 * 0.3);
    }
  });
});
