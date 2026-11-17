import { svgIcon } from '../shell/icons';
import { toggleRadioMenu, type RadioMenu } from '../shell/radiomenu';
import { RIBBON, SOON, type RibbonButton, type RibbonTab, type ViewAction } from './definition';

const INITIAL_TAB = 'arquitectura';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setPressedState(b: HTMLElement, on: boolean): void {
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('pressed', on);
}

/**
 * Draws the ribbon inside `el`. Only the buttons with `action` are active;
 * el resto se monta desactivado. `setPressed` sincroniza un toggle desde fuera sin disparar `onAction`.
 * The tabs live in `.ribbon-tabbar`: the "File" button can be prepended there (see filemenu.ts).
 */
export interface Ribbon {
  setPressed(a: ViewAction, on: boolean): void;
  setEnabled(a: ViewAction, on: boolean, title?: string): void;
  /** Marks the chosen option of a button with a menu, without firing `onAction`. */
  setMenuValue(a: ViewAction, value: string): void;
  /** Adds a contextual tab at the end (Revit: Modify | …) and selects it; `hideContextual` removes it. */
  showContextual(tab: RibbonTab): void;
  hideContextual(): void;
  /** Leaves only those tabs visible (in the order of `defs`) and selects `active`; it closes the contextual one. */
  showTabs(ids: string[], active: string): void;
  /** Id of the selected tab; with the contextual one open, that of the tab below it. */
  activeTab(): string;
  setMinimized(on: boolean): void;
  readonly minimized: boolean;
  onMinimizedChange(fn: (on: boolean) => void): void;
  /** Removes the document listeners the ribbon added. */
  dispose(): void;
}

