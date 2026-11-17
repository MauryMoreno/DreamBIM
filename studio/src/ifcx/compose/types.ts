import type { ComposedNode, IfcxFile, IfcxPayload, IfcxSchema, Provenance, ProvenanceSource } from '../types';

export interface FlatNode {
  path: string;
  /** null = eliminar un hijo heredado */
  children: Record<string, string | null>;
  inherits: Record<string, string>;
  /** null = eliminar un atributo heredado */
  attributes: Record<string, unknown>;
  /** set -> option -> path */
  variants: Record<string, Record<string, string>>;
  variantSelection: Record<string, string>;
  payloads: Record<string, IfcxPayload>;
}

/** Values that an applied variant replaced (undefined = there were none), to undo it. */
export interface Undo {
  children: [string, WorkNode | undefined][];
  attributes: [string, unknown][];
}

export interface VariantSet {
  /** En orden: la primera es la de defecto. */
  options: Map<string, string>;
  selected: string | null;
  /** null = sin aplicar. */
  applied: Undo | null;
}

export interface WorkNode {
  origin: string;
  attributes: Map<string, unknown>;
  children: Map<string, WorkNode>;
  variants: Map<string, VariantSet>;
  payloads: Map<string, IfcxPayload>;
  /** Payloads ya compuestos en el nodo. */
  loaded: Set<string>;
}

export const emptyWork = (origin: string): WorkNode => ({
  origin, attributes: new Map(), children: new Map(), variants: new Map(), payloads: new Map(), loaded: new Set(),
});

export interface ComposeOptions {
  /** Files of the loaded payloads, by the identity they were loaded under. */
  payloads?: ReadonlyMap<string, IfcxFile>;
  /**
   * Identity a payload is loaded under. `fileIndex` indexes the layers (the payload files that go
   * first are numbered from -1 downwards); without it the identity is the declared uri.
   */
  payloadKey?: (uri: string, fileIndex: number) => string;
  /** Procedencia de cada capa, en paralelo a `layers`; si la longitud no coincide se ignora. */
  sources?: readonly ProvenanceSource[];
}

export interface ComposeResult {
  root: ComposedNode;
  schemas: Record<string, IfcxSchema>;
  warnings: string[];
  /** origin (UUID) -> tree nodes that instantiate it */
  byOrigin: Map<string, ComposedNode[]>;
  /** tree path -> node */
  byPath: Map<string, ComposedNode>;
  provenance: Provenance;
}
