// Tipos del formato IFCX (IFC5 alpha). Basados en schema/ifcx.tsp de la referencia.

export type DataType =
  | 'Real' | 'Boolean' | 'Integer' | 'String' | 'DateTime'
  | 'Enum' | 'Array' | 'Object' | 'Reference' | 'Blob';

export interface IfcxValueDescription {
  dataType: DataType;
  optional?: boolean;
  inherits?: string[];
  quantityKind?: string;
  enumRestrictions?: { options: string[] };
  arrayRestrictions?: { min?: number; max?: number; value: IfcxValueDescription };
  objectRestrictions?: { values: Record<string, IfcxValueDescription> };
}

export interface IfcxSchema {
  uri?: string;
  value: IfcxValueDescription;
}

export interface IfcxHeader {
  id: string;
  ifcxVersion: string;
  dataVersion: string;
  author: string;
  timestamp: string;
}

export interface IfcxNode {
  path: string;
  children?: Record<string, string | null>;
  inherits?: Record<string, string | null>;
  attributes?: Record<string, unknown>;
  /** Variant sets: set -> option -> path that is composed as an inheritance. The first option is the default one. */
  variants?: Record<string, Record<string, string>>;
  /** Option chosen per set (on this node or on an instance, e.g. "P/d1"). */
  variantSelection?: Record<string, string>;
  /** Payloads: contenido de otro archivo que se compone en este nodo solo si se carga. */
  payloads?: Record<string, IfcxPayload>;
}

export interface IfcxPayload {
  /** Relativa al archivo que la declara. */
  uri: string;
  /** Path of the file composed here; without it, its roots as children. */
  path?: string;
}

export interface IfcxFile {
  header: IfcxHeader;
  imports: { uri: string; integrity?: string }[];
  schemas: Record<string, IfcxSchema>;
  data: IfcxNode[];
}

/** Node of the final composed tree, ready to show and render. */
export interface ComposedNode {
  /** Path of names in the tree, e.g. "/proj/My_Site/My_Building". */
  path: string;
  /** Local name (last segment). */
  name: string;
  /** Identifier (data path) this node comes from, e.g. a UUID. */
  origin: string;
  attributes: Record<string, unknown>;
  children: ComposedNode[];
  parent: ComposedNode | null;
  /** Conjuntos de variantes del nodo, con sus opciones y la elegida. */
  variantSets?: Record<string, { options: string[]; selected: string | null }>;
  /** Payloads declared on the node and whether they are loaded. */
  payloads?: Record<string, IfcxPayload & { loaded: boolean }>;
}

/** Which file an element of the stack comes from: a layer, an import or a payload. */
export interface ProvenanceSource {
  role: 'layer' | 'import' | 'payload';
  /** To show if there is no location: Layer.name, or the declared uri. */
  name: string;
  /** Uri tal como se declara (imports y payloads); null en capas. */
  uri: string | null;
  /** Where it was resolved (absolute path or url); missing if unknown (unsaved document, edits, overlays). */
  location?: string;
  /** Layer.id, solo con role 'layer'. */
  layerId?: string;
}

/** Where a composed attribute comes from: written at a path, or inherited through a chain of inherits. */
export type AttributeOrigin =
  | { kind: 'local'; path: string; source: ProvenanceSource; overrides?: AttributeOrigin }
  | { kind: 'inherited'; via: string[]; target: string; source: ProvenanceSource };

/** Provenance of a composition; it is queried on demand. */
export interface Provenance {
  /** Sources in federation order (payloads first, then the layers). */
  readonly sources: readonly ProvenanceSource[];
  /** Own inheritances of the data node (FlatNode.inherits): key -> target path. {} if none. */
  inheritsOf(origin: string): Record<string, string>;
  /** Sources that have data for that exact path, from weakest to strongest. [] if none. */
  sourcesOf(path: string): ProvenanceSource[];
  /** Data paths whose own attributes (without inheritance) include `key`, in order of appearance. */
  pathsWith(key: string): string[];
  /** For each own attribute of that path, the strongest source that writes it. {} if the path does not exist. */
  attributeSources(path: string): Record<string, ProvenanceSource>;
  /** Atributos compuestos de una ruta de datos ("uuid" o "uuid/Body"), a demanda; null si no existe. */
  attributesOf(path: string): Record<string, unknown> | null;
  /** Does the data node at `path` write `key` itself with a value that is not null? No inheritance. */
  hasOwn(path: string, key: string): boolean;
  /** On demand, for ONE node: where each composed attribute comes from (Task 3). */
  explain(node: ComposedNode): Record<string, AttributeOrigin>;
}
