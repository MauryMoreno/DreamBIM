import type { IfcxNode } from '../../ifcx/types';
import type { ComposerLayer } from '../../composer/stack';
import { type Vec2, type WallAxis } from '../footprint';
import { type WallHost } from '../hosting';
import type { StairShape, StairTurn } from '../stairlayout';

export interface LevelParams {
  id: string;
  name: string;
  elevation: number;
}

export interface WallParams extends WallAxis {
  bodyId: string;
  axisId: string;
  /** Base Constraint: the level the wall hangs from (its parent storey). */
  baseLevelId: string;
  baseOffset: number;
  /** Top Constraint: level it is attached to, or null (Unconnected). */
  topLevelId: string | null;
  /** Top Offset: solo cuenta con `topLevelId`. */
  topOffset: number;
  /** Unconnected Height: solo cuenta con `topLevelId` null. */
  height: number;
}

export interface FloorParams {
  id: string;
  bodyId: string;
  /** The level the floor hangs from (its parent storey). */
  levelId: string;
  /** Height Offset From Level: cota de la cara superior respecto al nivel. */
  offset: number;
  thickness: number;
  /** Contorno cerrado en planta, antihorario, sin repetir el primer punto. */
  boundary: Vec2[];
}

/** Escalera generada entre dos niveles consecutivos. */
export interface StairParams {
  id: string;
  baseLevelId: string;
  topLevelId: string;
  shape: StairShape;
  /** Center of the edge of the first step. */
  origin: Vec2;
  /** Rotation of the climbing direction of the first flight, in degrees. */
  angle: number;
  width: number;
  turn?: StairTurn;
}

/**
 * Placement of a linked file: a container node that hangs from any node of the Stage (a
 * elemento del documento o un nodo de otro archivo enlazado).
 */
export interface Placement {
  /** Ruta del nodo contenedor. */
  id: string;
  layerUri: string;
  /** Node it hangs from: a document id or, with `parentLayerUri`, the origin of a node of that layer. */
  parentId: string;
  /** Linked layer that defines the parent; absent if the parent belongs to the document. */
  parentLayerUri?: string;
  /** Roots of the linked file when placed. */
  roots: string[];
  /** Desplazamiento propio del contenedor. */
  offset: [number, number, number];
  /** Giro propio del contenedor en grados (Euler XYZ); ausente = sin giro. */
  rotation?: [number, number, number];
  /** Own scale of the container per axis; absent = 1. */
  scale?: [number, number, number];
  /** Piece hosted in a wall of the document: position, height and opening derive from here. */
  host?: WallHost;
}

/** Composer stack as saved: the layers without id (it is a session one) and the placements. */
export interface ComposerMeta {
  layers: Omit<ComposerLayer, 'id'>[];
  placements: Placement[];
}

export interface StudioDoc {
  ids: { root: string; project: string; site: string; building: string };
  /** In creation order. */
  levels: LevelParams[];
  walls: WallParams[];
  floors: FloorParams[];
  stairs: StairParams[];
  composer: ComposerMeta;
  /** Nodes the document writes as they are, at the end of the file: material overs and their assignments. */
  overs: IfcxNode[];
  /** Own imports of the document (e.g. the materials library), besides the schemas and the layers. */
  imports: string[];
}

/** What `fromIfcx` reports about the reading besides the document. */
export interface ReadInfo {
  /** The saved composer exists but could not be read: it was discarded (and the next Save would lose it). */
  composerDamaged: boolean;
}
