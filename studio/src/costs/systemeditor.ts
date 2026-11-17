// Cost system editor in a modal: the whole cost IFCx as a tree table, with code, description,
// unit, price and reference. The reference is the file the price came from: it is chosen in a document
// (quotation in Excel, Word, PDF or image, with OCR) and the price is copied with it. Codes are added (at the root or as
// children), changed and branches are deleted. Save returns the codes as they are left; Cancel, null. The caller writes the
// archivo (`replaceSystemCodes`) en un solo paso del historial.
import { docName, pickFromDocument, refLabel, type DocState } from './docpicker';
import type { SystemEntry } from './edit';
import { parseNumber } from './format';
import type { QuoteSource } from './quoteparse';
import type { CostSystem, Measure, PriceOrigin } from './system';

export interface SystemEditorOptions {
  /** Moneda de los precios. */
  currency: string;
  /** Elements with an item in the branch of a code, to warn before deleting it. */
  elementsIn?(code: string): number;
  /** Confirmation before deleting a branch with children or with elements; without it, it is deleted. */
  confirm?(message: string, ok: string): Promise<boolean>;
  /** Abre un documento de precios; sin esto, en el selector solo se pega texto. */
  openFile?(): Promise<QuoteSource | null>;
  /** Re-reads by its path the document a price came from. */
  readFile?(path: string): Promise<QuoteSource>;
  /** El documento abierto en el selector: se conserva entre filas y, si se da, entre aperturas del editor. */
  docState?: DocState;
  /** The system file, for the footer. */
  file?: string;
}

/** The units of the list and what they measure; '' = heading line (without measurement). */
const UNITS: [string, Measure][] = [['u', 'count'], ['m', 'length'], ['m²', 'area'], ['m³', 'volume'], ['kg', 'weight']];

/** A row of the editor. `key` identifies it even if its code changes (the new ones do not have one yet). */
interface Row {
  key: string;
  code: string;
  name: string;
  parentKey: string | null;
  unit: string;
  price: string;
  /** Which document the price came from; null if it was written by hand. */
  origin: PriceOrigin | null;
  isNew: boolean;
}

