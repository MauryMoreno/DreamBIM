import type { IfcxFile, IfcxNode } from '../ifcx/types';
import type { ComposerLayer, LinkedFiles } from '../composer/stack';
import type { ComposerMeta, StudioDoc } from '../modeling/document';
import { SCHEDULE_KIND, type ScheduleState } from '../schedule/state';
import { K_WORK_SCHEDULE, scheduleFromFile, scheduleToFile } from '../schedule/nodes';
import type { ColorsState } from '../colors/state';
import type { SidecarKind } from '../modeling/sidecars';

/**
 * Snapshot of the editable state before a change: the document (cloned), the stack (copies of each
 * layer; their edit lists are never modified in place, they are replaced) and the read files.
 */
export interface Snapshot {
  label: string;
  version: number;
  doc: StudioDoc | null;
  layers: ComposerLayer[];
  base: ComposerLayer | null;
  files: LinkedFiles;
  libs: Map<string, IfcxFile>;
  schedule: ScheduleState;
  colors: ColorsState;
  /** In a foreign IFCx, the base file (it changes on save, which bakes the edits). */
  source: IfcxFile | null;
}

/** Persistent copy of a layer: without the session id (it shares the edit list). */
/** What a materials change can touch besides the over layer of the document. */
export interface OverEdit {
  overs: IfcxNode[];
  /** Libraries edited in the session, by path (the whole map). */
  libs?: Map<string, IfcxFile>;
  /** Foreign IFCx: its base file changed (imports, or an over already baked in that is removed). */
  source?: IfcxFile;
  /** Studio document: its own imports. */
  docImports?: string[];
}

export type OverResult = IfcxNode[] | string | OverEdit;

/** Where the IFCx file of a library document is: path, import uri and the path of its root. */
export interface LibFile {
  location: string;
  uri: string;
  root: string;
}

/**
 * A datum of the model that lives in its own imported IFCx file (the schedule, the budget): how its
 * root is recognized in the composition, how it is read and written, what the file Studio creates is
 * called and the legacy sidecar it is migrated from.
 */
export interface LibKind<T> {
  /** For the warnings: 'schedule', 'budget'. */
  noun: string;
  /** Attribute carried by the root. */
  marker: string;
  /** Suffix of the new file next to the model: `<model><suffix>`. */
  suffix: string;
  legacy: SidecarKind<T>;
  read(file: IfcxFile): { state: T; root: string } | null;
  write(state: T, o: { root: string; title: string; previous: IfcxFile | null }): IfcxFile;
  /** Warning when the document has no path yet. */
  unsaved: string;
}

export const SCHEDULE_LIB: LibKind<ScheduleState> = {
  noun: 'schedule', marker: K_WORK_SCHEDULE, suffix: '.cronograma.ifcx', legacy: SCHEDULE_KIND,
  read: scheduleFromFile, write: scheduleToFile, unsaved: 'Save the model before planning',
};

export interface LibSlot<T> {
  kind: LibKind<T>;
  get(): T;
  set(v: T): void;
  file: LibFile | null;
}

/** Id of the document layer in the stack (linked layer ids are numbers). */
export const DOCUMENT_LAYER = 'document';

export const persisted = ({ id: _id, ...rest }: ComposerLayer): ComposerMeta['layers'][number] => rest;
