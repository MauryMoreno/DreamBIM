// The cost assignment layer (`<model>.costos-asignacion.ifcx`): one node per element that inherits the node of its
// code (`inherits.costos`). This way the model stays geometry only and the code of each element lives in its layer,
// like the materials. Pure: it receives and returns files without mutating them (the same file = nothing to change).
import type { IfcxFile, IfcxNode } from '../ifcx/types';

/** Key of `inherits` with which an element references its cost code. */
export const INHERIT_COSTS = 'costos';

/** An empty assignment file. */
export function emptyAssignment(id: string): IfcxFile {
  return {
    header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'Dream BIM', timestamp: new Date().toISOString() },
    imports: [],
    schemas: {},
    data: [],
  };
}

/** Gives those elements (edit paths) the inheritance of the node `codePath`, or with null removes it. */
export function assignCost(file: IfcxFile, editPaths: string[], codePath: string | null): IfcxFile {
  const data = [...file.data];
  let changed = false;
  for (const path of new Set(editPaths)) {
    const at = data.findIndex((n) => n.path === path);
    const prev: IfcxNode | undefined = at >= 0 ? data[at] : undefined;
    if ((prev?.inherits?.[INHERIT_COSTS] ?? null) === codePath) continue;
    changed = true;
    const inherits: Record<string, string | null> = { ...prev?.inherits };
    if (codePath === null) delete inherits[INHERIT_COSTS];
    else inherits[INHERIT_COSTS] = codePath;
    const { inherits: _old, ...rest } = prev ?? { path };
    const next: IfcxNode = { ...rest, ...(Object.keys(inherits).length ? { inherits } : {}) };
    // un nodo que se queda sin nada que decir sobra
    const empty = Object.keys(next).length === 1;
    if (at >= 0) {
      if (empty) data.splice(at, 1);
      else data[at] = next;
    } else if (!empty) data.push(next);
  }
  return changed ? { ...file, data } : file;
}
