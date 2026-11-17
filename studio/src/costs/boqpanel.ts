// BOQ (Bill of Quantities): the tree of the cost system. The heading lines carry their subtotal; the items, their
// measured quantity, their price and their total. At the end, what did not fall into any item and the grand total.
import type { Budget, BudgetNode } from './budget';
import { money, quantity } from './format';

export interface BoqCallbacks {
  /** Click on a line (item or heading): its elements are selected. */
  onSelect(code: string): void;
  /** Double click or Enter: open the code dialog. */
  onEdit(code: string): void;
  /** Clic en «Unassigned»: se seleccionan los elementos sin partida. */
  onSelectUnassigned(): void;
}

export interface BoqPanel {
  /** null = el modelo no tiene sistema de costos. */
  setBudget(budget: Budget | null): void;
  setSelected(code: string | null): void;
  /** Resalta (sin seleccionar) la partida del elemento elegido en 3D. */
  markCode(code: string | null): void;
}

export const NO_SYSTEM = 'This model has no cost system. Import a costs IFCx as a layer.';

const HEADERS = ['Code', 'Description', 'Unit', 'Quantity', 'Unit Price', 'Total'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountBoq(host: HTMLElement, cb: BoqCallbacks): BoqPanel {
  const root = el('section', 'ws-panel cost-boq');
  root.setAttribute('aria-label', 'Bill of Quantities');
  const body = el('div', 'ws-panel-body cost-body');
  const table = el('table', 'cost-table');
  const head = el('tr');
  for (const h of HEADERS) {
    const th = el('th', undefined, h);
    th.scope = 'col';
    head.append(th);
  }
  const tbody = el('tbody');
  table.append(el('thead'), tbody);
  table.tHead!.append(head);
  const empty = el('p', 'cost-empty', NO_SYSTEM);
  body.append(table, empty);
  root.append(el('header', 'ws-panel-title', 'Bill of Quantities'), body);
  host.replaceChildren(root);

  let budget: Budget | null = null;
  let selected: string | null = null;
  let marked: string | null = null;

  /** What the rows of a code do: click selects, double click and Enter edit. */
  function wire(tr: HTMLElement, code: string): void {
    tr.dataset.code = code;
    tr.tabIndex = 0;
    tr.addEventListener('click', () => cb.onSelect(code));
    tr.addEventListener('dblclick', () => cb.onEdit(code));
    tr.addEventListener('keydown', (e) => {
      if (e.target !== tr || e.key !== 'Enter') return;
      e.preventDefault();
      cb.onEdit(code);
    });
  }

  function nodeRows(n: BudgetNode, currency: string, out: HTMLElement[]): void {
    const { code } = n;
    if (!code.medicion) {
      const tr = el('tr', 'cost-chapter cost-group');
      tr.dataset.level = String(n.level);
      wire(tr, code.code);
      const name = el('th', undefined, `${code.code} ${code.name}`);
      name.colSpan = 5;
      name.style.paddingLeft = `${8 + (n.level - 1) * 14}px`;
      tr.append(name, el('td', 'cost-num', money(currency, n.total)));
      out.push(tr);
    } else {
      const tr = el('tr', 'cost-row');
      wire(tr, code.code);
      tr.setAttribute('aria-selected', String(code.code === selected));
      tr.classList.toggle('is-marked', code.code === marked);
      const desc = el('td', undefined, code.name);
      desc.style.paddingLeft = `${8 + (n.level - 1) * 14}px`;
      if (n.warning) desc.append(el('div', 'cost-warn', n.warning));
      tr.append(
        el('td', undefined, code.code),
        desc,
        el('td', undefined, code.medicion.unit),
        el('td', 'cost-num', quantity(n.quantity)),
        el('td', 'cost-num', money(currency, code.unitPrice)),
        el('td', 'cost-num', money(currency, n.total)),
      );
      out.push(tr);
    }
    for (const c of n.children) nodeRows(c, currency, out);
  }

  function render(): void {
    empty.textContent = budget ? 'The cost system has no items.' : NO_SYSTEM;
    empty.hidden = !!budget && budget.roots.length > 0;
    const rows: HTMLElement[] = [];
    if (budget && budget.roots.length) {
      for (const n of budget.roots) nodeRows(n, budget.currency, rows);
      if (budget.unassigned.length) {
        const tr = el('tr', 'cost-unassigned');
        tr.tabIndex = 0;
        tr.addEventListener('click', () => cb.onSelectUnassigned());
        const reasons = [...new Set(budget.unassigned.map((u) => u.reason))].join(', ');
        const label = el('th', undefined, `Unassigned (${budget.unassigned.length})`);
        label.colSpan = 5;
        label.title = reasons;
        tr.append(label, el('td', 'cost-num', ''));
        rows.push(tr);
      }
      const total = el('tr', 'cost-total');
      const label = el('th', undefined, 'Total');
      label.colSpan = 5;
      total.append(label, el('td', 'cost-num', money(budget.currency, budget.total)));
      rows.push(total);
    }
    tbody.replaceChildren(...rows);
  }

  render();
  return {
    setBudget(b) {
      budget = b;
      render();
    },
    setSelected(code) {
      selected = code;
      for (const tr of tbody.querySelectorAll<HTMLElement>('.cost-row')) tr.setAttribute('aria-selected', String(tr.dataset.code === code));
    },
    markCode(code) {
      marked = code;
      for (const tr of tbody.querySelectorAll<HTMLElement>('.cost-row')) tr.classList.toggle('is-marked', tr.dataset.code === code);
    },
  };
}
