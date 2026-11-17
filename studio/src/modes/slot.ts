import type { ModeId } from './definition';

const OFF = 'ws-mode-off';

/**
 * A slot of the layout (left column, right column or bottom panel) that alternates its content by mode.
 * Hidden with a class and never with `hidden`, so as not to override the own `hidden` of the children
 * (e.g. the closed Move box or the chosen Layer tab).
 */
export class Slot {
  private readonly contents = new Map<ModeId, HTMLElement[]>();
  private readonly sizes = new Map<ModeId, string>();
  private current: ModeId = 'model';

  /** The children `host` has when it is built are the content of Model. */
  constructor(private readonly host: HTMLElement) {
    this.contents.set('model', [...host.children] as HTMLElement[]);
  }

  /**
   * Shows the content of `mode`; `make` creates it the first time (only for modes other than model).
   * `initialPx`: size the mode enters with the first time (afterwards the one the user leaves applies).
   */
  show(mode: ModeId, make: () => HTMLElement, initialPx?: number): void {
    if (mode === this.current) return;
    this.sizes.set(this.current, this.host.style.flex);
    if (!this.contents.has(mode)) {
      const el = make();
      this.host.append(el);
      this.contents.set(mode, [el]);
    }
    for (const [m, els] of this.contents) for (const el of els) el.classList.toggle(OFF, m !== mode);
    const size = this.sizes.get(mode);
    if (size) this.host.style.flex = size;
    else if (initialPx !== undefined) this.host.style.flex = `0 0 ${initialPx}px`;
    this.current = mode;
  }
}
