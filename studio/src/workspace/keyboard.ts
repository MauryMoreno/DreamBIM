import type { Toggle } from './constants';
import { onWindow, type WorkspaceContext } from './context';
import { isTyping } from './layout';
import type { SelectionController } from './selection';
import type { FloorController } from './tools/floor-sketch';
import type { WallController } from './tools/wall';

export interface KeyboardDeps {
  host: HTMLElement;
  toggleAssistant(): void;
  toggleFocus(): void;
  toggleWalk(): void;
  setToggle(t: Toggle, on: boolean): void;
  floor: FloorController;
  wall: WallController;
  selection: SelectionController;
}

/** Global keyboard shortcuts: the Assistant and panes (Ctrl+Shift) and the ones of the web viewer. */
export function mountKeyboard(ctx: WorkspaceContext, deps: KeyboardDeps): void {
  const { host } = deps;
  const { layout, state, viewer, ribbon } = ctx;
  const { assistantHost, leftPane, rightPane, bottomPane } = layout;

  // Assistant and panes: Ctrl+Shift shortcuts
  onWindow(ctx, 'keydown', (e) => {
    if (host.hidden || !host.isConnected || host.closest('[hidden]')) return;
    if (isTyping(e.target) || !e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    let action: (() => void) | null = null;
    if (e.shiftKey && !e.altKey && k === 'a') action = deps.toggleAssistant;
    else if (e.shiftKey && !e.altKey && k === 'f') action = deps.toggleFocus;
    else if (!e.shiftKey && !e.altKey && k === 'f1') action = () => ribbon.setMinimized(!ribbon.minimized);
    else if (!e.shiftKey && e.altKey && k === 'b') action = () => rightPane.toggle();
    else if (!e.shiftKey && !e.altKey && k === 'b') action = () => leftPane.toggle();
    else if (!e.shiftKey && !e.altKey && k === 'j') action = () => bottomPane.toggle();
    if (!action) return;
    e.preventDefault();
    action();
  });

  // Viewer shortcuts (the ones of the web viewer)
  onWindow(ctx, 'keydown', (e) => {
    if (host.hidden || !host.isConnected || host.closest('[hidden]')) return; // only in the workspace
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (assistantHost.contains(e.target as Node)) return; // focus may be on a panel button: not the viewer's
    const k = e.key.toLowerCase();
    // while walking the keyboard belongs to the walker: only P / Esc (mouse released) leave
    if (viewer.walking) {
      if (k === 'p' || (k === 'escape' && !viewer.walkLocked)) {
        viewer.exitWalk();
        ribbon.setPressed('walk', false);
        e.preventDefault();
      }
      return;
    }
    const map: Record<string, () => void> = {
      f: () => viewer.fit(state.selected),
      '1': () => viewer.view('iso'),
      '2': () => viewer.view('top'),
      '3': () => viewer.view('front'),
      '4': () => viewer.view('right'),
      x: () => deps.setToggle('xray', !state.toggles.xray),
      c: () => deps.setToggle('section', !state.toggles.section),
      g: () => deps.setToggle('grid', !state.toggles.grid),
      s: () => deps.setToggle('shadows', !state.toggles.shadows),
      p: () => deps.toggleWalk(),
      escape: () => (deps.floor.active() ? deps.floor.escape() : deps.wall.active() ? deps.wall.escape() : deps.selection.select(null, 'keyboard')),
      delete: () => deps.wall.deleteSelected(),
    };
    const fn = map[k];
    if (fn) {
      fn();
      e.preventDefault();
    }
  });
}
