// Lo que el agente puede pedirle a Studio. El ejecutor (executor.ts) solo conoce esta interfaz; la
// real implementation is in live-host.ts, and the tests use a fake one.
import type { ComposedNode } from '../../ifcx/types';
import type { CardInfo } from '../../collection/cardinfo';
import type { ElementColor } from '../../render/coloroverride';
import type { MaterialDef } from '../../materials/state';
import type { ElementProvenance } from './provenance';
import type { BuildCounts, BuildRequest } from '../../modeling/build';
import type { PlaceRequest } from '../../modeling/place';
import type { PlaceResult, StairPlaceResult } from '../../document/controller';
import type { Review, ReviewOptions } from '../../modeling/egress';
import type { Plan, PlanReview } from '../../modeling/planreview';
import type { SpotResult } from '../../modeling/stairspots';
import type { StairRequest } from '../../modeling/stairplace';
import type { StairShape } from '../../modeling/stairlayout';

export type Toggle = 'xray' | 'section' | 'shadows' | 'grid';

export type ViewRequest =
  | { kind: '3d' }
  | { kind: 'plan'; level: string | null }
  | { kind: 'elevation'; side: 'front' | 'side' };

export interface ModelSnapshot {
  name: string;
  path: string | null;
  /** Hay cambios sin guardar. */
  dirty: boolean;
  /** `studio`: documento propio; `foreign`: archivo ajeno editable; `readonly`: solo lectura. */
  editable: 'studio' | 'foreign' | 'readonly';
  root: ComposedNode;
}

export interface LayerSummary {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
  hidden: boolean;
}

export interface StudioHost {
  /** El modelo abierto, o null si no hay ninguno. */
  model(): ModelSnapshot | null;
  levels(): { name: string; elevation: number; path: string }[];
  /** Paths of the selection, in order; the last one is the main one. */
  selection(): string[];
  select(path: string | null): void;
  selectMany(paths: string[]): void;
  /** Procedencia de un elemento por su ruta compuesta; null si no existe. */
  provenance(path: string): ElementProvenance | null;
  /** Color temporal en la vista (no toca el modelo); acumula por ruta. */
  highlight(paths: string[], c: ElementColor): void;
  /** Sin `paths` quita todo el resaltado; con `paths`, solo el de esas rutas. */
  clearHighlight(paths?: string[]): void;
  openView(v: ViewRequest): void;
  fit(path: string | null): void;
  setToggle(name: Toggle, on: boolean): void;
  layers(): LayerSummary[];
  /** false si la capa no existe. */
  setLayerHidden(id: string, hidden: boolean): boolean;
  /** PNG with the longest side at most `maxSize`; null if there is no open view. */
  screenshot(maxSize: number): Promise<{ dataUrl: string; width: number; height: number } | null>;
  /** Carpeta abierta en el panel Library. */
  libraryFolder(): string | null;
  searchLibrary(query: string, limit: number): Promise<{ path: string; name: string }[]>;
  cardInfo(path: string): Promise<CardInfo | null>;
  /** Rechaza con un Error cuyo mensaje se devuelve tal cual al agente. */
  openModel(path: string): Promise<void>;
  /** Catalog of materials with the number of elements each one uses. */
  materials(): { code: string; name: string; color: string; opacity: number; elements: number }[];
  /**
   * Las tres escrituras reciben rutas compuestas, son un solo paso de Ctrl+Z y rechazan con un Error
   * cuyo mensaje se devuelve tal cual al agente. `c` null quita el color guardado.
   */
  setColor(paths: string[], c: ElementColor | null): Promise<void>;
  assignMaterial(paths: string[], code: string | null): Promise<void>;
  createMaterial(def: MaterialDef): Promise<void>;
  /** Construye el edificio entero como un solo paso de Ctrl+Z. */
  buildModel(req: BuildRequest): Promise<BuildCounts>;
  /**
   * Coloca puertas, ventanas y mobiliario como un solo paso de Ctrl+Z. `WallPiece.wall` es la ruta
   * compuesta del muro. Con `dryRun` solo valida y resume.
   */
  placePieces(req: PlaceRequest, dryRun: boolean): Promise<PlaceResult>;
  /** Valid sites for a stair between two levels (read). */
  stairSpots(q: { from: string; to: string; shape: StairShape; width: number; limit: number }): SpotResult;
  /** Crea escaleras con barandas y hueco en un solo paso; con `dryRun` solo valida y resume. */
  placeStairs(req: StairRequest, dryRun: boolean): Promise<StairPlaceResult>;
  /** Deletes Studio walls, floors, stairs and placed pieces by their composed path; it returns how many. */
  deleteElements(paths: string[]): Promise<number>;
  /** Revisa un plan entero sobre un documento de trabajo, sin documento abierto ni cambios. */
  reviewPlan(plan: Plan): Promise<PlanReview>;
  /** Runs the review on the open Studio model. */
  reviewModel(opts: ReviewOptions): Promise<Review>;
}

/**
 * The part of `StudioHost` that the workspace implements (`ws.agent`). The capture goes at size
 * completo y como data URL: reducirla y medirla es cosa de live-host.ts.
 */
export type WorkspaceAgentApi = Pick<
  StudioHost,
  | 'levels' | 'selection' | 'select' | 'selectMany' | 'openView' | 'fit' | 'setToggle' | 'layers' | 'setLayerHidden' | 'libraryFolder'
  | 'highlight' | 'clearHighlight' | 'provenance' | 'materials'
> & {
  model(): { name: string; path: string | null; root: ComposedNode } | null;
  /** PNG of the open view at full size, or null if there is no view. */
  screenshot(): string | null;
};
