import { svgIcon } from '../shell/icons';
import './collapse.css';

export const RAIL_SIZE = 28;
export const RAIL_SIZE_H = 24;
export const COLLAPSE_MS = 160;

export type CollapseSide = 'left' | 'right' | 'bottom';
export interface RailItem {
  label: string;
  onSelect?: () => void;
}
export interface CollapsibleOptions {
  side: CollapseSide;
  pane: HTMLElement;
  splitter?: HTMLElement;
  items: RailItem[];
  /** Accessible title of the rail, e.g. 'Left panels'. */
  label: string;
}
export interface Collapsible {
  readonly collapsed: boolean;
  readonly rail: HTMLElement;
  setCollapsed(on: boolean): void;
  toggle(): void;
  setRailItems(items: RailItem[]): void;
  onChange(fn: (collapsed: boolean) => void): void;
}

/** Turns a flex slot into a collapsible one without changing its `style.flex`: thus it keeps each mode's size. */
export function mountCollapsible(o: CollapsibleOptions): Collapsible {
  let collapsed = false;
  let items = o.items;
  const listeners: ((collapsed: boolean) => void)[] = [];
  const rail = document.createElement('div');
  rail.className = `ws-rail ws-rail-${o.side}`;
  rail.setAttribute('role', 'toolbar');
  rail.setAttribute('aria-label', o.label);
  rail.hidden = true;
  o.pane.classList.add('ws-collapsible');
  o.pane.parentElement?.insertBefore(rail, o.side === 'left' ? o.pane : o.pane.nextSibling);

  const renderItems = (): void => {
    rail.replaceChildren(...items.map((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ws-rail-item';
      button.title = `Expand ${item.label}`;
      button.setAttribute('aria-label', button.title);
      if (o.side === 'bottom' && index === 0) button.append(svgIcon('chevron-up', 12));
      button.append(document.createElement('span'));
      button.lastElementChild!.textContent = item.label;
      button.addEventListener('click', () => {
        api.setCollapsed(false);
        item.onSelect?.();
      });
      return button;
    }));
  };

  const api: Collapsible = {
    get collapsed() { return collapsed; },
    rail,
    setCollapsed(on) {
      if (collapsed === on) return;
      collapsed = on;
      o.pane.classList.toggle('is-collapsed', on);
      o.pane.inert = on;
      if (on) o.pane.setAttribute('aria-hidden', 'true');
      else o.pane.removeAttribute('aria-hidden');
      if (o.splitter) o.splitter.hidden = on;
      rail.hidden = !on;
      for (const fn of listeners) fn(on);
    },
    toggle() { api.setCollapsed(!collapsed); },
    setRailItems(next) {
      items = next;
      renderItems();
    },
    onChange(fn) { listeners.push(fn); },
  };
  renderItems();
  return api;
}

export interface SectionFold {
  readonly folded: boolean;
  setFolded(on: boolean): void;
  onChange(fn: (folded: boolean) => void): void;
}

/** The panel title becomes a button with a chevron; when folded only the header remains. */
export function mountSectionFold(section: HTMLElement, header: HTMLElement): SectionFold {
  let folded = false;
  const listeners: ((folded: boolean) => void)[] = [];
  const title = header.textContent?.trim() || section.getAttribute('aria-label') || 'Panel';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ws-panel-fold';
  button.setAttribute('aria-expanded', 'true');
  button.title = `Collapse ${title}`;
  const text = document.createElement('span');
  text.textContent = title;
  button.append(svgIcon('chevron-down', 12), text);
  header.replaceChildren(button);

  const api: SectionFold = {
    get folded() { return folded; },
    setFolded(on) {
      if (folded === on) return;
      folded = on;
      section.classList.toggle('is-folded', on);
      button.setAttribute('aria-expanded', String(!on));
      button.title = `${on ? 'Expand' : 'Collapse'} ${title}`;
      for (const fn of listeners) fn(on);
    },
    onChange(fn) { listeners.push(fn); },
  };
  button.addEventListener('click', () => api.setFolded(!folded));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    api.setFolded(!folded);
  });
  return api;
}
