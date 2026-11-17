// Cost: the measured quantities of the chosen element, the item that pays it and its share of the amount.
import type { Unassigned } from './budget';
import { money, quantity } from './format';
import type { CostCode } from './system';
import type { ElementMeasures } from './takeoff';

export interface CostProps {
  /** `info.code`: the item of the element; if it has none, `info.reason` says why. `amount`: what falls to it. */
  show(
    path: string | null,
    m: ElementMeasures | null,
    info: { code: CostCode | null; amount: number; reason: Unassigned | null },
    currency: string,
  ): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const HELP = 'Select an element to see its quantities and cost.';

export function mountCostProps(host: HTMLElement): CostProps {
  const root = el('section', 'ws-panel cost-props');
  root.setAttribute('aria-label', 'Cost');
  const body = el('div', 'ws-panel-body cost-body');
  root.append(el('header', 'ws-panel-title', 'Cost'), body);
  host.replaceChildren(root);

  const message = (text: string) => body.replaceChildren(el('p', 'cost-empty', text));
  message(HELP);

  return {
    show(path, m, info, currency) {
      if (!path || !m) return message(HELP);
      const dl = el('dl', 'cost-measures');
      const row = (label: string, value: string) => dl.append(el('dt', undefined, label), el('dd', undefined, value));
      row('Count', String(m.count));
      row('Length (m)', quantity(m.length));
      row('Area (m²)', quantity(m.area));
      row('Volume (m³)', quantity(m.volume));
      row('Weight (kg)', m.weight === null ? '—' : quantity(m.weight));
      row('Cost item', info.code ? `${info.code.code} ${info.code.name}`.trim() : 'None');
      const foot = el('div', 'cost-share-total');
      foot.append(el('span', undefined, 'Element total'), el('span', 'cost-num', money(currency, info.amount)));
      body.replaceChildren(
        el('div', 'cost-path', path),
        dl,
        ...(info.code ? [foot] : [el('p', 'cost-empty', info.reason ?? 'Not in any item.')]),
      );
    },
  };
}
