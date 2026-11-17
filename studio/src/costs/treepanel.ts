// Cost System: the cost IFCx as a tree (collapsible heading lines and items), in the left panel of Costs. Codes are
// chosen, moved by dragging them and dragged to the 3D to assign them; "Edit…" opens the whole system in a
// modal (create, change and delete codes). Everything that changes is done by the mode; the panel only notifies.
import { NO_SYSTEM } from './boqpanel';
import { branch } from './edit';
import type { CostCode, CostSystem } from './system';

/** Type of the drag of a code (dataTransfer): the code, as text. */
export const COST_CODE_DRAG = 'application/x-ifcx-cost-code';

export interface CostTreeCallbacks {
  onSelect(code: string): void;
  onEdit(code: string): void;
  /** Move `code` under `parent` (null = root). */
  onMove(code: string, parent: string | null): void;
  /** Abrir todo el sistema en el editor (modal). */
  onOpenEditor(): void;
}

export interface CostTree {
  /** `counts`: elements of each branch (code → number). null = the model has no system. */
  setSystem(system: CostSystem | null, counts: Map<string, number>): void;
  setSelected(code: string | null): void;
  setEditable(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountCostTree(host: HTMLElement, cb: CostTreeCallbacks): CostTree {
  const root = el('section', 'ws-panel cost-tree');
  root.setAttribute('aria-label', 'Cost System');
  const header = el('header', 'ws-panel-title cost-tree-head');
  const button = (label: string, onClick: () => void) => {
    const b = el('button', 'cost-tree-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const edit = button('Edit…', () => cb.onOpenEditor());
  edit.title = 'Open the whole cost system to edit it';
  header.append(el('span', 'cost-tree-title', 'Cost System'), edit);
  const body = el('div', 'ws-panel-body cost-body');
  const list = el('div', 'cost-tree-list');
  list.setAttribute('role', 'tree');
  const empty = el('p', 'cost-empty', NO_SYSTEM);
  body.append(list, empty);
  root.append(header, body);
  host.replaceChildren(root);

  let system: CostSystem | null = null;
  let counts = new Map<string, number>();
  let selected: string | null = null;
  let editable = true;
  /** Collapsed heading lines (kept when recomposing). */
  const folded = new Set<string>();
  /** The code being dragged (in dragover the dataTransfer cannot be read). */
  let dragging: string | null = null;

  /** Can `code` be moved under `target`? Not onto itself nor onto what hangs from it. */
  const canMove = (code: string, target: string | null): boolean =>
    !!system && system.byCode.has(code) && (target === null || !branch(system, code).has(target));

  const dragged = (e: DragEvent): string | null => e.dataTransfer?.getData(COST_CODE_DRAG) || dragging;

  function row(c: CostCode, depth: number): HTMLElement {
    const r = el('div', 'cost-tree-row');
    r.dataset.code = c.code;
    r.setAttribute('role', 'treeitem');
    r.tabIndex = 0;
    r.style.paddingLeft = `${6 + depth * 14}px`;
    r.setAttribute('aria-selected', String(c.code === selected));
    r.classList.toggle('is-heading', !c.medicion);
    const kids = system!.children(c.code);
    if (kids.length) {
      const t = el('button', 'cost-tree-toggle', folded.has(c.code) ? '▸' : '▾');
      t.type = 'button';
      t.setAttribute('aria-label', folded.has(c.code) ? 'Expand' : 'Collapse');
      t.addEventListener('click', (e) => {
        e.stopPropagation();
        if (folded.has(c.code)) folded.delete(c.code);
        else folded.add(c.code);
        render();
      });
      r.append(t);
      r.setAttribute('aria-expanded', String(!folded.has(c.code)));
    } else r.append(el('span', 'cost-tree-leaf'));
    r.append(el('span', 'cost-tree-code', c.code), el('span', 'cost-tree-name', c.name));
    const n = counts.get(c.code) ?? 0;
    if (n > 0) r.append(el('span', 'cost-tree-count', String(n)));

    r.addEventListener('click', () => cb.onSelect(c.code));
    r.addEventListener('dblclick', () => cb.onEdit(c.code));
    r.addEventListener('keydown', (e) => {
      if (e.target !== r) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        cb.onEdit(c.code);
      }
    });
    r.draggable = editable;
    r.addEventListener('dragstart', (e) => {
      dragging = c.code;
      e.dataTransfer?.setData(COST_CODE_DRAG, c.code);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
    });
    r.addEventListener('dragend', () => (dragging = null));
    r.addEventListener('dragover', (e) => {
      const code = dragged(e);
      if (!editable || !code || !canMove(code, c.code)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    r.addEventListener('drop', (e) => {
      const code = dragged(e);
      dragging = null;
      if (!editable || !code || code === c.code || !canMove(code, c.code)) return;
      e.preventDefault();
      e.stopPropagation();
      cb.onMove(code, c.code);
    });
    return r;
  }

  // dropping on the header leaves the code at the root
  header.addEventListener('dragover', (e) => {
    if (editable && dragged(e)) e.preventDefault();
  });
  header.addEventListener('drop', (e) => {
    const code = dragged(e);
    dragging = null;
    if (!editable || !code || !canMove(code, null)) return;
    e.preventDefault();
    cb.onMove(code, null);
  });

  function render(): void {
    edit.disabled = !editable || !system;
    empty.hidden = !!system;
    const out: HTMLElement[] = [];
    const walk = (parent: string | null, depth: number): void => {
      for (const c of system!.children(parent)) {
        out.push(row(c, depth));
        if (!folded.has(c.code)) walk(c.code, depth + 1);
      }
    };
    if (system) walk(null, 0);
    list.replaceChildren(...out);
  }

  render();
  return {
    setSystem(s, n) {
      system = s;
      counts = n;
      render();
    },
    setSelected(code) {
      selected = code;
      render();
    },
    setEditable(on) {
      editable = on;
      render();
    },
  };
}
