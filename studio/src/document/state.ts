import type { IfcxFile } from '../ifcx/types';
import type { ComposerLayer, LinkedFiles } from '../composer/stack';
import type { LoadedModel } from '../model/load';
import { EMPTY_SCHEDULE, type ScheduleState } from '../schedule/state';
import { EMPTY_COLORS, type ColorsState } from '../colors/state';
import type { EditSession } from '../modeling/session';
import { Snapshot, SCHEDULE_LIB, LibSlot } from './shared';

/** Everything the open document keeps: shared by the services through the DocumentContext. */
export class DocumentState {
  current: EditSession | null = null;
  open = false;
  /** Document model without linked files: the base for recomposing when the stack changes. */
  base: LoadedModel | null = null;
  /** Last composed model passed to the workspace (the root of the Stage). */
  shown: LoadedModel | null = null;
  /**
   * Composer stack, from weakest to strongest (the document goes after). It is the authority: in an
   * editable document it is copied to `session.doc.composer.layers` on every change; in a read-only
   * one it lives only here and is not saved.
   */
  layers: ComposerLayer[] = [];
  /** Linked files already read, by uri (null = not found). */
  files: LinkedFiles = new Map();
  /**
   * Loaded payloads, by uri as written. It is session state, as in USD: it is not
   * saved in the document and does not enter undo.
   */
  payloads = new Map<string, IfcxFile>();
  /**
   * An IFCx that is not from Studio opened for editing: the file itself as an internal layer, above
   * the linked ones. Its elements are edited like those of a linked file; it does not appear in Layer.
   */
  baseLayer: ComposerLayer | null = null;
  nextLayerId = 1;
  /**
   * Material libraries the session read for editing, by path: what the composition uses instead
   * of the disk. `libsSaved` is what is written; Save writes the ones that differ.
   */
  libs = new Map<string, IfcxFile>();
  libsSaved = new Map<string, IfcxFile>();
  /** Each library as it was when first touched: what an undo earlier than that moment returns to. */
  libsOrigin = new Map<string, IfcxFile>();
  /** Old sidecars migrated on open, and the document they are next to: they are emptied when it is saved in place. */
  legacyFiles: { doc: string; files: string[] } = { doc: '', files: [] };
  /**
   * Document schedule (calendar and tasks). It lives in an IFCx file with IfcWorkSchedule / IfcTask nodes
   * that the model imports (`<model>.cronograma.ifcx` if Studio creates it); this is the state read from it.
   */
  scheduleState: ScheduleState = EMPTY_SCHEDULE;
  /** The schedule lives in an IFCx file that the model imports (see LibKind). */
  readonly scheduleSlot: LibSlot<ScheduleState> = {
    kind: SCHEDULE_LIB, get: () => this.scheduleState, set: (v) => (this.scheduleState = v), file: null,
  };
  /** Colors the Assistant saves in the model: they live in `<model>.colors.ifcx`. */
  colorsState: ColorsState = EMPTY_COLORS;
  /** Suffixes of the sidecars that already existed on open or save: they are rewritten even if they stay empty. */
  sidecarExisted = new Set<string>();
  /** Fingerprint of the model (without materials) as it is on disk: if it did not change, Save does not rewrite it. */
  modelSaved = '';
  /** Base file of a foreign IFCx as it is on disk (compared by identity: it is large). */
  savedSource: IfcxFile | null = null;
  /** Changes on open, create or close: whatever was in progress for another document is discarded. */
  generation = 0;
  /** Undo and redo: snapshots of the state before each change (the last one on top). */
  undoStack: Snapshot[] = [];
  redoStack: Snapshot[] = [];
  /** Version of the current state: it changes with every change; against the saved one it decides the *. */
  version = 0;
  savedVersion = 0;
  nextVersion = 1;
}