export function mountRibbon(
  el_: HTMLElement,
  onAction: (a: ViewAction, pressed: boolean, value?: string) => void,
  defs: RibbonTab[] = RIBBON,
): Ribbon {
  const root = el('div', 'ribbon');
  const tabbar = el('div', 'ribbon-tabbar');
  const tablist = el('div', 'ribbon-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-label', 'Ribbon');
  const minimizeButton = el('button', 'ribbon-minimize') as HTMLButtonElement;
  minimizeButton.type = 'button';
  minimizeButton.setAttribute('aria-pressed', 'false');
  tabbar.append(tablist, minimizeButton);
  const body = el('div', 'ribbon-body');
  root.append(tabbar, body);

  const menuValues = new Map<ViewAction, string>();
  const openMenus = new Map<ViewAction, RadioMenu>();
  const buttons = new Map<ViewAction, HTMLButtonElement[]>(); // an action may have several buttons (Level)
  const toggles = new Map<ViewAction, HTMLButtonElement>();
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  let minimized = false;
  const minimizedListeners: ((on: boolean) => void)[] = [];
  const setMinimized = (on: boolean): void => {
    if (minimized === on) return;
    minimized = on;
    root.classList.toggle('is-minimized', on);
    root.classList.remove('is-peek');
    minimizeButton.setAttribute('aria-pressed', String(on));
    minimizeButton.title = `${on ? 'Expand' : 'Minimize'} the ribbon (Ctrl+F1)`;
    minimizeButton.setAttribute('aria-label', minimizeButton.title);
    minimizeButton.replaceChildren(svgIcon(on ? 'chevron-down' : 'chevron-up', 14));
    for (const fn of minimizedListeners) fn(on);
  };
  setMinimized(false);
  minimizeButton.title = 'Minimize the ribbon (Ctrl+F1)';
  minimizeButton.setAttribute('aria-label', minimizeButton.title);
  minimizeButton.replaceChildren(svgIcon('chevron-up', 14));
  minimizeButton.addEventListener('click', () => setMinimized(!minimized));

  // Dropdown menu of a button (radio options)
  const openMenu = (btn: HTMLButtonElement, action: ViewAction, options: { value: string; label: string }[]): void => {
    const menu = toggleRadioMenu(btn, options, menuValues.get(action) ?? null, (v) => onAction(action, false, v), {
      onClose: () => openMenus.delete(action),
    });
    if (menu) openMenus.set(action, menu);
  };

  // a pressed radio releases the others of its group
  const pressRadio = (btn: HTMLButtonElement): void => {
    for (const other of root.querySelectorAll<HTMLButtonElement>(`[data-radio="${btn.dataset.radio}"]`)) {
      setPressedState(other, other === btn);
    }
  };

  const makeButton = (b: RibbonButton): HTMLButtonElement => {
    const btn = el('button', 'ribbon-btn');
    btn.type = 'button';
    btn.dataset.id = b.id;
    btn.append(svgIcon(b.icon, 28), el('span', 'ribbon-btn-label', b.menu ? `${b.label} ▾` : b.label));
    const action = b.action;
    if (!action) {
      btn.disabled = true;
      btn.title = SOON;
      return btn;
    }
    btn.dataset.action = action;
    buttons.set(action, [...(buttons.get(action) ?? []), btn]);
    if (b.toggle || b.radio) {
      setPressedState(btn, false);
      toggles.set(action, btn);
    }
    if (b.radio) {
      btn.dataset.radio = b.radio;
      btn.addEventListener('click', () => {
        pressRadio(btn);
        onAction(action, true);
      });
      return btn;
    }
    if (b.menu) {
      btn.setAttribute('aria-haspopup', 'menu');
      btn.addEventListener('click', () => openMenu(btn, action, b.menu!));
      return btn;
    }
    btn.addEventListener('click', () => {
      let pressed = false;
      if (b.toggle) {
        pressed = btn.getAttribute('aria-pressed') !== 'true';
        setPressedState(btn, pressed);
      }
      onAction(action, pressed);
    });
    return btn;
  };

  let activeId = INITIAL_TAB;
  let visible = new Set(defs.map((t) => t.id));
  let ctx: { tab: RibbonTab; button: HTMLButtonElement; panel: HTMLElement; before: string } | null = null;

  const mark = (tab: HTMLElement, panel: HTMLElement, on: boolean): void => {
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    tab.classList.toggle('active', on);
    panel.hidden = !on;
  };

  const select = (id: string): void => {
    activeId = id;
    defs.forEach((t, i) => {
      const shown = visible.has(t.id);
      tabs[i].hidden = !shown;
      mark(tabs[i], panels[i], shown && t.id === id);
    });
    if (ctx) mark(ctx.button, ctx.panel, ctx.tab.id === id);
  };

  const activateTab = (id: string): void => {
    select(id);
    if (minimized) root.classList.add('is-peek');
  };
  const bindTabToggle = (tab: HTMLButtonElement, id: string): void => {
    tab.addEventListener('click', () => activateTab(id));
    tab.addEventListener('dblclick', (e) => {
      e.preventDefault();
      setMinimized(!minimized);
    });
  };

  const buildPanel = (t: RibbonTab, tab: HTMLElement): HTMLElement => {
    const panel = el('div', 'ribbon-panel');
    panel.id = `ribbon-panel-${t.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    for (const g of t.groups) {
      const group = el('div', 'ribbon-group');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', g.label);
      const groupButtons = el('div', 'ribbon-group-buttons');
      groupButtons.append(...g.buttons.map(makeButton));
      group.append(groupButtons, el('div', 'ribbon-group-label', g.label));
      panel.appendChild(group);
    }
    return panel;
  };

  const hideContextual = (): void => {
    if (!ctx) return;
    const { tab, button, panel, before } = ctx;
    button.remove();
    panel.remove();
    for (const g of tab.groups) {
      for (const b of g.buttons) {
        if (!b.action) continue;
        buttons.delete(b.action);
        toggles.delete(b.action);
      }
    }
    ctx = null;
    select(before);
  };

  const showContextual = (tab: RibbonTab): void => {
    const before = ctx?.before ?? activeId;
    hideContextual();
    const button = el('button', 'ribbon-tab contextual', tab.label);
    button.type = 'button';
    button.id = `ribbon-tab-${tab.id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `ribbon-panel-${tab.id}`);
    bindTabToggle(button, tab.id);
    const panel = buildPanel(tab, button);
    tablist.appendChild(button);
    body.appendChild(panel);
    ctx = { tab, button, panel, before };
    select(tab.id);
  };

  defs.forEach((t, i) => {
    const tab = el('button', 'ribbon-tab', t.label);
    tab.type = 'button';
    tab.id = `ribbon-tab-${t.id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `ribbon-panel-${t.id}`);
    bindTabToggle(tab, t.id);
    tab.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      const order = defs.map((d, k) => k).filter((k) => visible.has(defs[k].id));
      const at = order.indexOf(i);
      const next = order[(at + dir + order.length) % order.length];
      select(defs[next].id);
      tabs[next].focus();
    });
    tabs.push(tab);
    tablist.appendChild(tab);

    const panel = buildPanel(t, tab);
    panels.push(panel);
    body.appendChild(panel);
  });

  body.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.ribbon-btn')) root.classList.remove('is-peek');
  });
  const onOutsideKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') root.classList.remove('is-peek');
  };
  const onOutsidePointerdown = (e: PointerEvent): void => {
    if (!root.contains(e.target as Node)) root.classList.remove('is-peek');
  };
  document.addEventListener('keydown', onOutsideKeydown);
  document.addEventListener('pointerdown', onOutsidePointerdown);

  select(INITIAL_TAB);
  el_.replaceChildren(root);

  return {
    setMinimized,
    get minimized() { return minimized; },
    onMinimizedChange(fn) { minimizedListeners.push(fn); },
    setPressed(a, on) {
      const b = toggles.get(a);
      if (!b) return;
      if (b.dataset.radio && on) pressRadio(b);
      else setPressedState(b, on);
    },
    showContextual,
    hideContextual,
    showTabs(ids, active) {
      hideContextual();
      visible = new Set(ids);
      select(active);
    },
    activeTab: () => (ctx ? ctx.before : activeId),
    setMenuValue(a, value) {
      menuValues.set(a, value);
      openMenus.get(a)?.setSelected(value);
    },
    setEnabled(a, on, title = '') {
      for (const b of buttons.get(a) ?? []) {
        b.disabled = !on;
        b.title = title;
      }
    },
    dispose() {
      document.removeEventListener('keydown', onOutsideKeydown);
      document.removeEventListener('pointerdown', onOutsidePointerdown);
    },
  };
}
