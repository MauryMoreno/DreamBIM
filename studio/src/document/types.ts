import type { IfcxFile } from '../ifcx/types';
import type { StackRow } from '../composer/rows';
import type { StageData } from '../composer/stagepanel';
import type { LoadedModel } from '../model/load';
import type { SaveChoice } from '../shell/dialog';
import type { ToastKind } from '../shell/toast';
import type { PlaceSummary } from '../modeling/place';
import type { StairSummary } from '../modeling/stairplace';
import type { ClassTableRef } from '../classification/system';
import type { EditError, EditSession } from '../modeling/session';

/** Text of the warning when an edit is rejected. */
export const EDIT_ERROR_TEXT: Record<EditError, string> = {
  'empty-name': 'A level needs a name',
  'duplicate-name': 'Another level already has that name',
  'wall-height': 'Wall top is below its base',
  'bad-number': 'Enter a valid number',
  opening: 'The piece does not fit there in its wall',
  stair: 'The stair does not fit there',
  unknown: 'That element no longer exists',
};

/** What the controller uses from the workspace. */
export interface DocWorkspace {
  setModel(m: LoadedModel | null): void;
  updateModel(m: LoadedModel): void;
  /** `tools`: draw Studio walls, floors and levels (by default, the same as `on`). */
  setEditable(on: boolean, tools?: boolean): void;
  setDirty(on: boolean): void;
  /** The costs or the schedule changed without changing the model: the active mode repaints. Optional. */
  dataChanged?(): void;
  showPlan(): void;
  /**
   * Layer panel stack (null without a document) and Stage data. Optional: minimal workspaces
   * omit it.
   */
  setComposer?(rows: StackRow[] | null, stage: StageData): void;
}

export interface ControllerDeps {
  ws: DocWorkspace;
  pickSavePath(suggested: string): Promise<string | null>;
  askSaveChanges(name: string): Promise<SaveChoice>;
  toast(message: string, kind?: ToastKind): void;
  /** Adds the saved document to the recent list (with a thumbnail). */
  remember(m: LoadedModel): Promise<void>;
  /** Model the viewer paints from the session (only the document). Defaults to sessionModel. */
  buildModel?(s: EditSession): Promise<LoadedModel>;
  /** Reads a linked file (absolute path). */
  readText(absPath: string): Promise<string>;
  /** Writes a text (the materials file). Without this, materials are not saved. */
  writeText?(absPath: string, text: string): Promise<void>;
  /** Does the file exist? Without this, the materials file is not looked for on open. */
  exists?(absPath: string): Promise<boolean>;
  /**
   * Parses a linked file (in a worker, with the packed meshes). Rejects with
   * 'Not a valid IFCX file: …'. If missing, it is parsed on the main thread with parseLayer.
   */
  parseLinked?(text: string): Promise<IfcxFile>;
  /** The classification tables of the tables folder, each with its file. Without this, tables are not imported. */
  classTables?(): Promise<readonly ClassTableRef[]>;
  /** Asks with `ok` / Cancel; true if accepted. */
  confirm(message: string, ok: string): Promise<boolean>;
  /** The history changed: what the next step undoes and redoes (null if none). */
  onHistory?(h: { undo: string | null; redo: string | null }): void;
  /** The user tried to edit while the Assistant is working (see `setUserLock`). */
  onLocked?(): void;
}

/** What an Assistant placement returns: the card summary and the new ids. */
export interface PlaceResult {
  summary: PlaceSummary;
  ids: string[];
}

/** What an Assistant stair request returns. */
export interface StairPlaceResult {
  summary: StairSummary;
  ids: string[];
}
