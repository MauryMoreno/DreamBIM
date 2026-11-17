import * as THREE from 'three';
import { bareElementRows } from '../barerows';
import { effectiveMaterialCode } from '../coloroverride';
import { measureGeometry } from '../geometry';
import { isShown } from '../visibility';
import { worldBox, type WorldBox } from '../worldbox';
import type { ViewerCore } from './core';

export interface QuantityRow {
  element: string; // element path
  name: string;
  cls: string;
  storey: string;
  material: string;
  /** `code` of the effective material (the element's or, if it has none, the mesh's); null if none. */
  materialCode: string | null;
  /** Mesh box in world space: [minX, minY, minZ, maxX, maxY, maxZ] in metres. */
  box: WorldBox;
  volume: number; // m³
  area: number; // m²
}

/** Classes that count as spatial structure when looking for the element a mesh belongs to. */
export const SPATIAL = new Set(['IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 'IfcFacility',
  'IfcFacilityPart', 'IfcBridge', 'IfcRoad', 'IfcRailway', 'IfcTunnel', 'IfcMarineFacility', 'IfcSpatialZone']);

/** Geometry measurement: one row per drawn mesh, with the element it belongs to. */
export class ViewerQuantities {
  private measureCache = new WeakMap<THREE.BufferGeometry, { volume: number; area: number }>();

  constructor(private core: ViewerCore) {}

  /**
   * Volume and area in m³ / m² in world coordinates (closed solids; on open meshes the volume is not
   * meaningful). Visible only, when `onlyVisible`.
   */
  quantities(onlyVisible = true): QuantityRow[] {
    const rows: QuantityRow[] = [];
    for (const o of this.core.pickables) {
      if (!(o instanceof THREE.Mesh) || (onlyVisible && !isShown(o))) continue;
      const element = elementOf(o);
      if (!element) continue;
      const m = this.measure(o.geometry);
      // object scale (almost always 1 in IFC): volume x |det|, area approx. x |det|^(2/3)
      const det = Math.abs(o.matrixWorld.determinant());
      const node = this.core.nodes.get(o.userData.path);
      const elNode = this.core.nodes.get(element.userData.path);
      const storey = ancestorWithClass(element, 'IfcBuildingStorey');
      const mat = (elNode?.attributes['bsi::ifc::material'] ?? node?.attributes['bsi::ifc::material']) as any; // the element's wins over the mesh's
      const desc = node?.attributes['bsi::ifc::prop::Description'];
      rows.push({
        element: element.userData.path,
        name: elNode?.name ?? '',
        cls: element.userData.ownClass ?? element.userData.cls ?? 'Unclassified',
        storey: storey ? this.core.nodes.get(storey.userData.path)?.name ?? '' : 'No storey',
        material: mat ? (typeof desc === 'string' && desc ? desc : mat.code) : 'No material',
        materialCode: effectiveMaterialCode(elNode, node),
        box: worldBox(o),
        volume: m.volume * det,
        area: m.area * Math.pow(det, 2 / 3),
      });
    }
    // elements without a mesh (doors or library furniture without geometry) count by unit
    const at = new THREE.Vector3();
    const bare = bareElementRows(
      this.core.nodes.values(),
      rows,
      (n) => {
        const o = this.core.objects.get(n.path);
        return o ? (o.getWorldPosition(at), [at.x, at.y, at.z]) : null;
      },
      (n) => {
        // what is not drawn (marked invisible) does not count; with onlyVisible, neither does what is hidden
        const o = this.core.objects.get(n.path);
        return !!o && (!onlyVisible || isShown(o));
      },
    );
    return bare.length ? [...rows, ...bare] : rows;
  }

  private measure(g: THREE.BufferGeometry) {
    let m = this.measureCache.get(g);
    if (!m) this.measureCache.set(g, m = measureGeometry(g));
    return m;
  }
}

/**
 * Element a mesh belongs to: the nearest one that is not spatial structure (so a window inside a wall
 * counts as a window). If there is none, the nearest spatial one: e.g. the terrain hangs directly off
 * the IfcSite.
 */
export function elementOf(o: THREE.Object3D): THREE.Object3D | null {
  let nearest: THREE.Object3D | null = null;
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const cls = p.userData.ownClass as string | undefined;
    if (!cls) continue;
    if (!SPATIAL.has(cls)) return p;
    nearest ??= p;
  }
  return nearest;
}

export function ancestorWithClass(o: THREE.Object3D, cls: string): THREE.Object3D | null {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.ownClass === cls) return p;
  return null;
}
