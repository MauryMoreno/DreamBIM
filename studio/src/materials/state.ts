// Definition of a material as the panel shows it. A material is an IFCX node (see nodes.ts); this
// file only keeps the shape of the definition and the reading of the auxiliary file of previous versions.
import type { IfcxFile } from '../ifcx/types';

export interface MaterialDef {
  name: string;
  /** Identificador estable; es el `code` de `bsi::ifc::material`. */
  code: string;
  /** '#rrggbb' */
  color: string;
  /** 0–1 */
  opacity: number;
  description?: string;
  uri?: string;
  /** kg/m³ */
  density?: number;
  /** Color image of the material (`gltf::material`). `width`/`height`: meters covered by one repeat. */
  texture?: MaterialTexture;
}

export interface MaterialTexture {
  /** URL o data URI de la imagen. */
  image: string;
  width: number;
  height: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Assignments (edit path → code) of a `*.materials.ifcx` file of previous versions. The
 * definiciones y sus colores se ignoran: el material es un nodo IFCX. Lo que no entiende se salta.
 */
export function readLegacySidecar(file: IfcxFile): Record<string, string> {
  const assign: Record<string, string> = {};
  for (const n of file.data ?? []) {
    const m = n.attributes?.['bsi::ifc::material'];
    if (isObject(m) && typeof m.code === 'string' && typeof n.path === 'string') assign[n.path] = m.code;
  }
  return assign;
}
