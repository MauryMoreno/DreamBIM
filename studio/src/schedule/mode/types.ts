import type { Viewer } from '../../render/viewer';
import type { MaterialDef } from '../../materials/state';
import type { LoadedModel } from '../../model/load';
import { type ScheduleState } from '../state';

export type FutureStyle = 'hidden' | 'ghost';

/** Lo que el modo pide al controlador (main.ts lo conecta a `doc.*`). */
export interface ScheduleActions {
  state(): ScheduleState;
  /** Cambio del cronograma con su etiqueta de deshacer (`doc.changeSchedule`). */
  change(label: string, change: (s: ScheduleState) => ScheduleState | string): Promise<boolean>;
  materials(): readonly MaterialDef[];
  confirm(message: string, ok: string): Promise<boolean>;
  /** Elige un cronograma de MS Project (.xml) o Primavera (.xer) y lo lee; null si se cancela. */
  importFile?(): Promise<{ name: string; text: string } | null>;
  /** Guarda el MS Project XML exportado; devuelve el nombre del archivo, o null si se cancela. */
  exportFile?(suggested: string, text: string): Promise<string | null>;
}

export interface ScheduleModeDeps {
  actions: ScheduleActions;
  viewer: Pick<Viewer, 'quantities' | 'setColorOverride' | 'selectMany'>;
  model(): LoadedModel | null;
  /** Ruta compuesta del elemento seleccionado. */
  selected(): string | null;
  /** Rutas compuestas de todo lo seleccionado (si falta, solo cuenta `selected`). */
  selection?(): string[];
  wallLength(path: string): number | null;
  /** Elements the mode hides (added to those of the Stage and the layers). */
  setHidden(paths: Set<string>): void;
  /** While elements are chosen in the model: only the 3d is active (the rest of the window, inert and dimmed). */
  setPicking?(on: boolean): void;
  timer?: { every(ms: number, fn: () => void): () => void };
  toast(message: string, kind?: 'info' | 'error'): void;
  editable: boolean;
}

export interface ScheduleMode {
  /** Contenido de cada hueco: 0 = fases (izquierda), 1 = Task (derecha), 2 = Gantt (abajo). */
  panel(slot: number): HTMLElement | null;
  /** The date bar, for the view bar (hidden outside the mode). */
  readonly dateBar: HTMLElement;
  /** The date of the chosen day, to place it over the model. */
  readonly dateOverlay: HTMLElement;
  enter(): void;
  leave(): void;
  refresh(): void;
  selectionChanged(path: string | null): void;
  newTask(): Promise<void>;
  editTask(): Promise<void>;
  deleteTask(): Promise<void>;
  linkSelection(): void;
  tasksByLevel(): Promise<void>;
  editCalendar(): Promise<void>;
  setFuture(v: FutureStyle): void;
  /** Paints the critical path in the Gantt. */
  setCritical(on: boolean): void;
  /** Saves the current dates as the baseline. */
  setBaseline(): Promise<void>;
  importSchedule(): Promise<void>;
  exportSchedule(): Promise<void>;
  /** Fecha del deslizador. */
  readonly day: string | null;
  setEditable(on: boolean): void;
}
