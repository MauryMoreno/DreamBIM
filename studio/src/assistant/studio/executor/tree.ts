import type { ComposedNode } from '../../../ifcx/types';
import { classCode, displayName } from '../../../ifcx/names';
import { cut } from './args';

export const STRUCTURE = new Set(['IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey']);

// --- Árbol -------------------------------------------------------------------------------------
export function walk(root: ComposedNode, visit: (n: ComposedNode) => void): void {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop() as ComposedNode;
    visit(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
}

export const isElement = (n: ComposedNode): boolean => {
  const c = classCode(n);
  return c !== null && !STRUCTURE.has(c);
};

export function levelOf(n: ComposedNode): string | null {
  for (let p = n.parent; p; p = p.parent) if (classCode(p) === 'IfcBuildingStorey') return displayName(p);
  return null;
}

/** What the user sees as a name: that of the node, the one Studio shows and the IFC Name. */
export const labels = (n: ComposedNode): string[] => {
  const ifcName = n.attributes['bsi::ifc::prop::Name'];
  return [n.name, displayName(n), ...(typeof ifcName === 'string' ? [ifcName] : [])];
};

export const summary = (n: ComposedNode) => ({
  path: cut(n.path),
  name: cut(displayName(n)),
  ifc_class: classCode(n),
  level: levelOf(n),
});
