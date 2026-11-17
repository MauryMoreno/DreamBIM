// Dialog of a code of the cost system (item or heading line): description, heading line it hangs from,
// measurement, price reference and manual price. The code is not edited: changing it would break the assignments.
import type { CodeEdit } from './edit';
import { docName, refLabel } from './docpicker';
import { parseNumber } from './format';
import { DEFAULT_UNIT, MEASURES, type CostCode, type CostSystem, type Measure } from './system';

const NONE = 'none';
const MEASURE_LABELS: Record<Measure, string> = { count: 'Count', length: 'Length', area: 'Area', volume: 'Volume', weight: 'Weight' };
let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The code itself and everything that hangs from it. */
function branchOf(system: CostSystem, code: string): Set<string> {
  const out = new Set<string>();
  const walk = (c: string) => {
    if (out.has(c)) return;
    out.add(c);
    for (const k of system.children(c)) walk(k.code);
  };
  walk(code);
  return out;
}

/** null if cancelled (Esc, Cancel) or if a dialog is already open. */
export function askCode(code: CostCode, system: CostSystem): Promise<CodeEdit | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal cost-item-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Cost item');
  box.append(el('div', 'modal-title', 'Cost item'));

  const field = <T extends HTMLElement>(label: string, control: T): T => {
    const wrap = el('label', 'cost-field');
    wrap.append(el('span', 'cost-field-label', label), control);
    box.append(wrap);
    return control;
  };
  const text = (value: string) => Object.assign(el('input'), { type: 'text', value });
  const select = (options: [string, string][], value: string) => {
    const s = el('select');
    s.append(...options.map(([v, t]) => Object.assign(el('option', undefined, t), { value: v })));
    s.value = value;
    return s;
  };

  const codeField = field('Code', Object.assign(text(code.code), { readOnly: true }));
  const name = field('Description', text(code.name));
  // it only hangs from a heading line that is neither itself nor one of its descendants (and from its current parent, even if it is not)
  const own = branchOf(system, code.code);
  const headings = system.codes.filter((c) => !c.medicion && !own.has(c.code));
  const parents: [string, string][] = [['', 'None']];
  if (code.parent && !headings.some((h) => h.code === code.parent)) parents.push([code.parent, code.parent]);
  parents.push(...headings.map((h): [string, string] => [h.code, `${h.code} ${h.name}`]));
  const parent = field('Heading', select(parents, code.parent ?? ''));
  const measure = field('Measure', select([[NONE, 'None (heading)'], ...MEASURES.map((m): [string, string] => [m, MEASURE_LABELS[m]])], code.medicion?.measure ?? NONE));
  const unit = field('Unit', text(code.medicion?.unit ?? ''));
  const manual = field('Manual price', text(code.manualPrice === null ? '' : String(code.manualPrice)));
  // un precio escrito a mano ya no sale de su documento
  let priceTyped = false;
  manual.addEventListener('input', () => (priceTyped = true));
  const status = el('div', 'cost-price-status');
  box.append(status);
  const error = el('div', 'cost-error');
  error.setAttribute('role', 'alert');
  box.append(error);

  // where the price comes from: the file of its reference, or written by hand
  const sync = (): void => {
    status.textContent = code.origin && !priceTyped ? `From ${docName(code.origin.doc)} · ${refLabel(code.origin.cell)}` : 'Manual price';
  };
  sync();
  manual.addEventListener('input', sync);

  let unitTouched = !!code.medicion && code.medicion.unit !== '' && code.medicion.unit !== DEFAULT_UNIT[code.medicion.measure];
  unit.addEventListener('input', () => (unitTouched = true));
  measure.addEventListener('change', () => {
    if (!unitTouched && measure.value !== NONE) unit.value = DEFAULT_UNIT[measure.value as Measure];
  });

  const row = el('div', 'modal-buttons');
  box.append(row);
  scrim.append(box);

  return new Promise((resolve) => {
    const finish = (answer: CodeEdit | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    const ok = el('button', 'modal-btn modal-btn-primary', 'Save');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      const description = name.value.trim();
      if (!description) {
        error.textContent = 'Enter a description';
        return;
      }
      const raw = manual.value.trim();
      const price = raw === '' ? null : parseNumber(raw);
      if (raw !== '' && (price === null || price < 0)) {
        error.textContent = 'Enter a valid number';
        return;
      }
      const m = measure.value === NONE ? null : (measure.value as Measure);
      finish({
        name: description,
        parent: parent.value || null,
        medicion: m ? { unit: unit.value.trim() || DEFAULT_UNIT[m], measure: m } : null,
        manualPrice: price,
        ...(priceTyped ? { origin: null } : {}),
      });
    });
    const cancel = el('button', 'modal-btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => finish(null));
    row.append(ok, cancel);
    // the keyboard does not leave the dialog: not even the workspace shortcuts see Esc or Del
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target !== codeField) {
        e.preventDefault();
        ok.click();
      }
    });
    document.body.append(scrim);
    name.focus();
  });
}
