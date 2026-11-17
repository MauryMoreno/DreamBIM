import type { IfcxFile } from '../ifcx/types';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { COLORS_KIND, type ColorsState } from '../colors/state';
import type { ElementColor } from '../render/coloroverride';
import type { SidecarKind } from '../modeling/sidecars';
import type { DocumentContext } from './context';

export class SidecarsService {
  constructor(private readonly ctx: DocumentContext) {}

  /** The document sidecars (colors): how to read and set each one. */
  slots(): { kind: SidecarKind<any>; get(): unknown; set(v: unknown): void }[] {
    return [
      { kind: COLORS_KIND, get: () => this.ctx.state.colorsState, set: (v) => (this.ctx.state.colorsState = v as ColorsState) },
    ];
  }

  /** What the sidecars compose on top of the model. */
  overlays(): IfcxFile[] {
    return this.slots().flatMap((s) => s.kind.overlay?.(s.get()) ?? []);
  }

  /** Saved colors of the open document. */
  get colors(): ColorsState {
    return this.ctx.state.colorsState;
  }

  /** Sets (or with null removes) the color of those elements, by their edit path, in a single step. */
  setColors(editPaths: string[], c: ElementColor | null, label: string): Promise<boolean> {
    return this.sidecarChange(label, () => this.ctx.state.colorsState, (v) => (this.ctx.state.colorsState = v), (cur) => {
      const assign = { ...cur.assign };
      for (const p of editPaths) {
        if (c === null) delete assign[p];
        else assign[p] = c;
      }
      return JSON.stringify(assign) === JSON.stringify(cur.assign) ? cur : { assign };
    });
  }

  /**
   * Queues a change to a sidecar. `change` returns the new state, the same one if there is nothing to
   * change, or a text with the reason for the rejection (it is shown and nothing changes).
   */
  private sidecarChange<T>(label: string, get: () => T, set: (v: T) => void, change: (v: T) => T | string): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    const s = this.ctx.state.current;
    if (!s) {
      this.ctx.d.toast(NOT_EDITABLE, 'info');
      return Promise.resolve(false);
    }
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      if (gen !== this.ctx.state.generation || this.ctx.state.current !== s) return false;
      const next = change(get());
      if (typeof next === 'string') {
        this.ctx.d.toast(next, 'info');
        return false;
      }
      if (next === get()) return true;
      const before = this.ctx.history.snapshot(label);
      set(next);
      s.dirty = true;
      this.ctx.history.commit(before);
      await this.ctx.stack.recompose();
      return true;
    });
  }
}
