import type { LoadedModel } from '../model/load';
import type { LevelInfo } from '../render/levels';
import type { Toggle } from './constants';
import { loadLevelsStyle, type LevelsStyle } from './levelmarks-geom';

export type WorkspaceStateEvent = 'model' | 'selection' | 'editable' | 'dirty';

type Listener = () => void;

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return false;
}

/** Observable fields of the workspace. Listeners fire once per real change, never for the same value. */
export class WorkspaceState {
  levels: LevelInfo[] = [];
  /** Drawing walls, floors and Studio levels is allowed (not in an IFCx that is not from Studio). */
  tools = false;
  readonly toggles: Record<Toggle, boolean> = { xray: false, section: false, shadows: false, grid: true };
  /** Level style in 3D (View › Graphics › Levels ▾), remembered between sessions. */
  levelsStyle: LevelsStyle = loadLevelsStyle();

  private modelValue: LoadedModel | null = null;
  private selectedValue: string | null = null;
  private selectionValue: string[] = [];
  /** What is highlighted in the viewer (a selected level highlights nothing). */
  private inViewerValue: string | null = null;
  private editableValue = false;
  private dirtyValue = false;

  private readonly listeners: Record<WorkspaceStateEvent, Set<Listener>> = {
    model: new Set(),
    selection: new Set(),
    editable: new Set(),
    dirty: new Set(),
  };

  get model(): LoadedModel | null {
    return this.modelValue;
  }

  set model(value: LoadedModel | null) {
    if (sameValue(this.modelValue, value)) return;
    this.modelValue = value;
    this.notify('model');
  }

  get selected(): string | null {
    return this.selectedValue;
  }

  set selected(value: string | null) {
    if (sameValue(this.selectedValue, value)) return;
    this.selectedValue = value;
    this.notify('selection');
  }

  /** Full selection in order; `selected` is the main one (the last). */
  get selection(): string[] {
    return this.selectionValue;
  }

  set selection(value: string[]) {
    if (sameValue(this.selectionValue, value)) return;
    this.selectionValue = value;
    this.notify('selection');
  }

  get inViewer(): string | null {
    return this.inViewerValue;
  }

  set inViewer(value: string | null) {
    if (sameValue(this.inViewerValue, value)) return;
    this.inViewerValue = value;
    this.notify('selection');
  }

  get editable(): boolean {
    return this.editableValue;
  }

  set editable(value: boolean) {
    if (sameValue(this.editableValue, value)) return;
    this.editableValue = value;
    this.notify('editable');
  }

  get dirty(): boolean {
    return this.dirtyValue;
  }

  set dirty(value: boolean) {
    if (sameValue(this.dirtyValue, value)) return;
    this.dirtyValue = value;
    this.notify('dirty');
  }

  /** Subscribes to a field change; returns the unsubscribe. */
  on(event: WorkspaceStateEvent, fn: Listener): () => void {
    this.listeners[event].add(fn);
    return () => {
      this.listeners[event].delete(fn);
    };
  }

  private notify(event: WorkspaceStateEvent): void {
    for (const fn of [...this.listeners[event]]) fn();
  }
}
