import { draggedAsset } from '../library/librarypanel';
import { LAYER_DRAG_TYPE } from '../composer/rows';
import { ASSISTANT_WIDTH, LEFT_WIDTH, LIBRARY_HEIGHT, MOVE_MIN_HEIGHT, RIGHT_WIDTH } from './constants';
import { mountCollapsible, mountSectionFold, type Collapsible, type SectionFold } from './collapse';
import { mountSplitter, setPaneSize } from './splitter';
import type { AssistantPanel } from './types';

interface PanelParts {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly fold: SectionFold;
}

/** Every element and collapsible pane the workspace skeleton creates. */
export interface WorkspaceLayout {
  readonly root: HTMLElement;
  readonly ribbonHost: HTMLElement;
  readonly main: HTMLElement;
  readonly left: HTMLElement;
  readonly props: PanelParts;
  readonly browser: PanelParts;
  readonly splitH: HTMLElement;
  readonly splitV: HTMLElement;
  readonly center: HTMLElement;
  readonly tabbar: HTMLElement;
  readonly view: HTMLElement;
  readonly canvasHost: HTMLElement;
  readonly noView: HTMLElement;
  readonly levelOverlay: HTMLElement;
  readonly viewbar: HTMLElement;
  readonly splitLib: HTMLElement;
  readonly libHost: HTMLElement;
  readonly stack: HTMLElement;
  readonly upper: HTMLElement;
  readonly right: HTMLElement;
  readonly ctabs: HTMLElement;
  readonly stageHost: HTMLElement;
  readonly layerHost: HTMLElement;
  readonly refsHost: HTMLElement;
  readonly moveHost: HTMLElement;
  readonly splitMove: HTMLElement;
  readonly splitR: HTMLElement;
  readonly assistantHost: HTMLElement;
  readonly splitA: HTMLElement;
  readonly leftPane: Collapsible;
  readonly rightPane: Collapsible;
  readonly bottomPane: Collapsible;
  readonly assistantPane: Collapsible | null;
  readonly statusEl: HTMLElement;
  readonly ctabButtons: readonly HTMLButtonElement[];
  showComposerTab(label: 'Stage' | 'Layer' | 'References'): void;
}

