import type { IfcxFile, IfcxNode } from '../../ifcx/types';
import { BUNDLED_SCHEMAS } from '../../model/schemas';
import { FLOOR_TYPE_NAME, LANDING_THICKNESS, WALL_TYPE_NAME } from '../constants';
import { polygonArea, wallFootprints, type Vec2 } from '../footprint';
import { wallHoles } from '../hosting';
import { extrudeWall, extrudeWithHoles } from '../wallmesh';
import { placeStair, type PlacedStair } from '../staircheck';
import { flightMesh, landingMesh, railMesh } from '../stairmesh';
import { polygonContains } from '../plan2d';
import { StudioDoc } from './types';
import { wallBaseZ, wallHeight, floorTopZ, floorQuantities, wallQuantities, stairNodeIds } from './levels';
import { LOCATION_LINE, K_NAME, K_DOC, K_LEVEL, K_WALL, K_FLOOR, K_STAIR, K_COMPOSER, CONTAINER_PREFIX, STUDIO_SCHEMAS, cls } from './keys';
import { placementTransform, hostedTransform, serializeComposer, savedComposer, effectiveParent, placementChildren, placementBaseZ } from './composer';

export async function toIfcx(doc: StudioDoc, timestamp: string): Promise<IfcxFile> {
  const { ids, levels, walls, floors } = doc;
  const composer = savedComposer(doc);
  const kids = (id: string) => placementChildren(composer, id, ids.project);
  const data: IfcxNode[] = [
    { path: ids.root, children: { Project: ids.project } },
    {
      path: ids.project,
      children: { [ids.site]: ids.site, ...kids(ids.project) },
      attributes: { ...cls('IfcProject'), [K_DOC]: { version: doc.stairs.length ? 5 : 4, ...(doc.overs.length ? { overs: doc.overs.length } : {}) }, [K_COMPOSER]: serializeComposer(composer) },
    },
    { path: ids.site, children: { [ids.building]: ids.building, ...kids(ids.site) }, attributes: { ...cls('IfcSite'), [K_NAME]: 'Site' } },
    {
      path: ids.building,
      children: { ...Object.fromEntries(levels.map((l) => [l.id, l.id])), ...kids(ids.building) },
      attributes: { ...cls('IfcBuilding'), [K_NAME]: 'Building' },
    },
  ];
  // stairs that can be written (one whose layout is no longer valid is omitted)
  const placedStairs = new Map<string, PlacedStair>();
  for (const s of doc.stairs) {
    try {
      placedStairs.set(s.id, placeStair(doc, s));
    } catch {
      // el nivel o la altura ya no existen: no se escribe
    }
  }
  // walls hang from the storey of their base level and floors and stairs from theirs; they are emitted grouped by level
  const byLevel = levels.map((l) => walls.filter((w) => w.baseLevelId === l.id));
  const floorsByLevel = levels.map((l) => floors.filter((f) => f.levelId === l.id));
  const stairsByLevel = levels.map((l) => doc.stairs.filter((s) => s.baseLevelId === l.id && placedStairs.has(s.id)));
  levels.forEach((l, i) =>
    data.push({
      path: l.id,
      children: Object.fromEntries([
        ...[...byLevel[i], ...floorsByLevel[i], ...stairsByLevel[i]].map((e) => [e.id, e.id]),
        ...Object.entries(kids(l.id)),
      ]),
      attributes: { ...cls('IfcBuildingStorey'), [K_NAME]: l.name, [K_LEVEL]: { elevation: l.elevation } },
    }),
  );

  // mitered joints only occur between walls of the same base level
  const footprints = new Map<string, Vec2[]>();
  for (const group of byLevel) for (const [id, fp] of wallFootprints(group)) footprints.set(id, fp);
  for (const w of byLevel.flat()) {
    const fp = footprints.get(w.id)!;
    const baseZ = wallBaseZ(levels, w);
    const height = wallHeight(levels, w);
    const hosted = composer.placements.flatMap((p) => (p.parentId === w.id && p.host ? [p.host] : []));
    const holes = wallHoles(w, baseZ, height, hosted);
    const mesh = await extrudeWall(fp, baseZ, height, holes, w.thickness + 0.2);
    const q = wallQuantities(w, fp, height);
    const holeArea = holes.reduce((s, h) => s + h.width * (h.z1 - h.z0), 0);
    data.push(
      {
        path: w.id,
        children: { Body: w.bodyId, Axis: w.axisId, ...kids(w.id) },
        attributes: {
          ...cls('IfcWall'),
          [K_NAME]: WALL_TYPE_NAME,
          'bsi::ifc::prop::TypeName': WALL_TYPE_NAME,
          'bsi::ifc::prop::Length': q.length,
          'bsi::ifc::prop::Width': w.thickness,
          'bsi::ifc::prop::Height': height,
          'bsi::ifc::prop::NetSideArea': q.area - holeArea,
          'bsi::ifc::prop::NetVolume': q.volume - holeArea * w.thickness,
          [K_WALL]: {
            start: [...w.start],
            end: [...w.end],
            thickness: w.thickness,
            height: w.height,
            baseOffset: w.baseOffset,
            topOffset: w.topOffset,
            ...(w.topLevelId !== null ? { topLevel: w.topLevelId } : {}),
            locationLine: LOCATION_LINE,
          },
        },
      },
      {
        path: w.bodyId,
        attributes: { 'usd::usdgeom::mesh': { points: mesh.points, faceVertexIndices: mesh.faceVertexIndices } },
      },
      {
        path: w.axisId,
        attributes: {
          'usd::usdgeom::basiscurves': {
            points: [[w.start[0], w.start[1], baseZ], [w.end[0], w.end[1], baseZ]],
          },
        },
      },
    );
  }

  // openings that each stair cuts in the arrival floor
  const openingsByLevel = new Map<string, Vec2[][]>();
  for (const s of doc.stairs) {
    const p = placedStairs.get(s.id);
    if (!p) continue;
    const list = openingsByLevel.get(s.topLevelId) ?? [];
    list.push(p.opening);
    openingsByLevel.set(s.topLevelId, list);
  }

  for (const f of floors) {
    const q = floorQuantities(f);
    const holes = openingsByLevel.get(f.levelId) ?? [];
    const holeArea = holes.reduce((sum, h) => sum + (polygonContains(f.boundary, h) ? Math.abs(polygonArea(h)) : 0), 0);
    const mesh = await extrudeWithHoles(f.boundary, floorTopZ(levels, f) - f.thickness, f.thickness, holes);
    data.push(
      {
        path: f.id,
        children: { Body: f.bodyId, ...kids(f.id) },
        attributes: {
          ...cls('IfcSlab'),
          [K_NAME]: FLOOR_TYPE_NAME,
          'bsi::ifc::prop::PredefinedType': 'FLOOR',
          'bsi::ifc::prop::TypeName': FLOOR_TYPE_NAME,
          'bsi::ifc::prop::Width': f.thickness,
          'bsi::ifc::prop::GrossArea': q.area,
          'bsi::ifc::prop::NetArea': q.area - holeArea,
          'bsi::ifc::prop::Perimeter': q.perimeter,
          'bsi::ifc::prop::NetVolume': q.volume - holeArea * f.thickness,
          [K_FLOOR]: { boundary: f.boundary.map((p) => [...p]), thickness: f.thickness, offset: f.offset },
        },
      },
      {
        path: f.bodyId,
        attributes: { 'usd::usdgeom::mesh': { points: mesh.points, faceVertexIndices: mesh.faceVertexIndices } },
      },
    );
  }

  for (const s of doc.stairs) {
    const placed = placedStairs.get(s.id);
    if (!placed) continue;
    const layout = placed.layout;
    const ids = stairNodeIds(s, layout.flights.length, layout.landing !== null, placed.rails.length);
    const body = (id: string) => `${id}-body`;
    data.push({
      path: s.id,
      children: Object.fromEntries(ids.map((id) => [id, id])),
      attributes: {
        ...cls('IfcStair'),
        [K_NAME]: 'Stair',
        'bsi::ifc::prop::NumberOfRiser': layout.risers,
        'bsi::ifc::prop::NumberOfTreads': layout.risers - layout.flights.length,
        'bsi::ifc::prop::RiserHeight': layout.riser,
        'bsi::ifc::prop::TreadLength': layout.tread,
        [K_STAIR]: {
          base: s.baseLevelId,
          top: s.topLevelId,
          shape: s.shape,
          origin: [...s.origin],
          angle: s.angle,
          width: s.width,
          ...(s.turn ? { turn: s.turn } : {}),
        },
      },
    });
    for (const [i, f] of layout.flights.entries()) {
      const id = ids[i];
      const mesh = await flightMesh(placed, i);
      data.push(
        {
          path: id,
          children: { Body: body(id) },
          attributes: {
            ...cls('IfcStairFlight'),
            [K_NAME]: 'Stair Flight',
            'bsi::ifc::prop::NumberOfRiser': f.risers,
            'bsi::ifc::prop::NumberOfTreads': f.treads,
            'bsi::ifc::prop::RiserHeight': layout.riser,
            'bsi::ifc::prop::TreadLength': layout.tread,
            'bsi::ifc::prop::Length': f.treads * layout.tread,
          },
        },
        { path: body(id), attributes: { 'usd::usdgeom::mesh': { points: mesh.points, faceVertexIndices: mesh.faceVertexIndices } } },
      );
    }
    if (layout.landing) {
      const id = `${s.id}-l`;
      const mesh = await landingMesh(placed);
      data.push(
        {
          path: id,
          children: { Body: body(id) },
          attributes: {
            ...cls('IfcSlab'),
            [K_NAME]: 'Stair Landing',
            'bsi::ifc::prop::PredefinedType': 'LANDING',
            'bsi::ifc::prop::Width': LANDING_THICKNESS,
          },
        },
        { path: body(id), attributes: { 'usd::usdgeom::mesh': { points: mesh!.points, faceVertexIndices: mesh!.faceVertexIndices } } },
      );
    }
    for (const [i, rail] of placed.rails.entries()) {
      const id = `${s.id}-r${i + 1}`;
      const mesh = await railMesh(rail);
      const length = Math.hypot(
        rail.to[0] - rail.from[0],
        rail.to[1] - rail.from[1],
        rail.to[2] - rail.from[2],
      );
      data.push(
        {
          path: id,
          children: { Body: body(id) },
          attributes: {
            ...cls('IfcRailing'),
            [K_NAME]: 'Railing',
            'bsi::ifc::prop::Height': rail.kind === 'handrail' ? 0.86 : 1.02,
            'bsi::ifc::prop::Length': length,
          },
        },
        { path: body(id), attributes: { 'usd::usdgeom::mesh': { points: mesh.points, faceVertexIndices: mesh.faceVertexIndices } } },
      );
    }
  }

  // Contenedores de los archivos enlazados: se reconstruyen desde los metadatos al leer.
  for (const p of composer.placements) {
    const baseZ = effectiveParent(composer, p, ids.project) === p.parentId ? placementBaseZ(doc, p) : 0;
    const layer = composer.layers.find((l) => l.uri === p.layerUri);
    // a hosted piece is placed on the axis of its wall and rotates with it: its offset and rotation do not count
    const wall = p.host ? walls.find((w) => w.id === p.parentId) : undefined;
    const transform = p.host && wall ? hostedTransform(wall, wallBaseZ(levels, wall), p.host) : placementTransform(p, baseZ);
    data.push({
      path: p.id,
      // a disabled layer contributes nothing: its roots are not referenced (they would be unknown nodes)
      children: layer?.enabled ? Object.fromEntries(p.roots.map((r) => [r, r])) : {},
      attributes: {
        [K_NAME]: `${CONTAINER_PREFIX}${layer?.name ?? p.layerUri}`,
        'usd::xformop': { transform },
      },
    });
  }
  // Nodes of other linked files that contain placements: the document only adds children to them.
  const linkedParents = new Set(
    composer.placements.filter((p) => p.parentLayerUri !== undefined && effectiveParent(composer, p, ids.project) === p.parentId).map((p) => p.parentId),
  );
  for (const id of linkedParents) data.push({ path: id, children: kids(id) });
  // the last thing in the file: the overrides of the document (their number is left in K_DOC.overs to read them)
  data.push(...doc.overs);

  return {
    header: {
      id: `ifcx-studio/${ids.root}`,
      ifcxVersion: 'ifcx_alpha',
      dataVersion: '1.0.0',
      author: 'Dream BIM',
      timestamp,
    },
    imports: [...new Set([...Object.keys(BUNDLED_SCHEMAS), ...composer.layers.map((l) => l.uri), ...doc.imports])].map((uri) => ({ uri })),
    schemas: STUDIO_SCHEMAS,
    data,
  };
}
