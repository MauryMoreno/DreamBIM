// Colores que el Asistente guarda en el modelo: viven en `<modelo>.colors.ifcx` y se componen encima
// como diffuseColor y opacity de IFC. Puro: sin DOM ni visor.
import type { IfcxFile, IfcxNode } from '../ifcx/types';
import type { ElementColor } from '../render/coloroverride';
import type { SidecarKind } from '../modeling/sidecars';

export const K_DIFFUSE = 'bsi::ifc::presentation::diffuseColor';
export const K_OPACITY = 'bsi::ifc::presentation::opacity';

export interface ColorsState {
  /** Key: edit path (`editPath`) of the element. */
  readonly assign: Readonly<Record<string, ElementColor>>;
}

export const EMPTY_COLORS: ColorsState = { assign: {} };

const SIDECAR = '.colors.ifcx';

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number];
}

export function rgbToHex(rgb: number[]): string {
  const h = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

const nodes = (s: ColorsState): IfcxNode[] =>
  Object.entries(s.assign).map(([path, c]) => ({
    path,
    attributes: { [K_DIFFUSE]: hexToRgb(c.color), [K_OPACITY]: c.opacity },
  }));

const fileOf = (id: string, data: IfcxNode[]): IfcxFile => ({
  header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});

export const COLORS_KIND: SidecarKind<ColorsState> = {
  suffix: SIDECAR,
  empty: EMPTY_COLORS,
  isEmpty: (s) => Object.keys(s.assign).length === 0,
  toFile: (s, docName) => fileOf(`studio-colors/${docName}`, nodes(s)),
  fromFile(f) {
    const assign: Record<string, ElementColor> = {};
    for (const n of f.data ?? []) {
      const rgb = n.attributes?.[K_DIFFUSE];
      if (typeof n.path !== 'string' || !Array.isArray(rgb) || rgb.length < 3 || !rgb.every((c) => typeof c === 'number')) continue;
      const op = n.attributes?.[K_OPACITY];
      assign[n.path] = { color: rgbToHex(rgb), opacity: typeof op === 'number' ? op : 1 };
    }
    return Object.keys(assign).length ? { assign } : EMPTY_COLORS;
  },
  overlay: (s) => (Object.keys(s.assign).length ? fileOf('studio-colors/overlay', nodes(s)) : null),
};