export interface LayoutOptions {
  assistant?: AssistantPanel;
  /** Called when the References tab becomes visible (its content is painted lazily). */
  onReferencesShown?: () => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Is the event target a text field (typing must not trigger shortcuts)? */
export function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

function panel(cls: string, title: string): PanelParts {
  const root = el('section', `ws-panel ${cls}`);
  root.setAttribute('aria-label', title);
  const body = el('div', 'ws-panel-body');
  const header = el('header', 'ws-panel-title', title);
  root.append(header, body);
  return { root, body, fold: mountSectionFold(root, header) };
}

export function buildLayout(host: HTMLElement, opts: LayoutOptions = {}): WorkspaceLayout {
  const root = el('div', 'ws');
  const ribbonHost = el('div', 'ws-ribbon');
  const main = el('div', 'ws-main');
  const left = el('div', 'ws-left');
  const props = panel('ws-props', 'Properties');
  const browser = panel('ws-browser', 'Project Browser');
  const splitH = el('div');
  left.append(props.root, splitH, browser.root);
  const splitV = el('div');

  const center = el('div', 'ws-center');
  const tabbar = el('div', 'ws-tabs');
  tabbar.setAttribute('role', 'tablist');
  tabbar.setAttribute('aria-label', 'Open views');
  const view = el('div', 'ws-view');
  const canvasHost = el('div', 'ws-canvas');
  const noView = el('div', 'ws-noview', 'No view is open. Open one from the Project Browser.');
  const levelOverlay = el('div', 'ws-level-overlay');
  view.append(canvasHost, noView, levelOverlay);
  const viewbar = el('div', 'ws-viewbar');
  // Library panel under the view (like Omniverse's Content), with its splitter
  const splitLib = el('div');
  const libHost = el('section', 'ws-library');
  libHost.setAttribute('aria-label', 'Library');
  center.append(tabbar, view, viewbar);
  // the Library hangs from a column that spans the left and the center, so it reaches the left edge
  const stack = el('div', 'ws-stack');
  const upper = el('div', 'ws-upper');
  upper.append(left, splitV, center);
  stack.append(upper, splitLib, libHost);
  // Right column: Stage | Layer | References tabs (like USD/Omniverse) and the Move box fixed at the bottom
  const right = el('div', 'ws-right');
  const ctabs = el('div', 'ws-ctabs');
  ctabs.setAttribute('role', 'tablist');
  ctabs.setAttribute('aria-label', 'Composer');
  const stageHost = el('div', 'ws-cpanel ws-stage');
  const layerHost = el('div', 'ws-cpanel ws-layer');
  const refsHost = el('div', 'ws-cpanel ws-refs');
  const moveHost = el('div', 'ws-move');
  // splitter above the Move box: dragging up grows it (only visible while the box is open)
  const splitMove = el('div', 'ws-move-split');
  const ctabButtons = (
    [
      ['Stage', stageHost],
      ['Layer', layerHost],
      ['References', refsHost],
    ] as const
  ).map(([label, pane]) => {
    const b = el('button', 'ws-ctab', label);
    b.type = 'button';
    b.id = `ws-ctab-${label.toLowerCase()}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `ws-cpanel-${label.toLowerCase()}`);
    pane.id = `ws-cpanel-${label.toLowerCase()}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', b.id);
    b.addEventListener('click', () => showComposerTab(label));
    // dragging a Layer panel row over the Stage tab opens it so the row can be dropped there
    if (label === 'Stage') {
      b.addEventListener('dragover', (e) => {
        const layerDrag = !!e.dataTransfer?.types && [...e.dataTransfer.types].includes(LAYER_DRAG_TYPE);
        if (!layerDrag && !draggedAsset()) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        showComposerTab('Stage');
      });
    }
    return b;
  });
  /** Shows the right column's `label` tab and hides the rest. */
  function showComposerTab(label: 'Stage' | 'Layer' | 'References'): void {
    for (const b of ctabButtons) {
      const on = b.textContent === label;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    stageHost.hidden = label !== 'Stage';
    layerHost.hidden = label !== 'Layer';
    refsHost.hidden = label !== 'References';
    if (label === 'References') opts.onReferencesShown?.(); // paints what was pending while hidden
  }
  // tab keyboard (roving tabindex): arrows, Home and End focus and activate
  ctabs.addEventListener('keydown', (e) => {
    const i = ctabButtons.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const n = ctabButtons.length;
    const next =
      e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    const b = ctabButtons[next];
    showComposerTab(b.textContent as 'Stage' | 'Layer' | 'References');
    b.focus();
  });
  ctabs.append(...ctabButtons);
  right.append(ctabs, stageHost, layerHost, refsHost, splitMove, moveHost);
  showComposerTab('Stage');
  const splitR = el('div');
  // Assistant column: collapsed on start; the agent does not launch until it is opened for the first time
  const assistantHost = el('div', 'ws-assistant');
  const splitA = el('div');
  if (opts.assistant) assistantHost.append(opts.assistant.root);
  main.append(stack, splitR, right);
  if (opts.assistant) main.append(splitA, assistantHost);

  const leftPane = mountCollapsible({
    side: 'left', pane: left, splitter: splitV, label: 'Left panels',
    items: [{ label: 'Properties' }, { label: 'Project Browser' }],
  });
  const rightPane = mountCollapsible({
    side: 'right', pane: right, splitter: splitR, label: 'Right panel',
    items: (['Stage', 'Layer', 'References'] as const).map((label) => ({ label, onSelect: () => showComposerTab(label) })),
  });
  const bottomPane = mountCollapsible({
    side: 'bottom', pane: libHost, splitter: splitLib, label: 'Bottom panel', items: [{ label: 'Library' }],
  });
  const assistantPane: Collapsible | null = opts.assistant ? mountCollapsible({
    side: 'right', pane: assistantHost, splitter: splitA, label: 'Assistant', items: [{ label: 'Assistant' }],
  }) : null;
  assistantPane?.setCollapsed(true);
  const statusEl = el('div');
  root.append(ribbonHost, main, statusEl);
  host.replaceChildren(root);

  setPaneSize(left, LEFT_WIDTH);
  setPaneSize(right, RIGHT_WIDTH);
  const sideWidth = (...cols: HTMLElement[]) => cols.reduce((n, c) => n + c.offsetWidth, 0);
  const railsWidth = () => sideWidth(leftPane.rail, rightPane.rail, ...(assistantPane ? [assistantPane.rail] : []));
  mountSplitter(splitV, {
    axis: 'x', target: left, min: 200, onCollapse: () => leftPane.setCollapsed(true),
    max: () => Math.max(200, main.clientWidth - sideWidth(right, assistantHost) - railsWidth() - 320),
  });
  mountSplitter(splitR, {
    axis: 'x', target: right, after: true, min: 200, onCollapse: () => rightPane.setCollapsed(true),
    max: () => Math.max(200, main.clientWidth - sideWidth(left, assistantHost) - railsWidth() - 320),
  });
  setPaneSize(assistantHost, ASSISTANT_WIDTH);
  mountSplitter(splitA, {
    axis: 'x', target: assistantHost, after: true, min: 260, onCollapse: () => assistantPane?.setCollapsed(true),
    max: () => Math.max(260, main.clientWidth - sideWidth(left, right) - railsWidth() - 320),
  });
  mountSplitter(splitMove, { axis: 'y', target: moveHost, after: true, min: MOVE_MIN_HEIGHT, max: () => Math.max(MOVE_MIN_HEIGHT, right.clientHeight - 120) });
  mountSplitter(splitH, { axis: 'y', target: props.root, min: 80, max: () => Math.max(80, left.clientHeight - 120) });
  setPaneSize(libHost, LIBRARY_HEIGHT);
  mountSplitter(splitLib, {
    axis: 'y', target: libHost, after: true, min: 60, onCollapse: () => bottomPane.setCollapsed(true),
    max: () => Math.max(60, stack.clientHeight - 200),
  });

  return {
    root, ribbonHost, main, left, props, browser, splitH, splitV, center, tabbar, view, canvasHost, noView,
    levelOverlay, viewbar, splitLib, libHost, stack, upper, right, ctabs, stageHost, layerHost, refsHost,
    moveHost, splitMove, splitR, assistantHost, splitA, leftPane, rightPane, bottomPane, assistantPane,
    statusEl, ctabButtons, showComposerTab,
  };
}
