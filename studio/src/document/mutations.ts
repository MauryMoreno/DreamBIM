import { ForeignSession } from '../modeling/foreign';
import type { Vec2 } from '../modeling/footprint';
import type { EditResult, EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { EDIT_ERROR_TEXT } from './types';

export class MutationsService {
  constructor(private readonly ctx: DocumentContext) {}

  /** Session of a Studio document (where walls, floors and levels are drawn); null in a foreign one. */
  studioSession(): EditSession | null {
    return this.ctx.state.current instanceof ForeignSession ? null : this.ctx.state.current;
  }

  /** Queues a change to the current session; if the document changes before it is applied, it is discarded. */
  edit(label: string, change: (s: EditSession) => boolean): void {
    const s = this.studioSession();
    if (!s) return;
    if (this.ctx.lock.userLocked()) return;
    void this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) return;
      const before = this.ctx.history.snapshot(label);
      if (!change(s)) return;
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, s.dirty);
    });
  }

  /**
   * Like `edit`, for changes that can be rejected: the rejection warns with a toast and does not recompose.
   * Resolves true if it was applied (with the model already recomposed).
   */
  editChecked(label: string, change: (s: EditSession) => EditResult): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    return this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) return false;
      const before = this.ctx.history.snapshot(label);
      const r = change(s);
      if (!r.ok) {
        this.ctx.d.toast(EDIT_ERROR_TEXT[r.error], 'error');
        return false;
      }
      // an accepted change that changes nothing (the same value) does not take an undo step
      if (this.ctx.history.changedSince(before)) this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, s.dirty);
      return true;
    });
  }

  /** Creates a floor; resolves to its id with the model already recomposed (null without an editable session or with an invalid boundary). */
  addFloor(boundary: Vec2[], levelId: string): Promise<string | null> {
    const s = this.studioSession();
    if (!s) return Promise.resolve(null);
    if (this.ctx.lock.userLocked()) return Promise.resolve(null);
    return this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) return null;
      const before = this.ctx.history.snapshot('Add Floor');
      const floor = s.addFloor(boundary, levelId);
      if (!floor) return null;
      this.ctx.history.commit(before);
      await this.ctx.stack.refresh(s, s.dirty);
      return floor.id;
    });
  }
}
