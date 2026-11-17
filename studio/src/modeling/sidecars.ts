// Sibling files of the document (`Casa.materials.ifcx`, `Casa.costs.ifcx`…): data of the Studio
// modes that are saved separately so as not to rewrite the model file.
import type { IfcxFile } from '../ifcx/types';

export interface SidecarKind<T> {
  /** Sufijo del archivo: '.materials.ifcx', '.costs.ifcx'. */
  suffix: string;
  empty: T;
  isEmpty(v: T): boolean;
  toFile(v: T, docName: string): IfcxFile;
  /** Lee un archivo; ignora lo que no entiende. */
  fromFile(f: IfcxFile): T;
  /** What is composed on top of the model (null or undefined = nothing). */
  overlay?(v: T): IfcxFile | null;
}

/** `Casa.ifcx` → `Casa<suffix>`; without the .ifcx extension it is added at the end. */
export function sidecarFor(docPath: string, kind: { suffix: string }): string {
  return docPath.replace(/\.ifcx$/i, '') + kind.suffix;
}
