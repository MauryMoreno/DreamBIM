import { toast } from '../shell/toast';
import type { ModeDef, ModeId } from './definition';
import type { ModeTabs } from './modetabs';
import { placeholderPane } from './placeholder';
import type { Slot } from './slot';

export interface ModeSwitcherOptions {
  modes: ModeDef[];
  /** Slots in order: the first one carries the mode panel and the others stay empty. */
  slots: Slot[];
  ribbon: { showTabs(ids: string[], active: string): void; activeTab(): string };
  tabs?: ModeTabs;
  /** Reason for not letting the user leave the current mode (null: it is allowed). */
  canLeave(): string | null;
  /** Justo antes de salir (cancelar la herramienta Wall). */
  onLeave(from: ModeId): void;
  onChange(id: ModeId): void;
  /** Contenido propio de un modo en el hueco `slot` (se crea la primera vez); null = el marcador. */
  panels?(id: ModeId, slot: number): HTMLElement | null;
  /** Size (px) the mode enters the slot `slot` with the first time; undefined = the one the slot has. */
  sizes?(id: ModeId, slot: number): number | undefined;
  /** After entering a mode (after onChange). */
  onEnter?(id: ModeId): void;
}

/** Switches mode: ribbon, slots and tabs. It does not touch the viewer, the camera or the selection. */
export class ModeSwitcher {
  private id: ModeId = 'model';
  private readonly savedTab = new Map<ModeId, string>();

  constructor(private readonly o: ModeSwitcherOptions) {
    o.tabs?.setActive('model');
  }

  get current(): ModeId {
    return this.id;
  }

  /** false if `canLeave` gave a reason (shown in a toast); true if it was already in that mode or it changed. */
  set(id: ModeId): boolean {
    if (id === this.id) return true;
    const def: ModeDef | undefined = this.o.modes.find((m) => m.id === id);
    if (!def) return false;
    const why = this.o.canLeave();
    if (why) {
      toast(why, 'info');
      this.o.tabs?.setActive(this.id); // the clicked tab does not stay marked
      return false;
    }
    this.savedTab.set(this.id, this.o.ribbon.activeTab());
    this.o.onLeave(this.id);
    this.o.slots.forEach((s, i) =>
      s.show(
        id,
        () => this.o.panels?.(id, i) ?? (i === 0 ? placeholderPane(def) : document.createElement('div')),
        this.o.sizes?.(id, i),
      ),
    );
    this.o.ribbon.showTabs(def.ribbon.map((t) => t.id), this.savedTab.get(id) ?? def.initialTab);
    this.id = id;
    this.o.tabs?.setActive(id);
    this.o.onChange(id);
    this.o.onEnter?.(id);
    return true;
  }
}
