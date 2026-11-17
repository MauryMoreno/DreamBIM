// Elements without a mesh: doors, windows, furniture or equipment that come from a library without geometry of
// their own (the node carries its class and position, but nothing to measure). Without a quantity row they would
// not exist for the BOQ or the schedule, so each one gives a row with no measurements: it counts by unit (count)
// and sums 0 everywhere else.
//
// Only elements (non-spatial IFC class) with no row and with no element below them having a row are counted: a
// curtain wall gives no row of its own because its panels and mullions are measured already. Pure.
import type { ComposedNode } from '../ifcx/types';
import { effectiveMaterialCode } from './coloroverride';
import type { QuantityRow } from './viewer';

/** Classes that are not something built (or not on their own): they give no row. */
const NOT_BUILT = new Set([
  'IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcFacility', 'IfcFacilityPart', 'IfcBridge',
  'IfcRoad', 'IfcRailway', 'IfcTunnel', 'IfcMarineFacility', 'IfcSpatialZone', 'IfcZone',
  'IfcGrid', 'IfcAnnotation', 'IfcDistributionPort', 'IfcOpeningElement', 'IfcVirtualElement',
]);

/** Processes, controls, resources and groups (schedule tasks, budget lines...): they are not construction. */
const NOT_PHYSICAL = /^Ifc(Work|Task|Cost|Procedure|Event|Process|Control|Actor|Group|System|Zone|Inventory|Resource|ConstructionResource|Labor|Crew|Permit|ActionRequest|PerformanceHistory|Rel|Project)/;

const classOf = (n: ComposedNode) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;

/**
 * Rows without measurements for the elements without a mesh. `positionOf` gives their point in the world (the box
 * is that point, so the storey and the height order still work); `shown`, whether only visible ones are wanted.
 */
export function bareElementRows(
  nodes: Iterable<ComposedNode>,
  rows: readonly QuantityRow[],
  positionOf: (node: ComposedNode) => [number, number, number] | null,
  shown: (node: ComposedNode) => boolean = () => true,
): QuantityRow[] {
  const measured = new Set(rows.map((r) => r.element));
  // ancestors of what is measured (a curtain wall, the wall holding a mesh window) do not count separately
  const above = new Set<string>();
  const byPath = new Map<string, ComposedNode>();
  for (const n of nodes) byPath.set(n.path, n);
  for (const path of measured) for (let p = byPath.get(path)?.parent ?? null; p; p = p.parent) above.add(p.path);
  const out: QuantityRow[] = [];
  for (const n of byPath.values()) {
    const cls = classOf(n);
    if (!cls || NOT_BUILT.has(cls) || NOT_PHYSICAL.test(cls) || measured.has(n.path) || above.has(n.path) || !shown(n)) continue;
    let storey: ComposedNode | null = null;
    for (let p: ComposedNode | null = n.parent; p; p = p.parent) if (classOf(p) === 'IfcBuildingStorey') { storey = p; break; }
    const at = positionOf(n) ?? [0, 0, 0];
    const mat = n.attributes['bsi::ifc::material'] as { code?: string } | undefined;
    out.push({
      element: n.path,
      name: n.name,
      cls,
      storey: storey?.name ?? 'No storey',
      material: mat?.code ?? 'No material',
      materialCode: effectiveMaterialCode(n, undefined),
      box: [at[0], at[1], at[2], at[0], at[1], at[2]],
      volume: 0,
      area: 0,
    });
  }
  return out;
}
