// Status bar: contextual message on the left and the active view's level on the right.
import type { ComposedNode } from '../ifcx/types';
import { displayName } from '../ifcx/names';
import type { ViewRef } from '../browser/views';

export const STATUS_HINT = 'Click to select an element.';

const classOf = (n: ComposedNode): string | undefined =>
  (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;

/**
 * "<name> · <class>" of the element under the cursor. It climbs to the first ancestor with an IFC
 * class (a loose "Body" says little); without a class, only the name.
 */
export function hoverText(n: ComposedNode): string {
  let c: ComposedNode | null = n;
  while (c && !classOf(c)) c = c.parent;
  const owner = c ?? n;
  const cls = classOf(owner);
  return cls ? `${displayName(owner)} · ${cls}` : displayName(owner);
}

/** Level associated with the view (only plans have one). */
export function levelText(v: ViewRef | null): string {
  return v?.kind === 'plan' ? v.level.name : '';
}

export interface StatusBar {
  /** Message on the left; null returns to the default hint. */
  setMessage(text: string | null): void;
  setLevel(text: string): void;
}

export function mountStatusBar(el: HTMLElement): StatusBar {
  el.classList.add('ws-status');
  const msg = document.createElement('span');
  msg.className = 'ws-status-msg';
  const level = document.createElement('span');
  level.className = 'ws-status-level';
  el.replaceChildren(msg, level);
  const api: StatusBar = {
    setMessage(text) {
      msg.textContent = text ?? STATUS_HINT; // always text: the names come from the model
    },
    setLevel(text) {
      level.textContent = text;
      level.title = text ? `Level of the active view: ${text}` : '';
    },
  };
  api.setMessage(null);
  api.setLevel('');
  return api;
}
