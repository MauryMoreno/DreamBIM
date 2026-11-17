import type { ComposedNode } from '../../ifcx/types';

export type EditMark = 'moved' | 'relocated' | 'edited';

export interface StageData {
  root: ComposedNode | null;
  /** origin -> 'document' | layer id (the strongest layer that defines the element). */
  sourceOf: Map<string, string>;
  /** id de capa o 'document' -> '#rrggbb'. */
  colors: Map<string, string>;
  /** origin -> marcas. */
  marks: Map<string, EditMark[]>;
}

/** Paths of the composed tree of the dragged instance and of the new parent. */
export interface ReparentAt {
  node: string;
  parent: string;
}

export interface StageCallbacks {
  /**
   * Clic en una fila. `path` es la ruta compuesta de esa fila: un elemento reutilizado sale varias
   * times with the same origin, and each instance is selected (and edited) by its path.
   */
  onSelect(origin: string, path: string, toggle: boolean): void;
  /** Doble clic: encuadra el elemento (la instancia de `path`). */
  onFit?(origin: string, path: string): void;
  /**
   * Arrastrar una fila sobre otra de su misma capa de origen: cambiarle el padre. `at` identifica la
   * instancia exacta (un elemento reutilizado sale varias veces); quien solo mire los origins puede
   * ignorarlo y usar la primera instancia. `at.layer` es la capa de origen de los dos (id de capa).
   */
  onReparent?(origin: string, newParentOrigin: string, at: ReparentAt & { layer: string }): void;
  /** A row of the Layer panel is dropped on the project or a level of the document: place that file. */
  onPlace?(layerId: string, parentOrigin: string): void;
  /** A library card is dropped on the project or a level: link and place that file. */
  onPlaceAsset?(path: string, parentOrigin: string): void;
  /** Does the document admit placing files? (not in read-only); without this, always. */
  canPlace?(): boolean;
  /**
   * The composed paths hidden with the eye changed (each one also hides what hangs from it).
   * Es de la vista: no se guarda en el documento.
   */
  onHiddenChange?(hidden: ReadonlySet<string>): void;
}

export interface StagePanel {
  setStage(data: StageData): void;
  /** Despliega hasta la fila de esa ruta compuesta y la resalta (null: ninguna). */
  reveal(path: string | null): void;
  /** Marks the rows of a multiple selection (the main one is marked with `reveal`). */
  markSelected(paths: string[]): void;
}
