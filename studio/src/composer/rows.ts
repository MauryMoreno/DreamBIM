// Rows of the Layers panel: the linked files, from weakest to strongest, and the document at the end.

export type StackRow =
  | {
      kind: 'file';
      id: string;
      name: string;
      /** Ruta absoluta resuelta (tooltip). */
      path: string;
      color: string;
      enabled: boolean;
      /** El archivo no se pudo leer al abrir: se conservan sus ediciones. */
      missing: boolean;
      editCount: number;
      editsEnabled: boolean;
      /** Edit paths whose element no longer exists in the file (orphan edits). */
      orphans: string[];
      /** Node of the document (project or level) the file hangs from; unplaced, absent. */
      placedIn?: string;
      /** Name in the Stage of that node (it may belong to another linked file); null if it is not there. */
      placedInName?: string | null;
    }
  | {
      kind: 'document';
      name: string;
      path: string | null;
      /** Where a linked file can be placed (project and levels); absent in read-only. */
      targets?: PlaceTarget[];
    };

/** Node of the document that can contain a linked file. */
export interface PlaceTarget {
  id: string;
  name: string;
}

/** DataTransfer type with the id of the layer dragged from the Layer panel to the Stage. */
export const LAYER_DRAG_TYPE = 'application/x-ifcx-studio-layer';
