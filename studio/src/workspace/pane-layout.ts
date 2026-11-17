import { loadLayout, saveLayout, type LayoutState } from './layoutstate';
import type { WorkspaceLayout } from './layout';
import type { PaneId } from './types';

interface PaneRibbon {
  readonly minimized: boolean;
  setMinimized(on: boolean): void;
  onMinimizedChange(fn: (on: boolean) => void): void;
}

export interface PaneLayout {
  readonly focused: boolean;
  layoutChanged(on: boolean, persist?: boolean): void;
  setPaneCollapsed(pane: PaneId, on: boolean): void;
  paneCollapsed(pane: PaneId): boolean;
  toggleFocus(): void;
}

/** Collapsible panes, their persisted layout and focus mode, over an already built layout. */
export function createPaneLayout(layout: WorkspaceLayout, ribbon: PaneRibbon): PaneLayout {
  const { root, props, browser, splitH, leftPane, rightPane, bottomPane, assistantPane } = layout;
  let focused = false;
  let restoringLayout = true;
  let layoutBatch = false;
  let focusSnapshot: (LayoutState & { assistant: boolean }) | null = null;
  const currentLayout = (): LayoutState => ({
    left: leftPane.collapsed,
    right: rightPane.collapsed,
    bottom: bottomPane.collapsed,
    props: props.fold.folded,
    browser: browser.fold.folded,
    ribbon: ribbon.minimized,
  });
  const layoutChanged = (on: boolean, persist = true): void => {
    if (restoringLayout || layoutBatch) return;
    // Expanding something by hand leaves focus mode and keeps exactly the state the user sees.
    if (focused && !on) {
      focused = false;
      focusSnapshot = null;
      saveLayout(currentLayout());
      return;
    }
    if (!focused && persist) saveLayout(currentLayout());
  };
  const sectionChanged = (on: boolean): void => {
    splitH.hidden = props.fold.folded || browser.fold.folded;
    if (!restoringLayout && props.fold.folded && browser.fold.folded) {
      // Do not leave an empty column with two headers: collapse it whole and prepare both to reopen.
      layoutBatch = true;
      leftPane.setCollapsed(true);
      props.fold.setFolded(false);
      browser.fold.setFolded(false);
      layoutBatch = false;
      splitH.hidden = false;
      layoutChanged(true);
      return;
    }
    layoutChanged(on);
  };
  leftPane.onChange((on) => layoutChanged(on));
  rightPane.onChange((on) => layoutChanged(on));
  bottomPane.onChange((on) => layoutChanged(on));
  props.fold.onChange(sectionChanged);
  browser.fold.onChange(sectionChanged);
  ribbon.onMinimizedChange((on) => layoutChanged(on));

  function collapsibleFor(pane: PaneId) {
    return pane === 'left' ? leftPane : pane === 'right' ? rightPane : pane === 'bottom' ? bottomPane : assistantPane;
  }
  function setPaneCollapsed(pane: PaneId, on: boolean): void {
    collapsibleFor(pane)?.setCollapsed(on);
  }
  function paneCollapsed(pane: PaneId): boolean {
    return collapsibleFor(pane)?.collapsed ?? true;
  }
  function toggleFocus(): void {
    if (focused && focusSnapshot) {
      const snapshot = focusSnapshot;
      layoutBatch = true;
      leftPane.setCollapsed(snapshot.left);
      rightPane.setCollapsed(snapshot.right);
      bottomPane.setCollapsed(snapshot.bottom);
      assistantPane?.setCollapsed(snapshot.assistant);
      ribbon.setMinimized(snapshot.ribbon);
      layoutBatch = false;
      focused = false;
      focusSnapshot = null;
      saveLayout(currentLayout());
      return;
    }
    focusSnapshot = { ...currentLayout(), assistant: assistantPane?.collapsed ?? true };
    focused = true;
    layoutBatch = true;
    leftPane.setCollapsed(true);
    rightPane.setCollapsed(true);
    bottomPane.setCollapsed(true);
    assistantPane?.setCollapsed(true);
    ribbon.setMinimized(true);
    layoutBatch = false;
  }

  const initialLayout = loadLayout();
  root.classList.add('ws-no-anim');
  leftPane.setCollapsed(initialLayout.left);
  rightPane.setCollapsed(initialLayout.right);
  bottomPane.setCollapsed(initialLayout.bottom);
  props.fold.setFolded(initialLayout.props);
  browser.fold.setFolded(initialLayout.browser);
  ribbon.setMinimized(initialLayout.ribbon);
  splitH.hidden = props.fold.folded || browser.fold.folded;
  restoringLayout = false;
  requestAnimationFrame(() => root.classList.remove('ws-no-anim'));

  return {
    get focused() {
      return focused;
    },
    layoutChanged,
    setPaneCollapsed,
    paneCollapsed,
    toggleFocus,
  };
}
