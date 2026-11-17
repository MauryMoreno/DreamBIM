import { ForeignSession } from '../modeling/foreign';
import type { DocumentContext } from './context';
import { Snapshot } from './shared';

/** Steps the undo history keeps. */
export const UNDO_LIMIT = 100;

export class HistoryService {
  constructor(private readonly ctx: DocumentContext) {}

  /** What the next step undoes and redoes (null if none). */
  get history(): { undo: string | null; redo: string | null } {
    return { undo: this.ctx.state.undoStack.at(-1)?.label ?? null, redo: this.ctx.state.redoStack.at(-1)?.label ?? null };
  }

  snapshot(label: string): Snapshot {
    const s = this.ctx.state.current;
    return {
      label,
      version: this.ctx.state.version,
      doc: s ? structuredClone(s.doc) : null,
      layers: this.ctx.state.layers.map((l) => ({ ...l })),
      base: this.ctx.state.baseLayer ? { ...this.ctx.state.baseLayer } : null,
      files: new Map(this.ctx.state.files),
      libs: this.ctx.state.libs,
      schedule: this.ctx.state.scheduleState,
      colors: this.ctx.state.colorsState,
      source: s instanceof ForeignSession ? s.source : null,
    };
  }

  /** Did the document change since the snapshot? (so an accepted change that changes nothing is not stacked) */
  changedSince(snap: Snapshot): boolean {
    return JSON.stringify(this.ctx.state.current?.doc ?? null) !== JSON.stringify(snap.doc);
  }

  /** Pushes the snapshot from before an already applied change: the current state is a new version. */
  commit(before: Snapshot): void {
    this.ctx.state.undoStack.push(before);
    if (this.ctx.state.undoStack.length > UNDO_LIMIT) this.ctx.state.undoStack.shift();
    this.ctx.state.redoStack = [];
    this.ctx.state.version = this.ctx.state.nextVersion++;
    this.pushHistory();
  }

  /** Returns to the snapshot state (without recomposing: the caller does that). */
  private restore(snap: Snapshot): void {
    const s = this.ctx.state.current;
    this.ctx.state.layers = snap.layers.map((l) => ({ ...l }));
    this.ctx.state.baseLayer = snap.base ? { ...snap.base } : null;
    this.ctx.state.files = new Map(snap.files);
    // a library the snapshot did not know about yet returns to its original content (it may have been saved since then)
    const libs = new Map(snap.libs);
    for (const [path, original] of this.ctx.state.libsOrigin) if (!libs.has(path)) libs.set(path, original);
    this.ctx.state.libs = libs;
    this.ctx.state.scheduleState = snap.schedule;
    this.ctx.state.colorsState = snap.colors;
    if (s && snap.doc) {
      s.doc = structuredClone(snap.doc);
      if (s instanceof ForeignSession && snap.source) s.source = snap.source;
      this.ctx.stack.writeMeta(s);
    }
    this.ctx.state.version = snap.version;
    if (s) s.dirty = this.ctx.state.version !== this.ctx.state.savedVersion;
  }

  /**
   * Merges into one step, with that label, what was stacked after `mark` (the last step that existed before):
   * the oldest snapshot is kept, which undoes the whole group.
   */
  mergeHistory(mark: Snapshot | undefined, label: string): void {
    const from = mark ? this.ctx.state.undoStack.indexOf(mark) + 1 : 0;
    if (mark && from === 0) return; // the previous step already left the history: it is not grouped
    if (this.ctx.state.undoStack.length <= from) return;
    this.ctx.state.undoStack[from].label = label;
    this.ctx.state.undoStack.splice(from + 1);
    this.pushHistory();
  }

  pushHistory(): void {
    this.ctx.d.onHistory?.(this.history);
  }

  /** Undoes the last change. false if there is nothing to undo. */
  undo(): Promise<boolean> {
    return this.step(this.ctx.state.undoStack, this.ctx.state.redoStack);
  }

  /** Redoes the last undone change. false if there is nothing to redo. */
  redo(): Promise<boolean> {
    return this.step(this.ctx.state.redoStack, this.ctx.state.undoStack);
  }

  /** Takes a snapshot out of `from`, pushes the current state into `to` (with the same label) and applies it. */
  private step(from: Snapshot[], to: Snapshot[]): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      const snap = from.at(-1);
      if (gen !== this.ctx.state.generation || !snap) return false;
      from.pop();
      to.push(this.snapshot(snap.label));
      this.restore(snap);
      this.pushHistory();
      const s = this.ctx.state.current;
      if (s) await this.ctx.stack.refresh(s, s.dirty);
      else await this.ctx.stack.recompose();
      return true;
    });
  }
}
