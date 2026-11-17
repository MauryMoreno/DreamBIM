// Pure view-tab logic (no DOM): which views are open, which one is active and the camera each
// one had when it was left.
import type { CameraState, LevelInfo } from '../render/levels';
import type { VisualStyle } from '../render/styles';
import { viewLabel, type ViewRef } from '../browser/views';

interface Tab {
  id: string;
  view: ViewRef;
  camera: CameraState | null;
  style: VisualStyle;
}

/** Style a view opens with: Hidden Line in plans (like Revit), Shaded in the rest. */
const defaultStyle = (v: ViewRef): VisualStyle => (v.kind === 'plan' ? 'hidden' : 'shaded');

/** Stable identifier of a view: opening the same view twice gives the same id. */
export function viewId(v: ViewRef): string {
  switch (v.kind) {
    case '3d':
      return '3d';
    case 'plan':
      return `plan:${v.level.path}`;
    case 'elevation':
      return `elevation:${v.side}`;
  }
}

export class ViewTabs {
  private tabs: Tab[] = [];
  private activeId: string | null = null;

  /** Opens the view (or activates it if it was already open) and returns its id. */
  open(v: ViewRef): string {
    const id = viewId(v);
    if (!this.find(id)) this.tabs.push({ id, view: v, camera: null, style: defaultStyle(v) });
    this.activeId = id;
    return id;
  }

  /** Closing the active one activates the one to its left (or the new first one). */
  close(id: string): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.activeId !== id) return;
    this.activeId = this.tabs.length ? this.tabs[Math.max(i - 1, 0)].id : null;
  }

  activate(id: string): void {
    if (this.find(id)) this.activeId = id;
  }

  /** Closes all of them (when the model changes). */
  clear(): void {
    this.tabs = [];
    this.activeId = null;
  }

  get active(): { id: string; view: ViewRef; camera: CameraState | null; style: VisualStyle } | null {
    const t = this.activeId ? this.find(this.activeId) : undefined;
    return t ? { id: t.id, view: t.view, camera: t.camera, style: t.style } : null;
  }

  /** Visual style of a view (the view bar's Visual Style). */
  setStyle(id: string, style: VisualStyle): void {
    const t = this.find(id);
    if (t) t.style = style;
  }

  saveCamera(id: string, s: CameraState): void {
    const t = this.find(id);
    if (t) t.camera = s;
  }

  /** Updates name and elevations of the open plans (a level was renamed or moved); the id does not change. */
  refreshLevels(levels: LevelInfo[]): void {
    for (const t of this.tabs) {
      if (t.view.kind !== 'plan') continue;
      const path = t.view.level.path;
      const level = levels.find((l) => l.path === path);
      if (level) t.view = { kind: 'plan', level };
    }
  }

  /** Open views, in tab order. */
  openViews(): ViewRef[] {
    return this.tabs.map((t) => t.view);
  }

  list(): { id: string; label: string; active: boolean }[] {
    return this.tabs.map((t) => ({ id: t.id, label: viewLabel(t.view), active: t.id === this.activeId }));
  }

  private find(id: string): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }
}