let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** null si se cancela (Esc, Cancel) o si ya hay un editor abierto. */
export function askSystemEdit(system: CostSystem, o: SystemEditorOptions): Promise<SystemEntry[] | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  // the file's own units (e.g. 'ml') are kept with their measure
  const measureOf = new Map<string, Measure>(UNITS);
  for (const c of system.codes) if (c.medicion && !measureOf.has(c.medicion.unit)) measureOf.set(c.medicion.unit, c.medicion.measure);

  let rows: Row[] = system.codes.map((c) => ({
    key: c.code,
    code: c.code,
    name: c.name,
    parentKey: c.parent,
    unit: c.medicion?.unit ?? '',
    price: c.manualPrice === null ? '' : String(c.manualPrice),
    origin: c.origin,
    isNew: false,
  }));
  const docState: DocState = o.docState ?? { doc: null, decimal: '.' };
  let created = 0;
  const folded = new Set<string>();

  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal cost-sys-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Cost System');
  const bar = el('div', 'cost-sys-bar');
  const search = el('input', 'cost-sys-search');
  search.type = 'search';
  search.placeholder = 'Search codes';
  search.setAttribute('aria-label', 'Search codes');
  const addRoot = el('button', 'modal-btn', '+ Code');
  addRoot.type = 'button';
  bar.append(search, addRoot);
  const head = el('div', 'cost-sys-head');
  for (const h of ['Code', 'Description', 'Unit', `Price (${o.currency})`, 'Reference', '', '']) head.append(el('span', undefined, h));
  const list = el('div', 'cost-sys-list');
  const error = el('div', 'cost-error');
  error.setAttribute('role', 'alert');
  const buttons = el('div', 'modal-buttons');
  const foot = el('div', 'cost-sys-foot');
  const table = el('div', 'cost-sys-table');
  table.append(head, list);
  box.append(el('div', 'modal-title', `Cost System · ${system.name}`), bar, table, error, foot, buttons);
  scrim.append(box);

  const childrenOf = (key: string | null) => rows.filter((r) => r.parentKey === key);
  /** La fila y todo lo que cuelga de ella. */
  const branchOf = (key: string): Row[] => {
    const out: Row[] = [];
    const walk = (k: string) => {
      for (const r of rows) if (r.key === k) out.push(r);
      for (const c of childrenOf(k)) walk(c.key);
    };
    walk(key);
    return out;
  };

  function select(options: [string, string][], value: string, cls: string, label: string): HTMLSelectElement {
    const s = el('select', cls);
    s.setAttribute('aria-label', label);
    s.append(...options.map(([v, t]) => Object.assign(el('option', undefined, t), { value: v })));
    s.value = value;
    return s;
  }

  function line(r: Row, depth: number): HTMLElement {
    const row = el('div', 'cost-sys-row');
    const kids = childrenOf(r.key).length > 0;
    const toggle = el('button', 'cost-sys-toggle', kids ? (folded.has(r.key) ? '▸' : '▾') : '');
    toggle.type = 'button';
    toggle.disabled = !kids;
    toggle.setAttribute('aria-label', folded.has(r.key) ? 'Expand' : 'Collapse');
    toggle.addEventListener('click', () => {
      if (folded.has(r.key)) folded.delete(r.key);
      else folded.add(r.key);
      render();
    });
    const code = Object.assign(el('input', 'cost-sys-code'), { type: 'text', value: r.code, readOnly: !r.isNew, placeholder: 'Code' });
    code.setAttribute('aria-label', 'Code');
    code.addEventListener('input', () => (r.code = code.value));
    const name = Object.assign(el('input', 'cost-sys-name'), { type: 'text', value: r.name, placeholder: 'Description' });
    name.setAttribute('aria-label', `Description of ${r.code || 'the new code'}`);
    name.addEventListener('input', () => (r.name = name.value));
    const units: [string, string][] = [['', '—'], ...[...measureOf.keys()].map((u): [string, string] => [u, u])];
    const unit = select(units, r.unit, 'cost-sys-unit', `Unit of ${r.code || 'the new code'}`);
    unit.addEventListener('change', () => {
      // going from heading line to item (or the other way) changes what is seen in the row: the document button
      const kind = !!r.unit !== !!unit.value;
      r.unit = unit.value;
      if (kind) render();
    });
    // the price: written by hand, or the one chosen in the document of the reference
    const price = Object.assign(el('input', 'cost-sys-price'), { type: 'text', value: r.price, placeholder: '—' });
    price.setAttribute('aria-label', `Price of ${r.code || 'the new code'}`);
    price.addEventListener('input', () => {
      r.price = price.value;
      // un precio escrito a mano ya no sale de su documento
      r.origin = null;
      refCell.querySelector('.cost-sys-origin')?.remove();
    });
    // the reference: the file the price came from, and the button to choose it in a document
    const refCell = el('div', 'cost-sys-refcell');
    if (r.unit) {
      const doc = el('button', 'cost-sys-doc');
      doc.type = 'button';
      doc.title = 'Pick the price in a document (Excel, Word, PDF, image)';
      doc.setAttribute('aria-label', doc.title);
      doc.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
      doc.addEventListener('click', () => void pick(r));
      refCell.append(doc);
    } else refCell.append(el('span', 'cost-sys-doc-spacer'));
    if (r.origin) {
      const from = el('span', 'cost-sys-origin', `${docName(r.origin.doc)} · ${refLabel(r.origin.cell)}`);
      from.title = r.origin.doc;
      refCell.append(from);
    }
    const add = el('button', 'cost-sys-add', '+');
    add.type = 'button';
    add.title = 'Add a code under this one';
    add.setAttribute('aria-label', add.title);
    add.addEventListener('click', () => {
      folded.delete(r.key);
      newRow(r.key);
    });
    const del = el('button', 'cost-sys-del', '×');
    del.type = 'button';
    del.title = 'Delete this code and what hangs from it';
    del.setAttribute('aria-label', del.title);
    del.addEventListener('click', () => void remove(r));
    // the indentation of the tree goes only in the code cell: this way the other columns do not move
    const codeCell = el('div', 'cost-sys-codecell');
    codeCell.style.paddingLeft = `${depth * 16}px`;
    codeCell.append(toggle, code);
    row.append(codeCell, name, unit, price, refCell, add, del);
    return row;
  }

  function render(): void {
    const q = search.value.trim().toLowerCase();
    const out: HTMLElement[] = [];
    const walk = (key: string | null, depth: number): void => {
      for (const r of childrenOf(key)) {
        const hit = !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
        if (hit) out.push(line(r, depth));
        if (q || !folded.has(r.key)) walk(r.key, depth + 1);
      }
    };
    walk(null, 0);
    list.replaceChildren(...(out.length ? out : [el('p', 'cost-empty', q ? 'No codes match.' : 'No codes yet. Add one.')]));
    foot.textContent = `${rows.length} codes${o.file ? ` · ${o.file}` : ''}`;
  }

  function newRow(parentKey: string | null): void {
    const r: Row = { key: `new-${++created}`, code: '', name: '', parentKey, unit: '', price: '', origin: null, isNew: true };
    // it goes after the branch of its parent (or at the end)
    const after = parentKey ? branchOf(parentKey).at(-1) : rows.at(-1);
    const at = after ? rows.indexOf(after) + 1 : rows.length;
    rows = [...rows.slice(0, at), r, ...rows.slice(at)];
    search.value = '';
    render();
    const input = [...list.querySelectorAll<HTMLInputElement>('.cost-sys-code')].find((i) => !i.readOnly && i.value === '');
    input?.focus();
  }

  /** Chooses the price of an item in a document; cancelling leaves what there was. */
  async function pick(r: Row): Promise<void> {
    const got = await pickFromDocument({
      target: `${r.code} ${r.name}`.trim(),
      state: docState,
      ...(r.origin ? { picked: r.origin } : {}),
      ...(o.openFile ? { openFile: o.openFile } : {}),
      ...(o.readFile ? { readFile: o.readFile } : {}),
    });
    if (!got) return;
    r.price = String(got.value);
    r.origin = { doc: got.doc, cell: got.cell };
    render();
  }

  async function remove(r: Row): Promise<void> {
    const branch = branchOf(r.key);
    const below = branch.length - 1;
    const lost = r.isNew ? 0 : o.elementsIn?.(r.code) ?? 0;
    if ((below > 0 || lost > 0) && o.confirm) {
      const label = r.code || 'this code';
      const what = below > 0 ? `Delete ${label} and ${below} codes below it?` : `Delete ${label}?`;
      if (!(await o.confirm(lost > 0 ? `${what} ${lost} elements will be left without an item.` : what, 'Delete'))) return;
    }
    const gone = new Set(branch);
    rows = rows.filter((x) => !gone.has(x));
    render();
  }

  /** The entries to save, or a text with what is missing. */
  function entries(): SystemEntry[] | string {
    const seen = new Set<string>();
    for (const r of rows) {
      const c = r.code.trim();
      if (!c) return 'Enter a code';
      if (seen.has(c)) return 'This code already exists';
      seen.add(c);
      if (r.price.trim() !== '') {
        const n = parseNumber(r.price);
        if (n === null || n < 0) return 'Enter a valid number';
      }
    }
    const codeOf = new Map(rows.map((r) => [r.key, r.code.trim()]));
    return rows.map((r) => {
      const unit = r.unit;
      const measure = unit ? measureOf.get(unit) ?? null : null;
      return {
        code: r.code.trim(),
        name: r.name.trim(),
        parent: r.parentKey === null ? null : codeOf.get(r.parentKey) ?? null,
        medicion: unit && measure ? { unit, measure } : null,
        manualPrice: r.price.trim() === '' ? null : parseNumber(r.price),
        origin: r.origin,
      };
    });
  }

  search.addEventListener('input', render);
  addRoot.addEventListener('click', () => newRow(null));
  render();

  return new Promise((resolve) => {
    const finish = (answer: SystemEntry[] | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    const ok = el('button', 'modal-btn modal-btn-primary', 'Save');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      const out = entries();
      if (typeof out === 'string') {
        error.textContent = out;
        return;
      }
      finish(out);
    });
    const cancel = el('button', 'modal-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    buttons.append(ok, cancel);
    // the keyboard does not leave the editor: not even the workspace shortcuts see Esc or Del
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      // con el selector de documentos encima, el editor no atiende al teclado
      if (document.querySelector('.doc-picker')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      }
    });
    document.body.append(scrim);
    search.focus();
  });
}
