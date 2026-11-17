// Levels of a Studio document: its saved elevation overrides the one the viewer infers from the geometry.
import type { ComposedNode } from '../ifcx/types';
import type { LevelInfo } from '../render/levels';
import { classCode, displayName } from '../ifcx/names';
import { WALL_HEIGHT } from './constants';

/**
 * Corrects `fromViewer` with the IfcBuildingStorey that have `ifcx-studio::level`: those the viewer already
 * brings take the saved elevation and the name of the node (their `maxZ` never goes below what the geometry covers);
 * those without geometry are added. Order: by elevation and, at equal elevation, by creation (tree order).
 * Los storeys sin ese atributo (modelos ajenos) no cambian.
 */
export function withDocumentLevels(root: ComposedNode, fromViewer: LevelInfo[]): LevelInfo[] {
  const propios: LevelInfo[] = []; // Studio levels, in creation order
  const delVisor = new Map(fromViewer.map((l) => [l.path, l]));
  const recorrer = (n: ComposedNode): void => {
    if (classCode(n) === 'IfcBuildingStorey') {
      const elevation = (n.attributes['ifcx-studio::level'] as { elevation?: unknown } | undefined)?.elevation;
      if (typeof elevation === 'number' && Number.isFinite(elevation)) {
        const v = delVisor.get(n.path);
        propios.push({
          path: n.path,
          name: displayName(n),
          minZ: elevation,
          maxZ: v ? Math.max(v.maxZ, elevation) : elevation + WALL_HEIGHT,
        });
      }
    }
    for (const c of n.children) recorrer(c);
  };
  recorrer(root);
  if (!propios.length) return fromViewer;

  const ajenos = fromViewer.filter((l) => !propios.some((p) => p.path === l.path));
  const orden = new Map(propios.map((l, i) => [l.path, i]));
  const rank = (l: LevelInfo) => orden.get(l.path) ?? Infinity;
  return [...ajenos, ...propios].sort(
    (a, b) => a.minZ - b.minZ || rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
