import { ForeignSession } from '../modeling/foreign';
import type { DocumentContext } from './context';

export class EditLock {
  constructor(private readonly ctx: DocumentContext) {}

  /** While the Assistant works, the user cannot edit, undo or save (see `setUserLock`). */
  userLock = false;

  /** true while an Assistant call runs: it goes through the user lock. */
  private agentCall = false;

  /**
   * Locks (or restores) user editing during an Assistant turn, so the two do not
   * step on the session or the history. Looking, orbiting and changing the view remain free.
   */
  setUserLock(on: boolean): void {
    if (this.userLock === on) return;
    this.userLock = on;
    if (on) this.ctx.d.ws.setEditable(false);
    else if (this.ctx.state.open) this.applyEditable();
  }

  /**
   * Runs `fn` as the Assistant: its edits go through the user lock. The lock
   * check is synchronous and happens before queuing, so a flag around the call is enough.
   */
  asAgent<T>(fn: () => T): T {
    const was = this.agentCall;
    this.agentCall = true;
    try {
      return fn();
    } finally {
      this.agentCall = was;
    }
  }

  /** true (and warns) if the lock prevents the user from editing now. */
  userLocked(): boolean {
    if (!this.userLock || this.agentCall) return false;
    this.ctx.d.onLocked?.();
    return true;
  }

  /** The editing that corresponds to the open session: none in read-only; in a foreign IFCx, without drawing. */
  applyEditable(): void {
    const session = this.ctx.state.current;
    // in an IFCx that is not from Studio you edit what it contains, but walls, floors and levels are not drawn
    this.ctx.d.ws.setEditable(session !== null, session !== null && !(session instanceof ForeignSession));
  }
}
