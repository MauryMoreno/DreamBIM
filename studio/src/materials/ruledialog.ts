// "Assign by Rule" dialog: choose which elements (class, level, current material) and which material is assigned to them.
import type { MaterialRule } from './catalog';

export interface RuleChoices {
  classes: string[];
  storeys: string[];
  materials: { code: string; name: string }[];
  /** Material that comes out chosen (the one selected in the Browser). */
  target: string | null;
  /** Title of the dialog and label of the target; by default those of "Assign by Rule" with materials. */
  title?: string;
  targetLabel?: string;
  /** false quita el filtro «Current material» (no tiene sentido al clasificar). */
  withCurrent?: boolean;
}

export interface RuleAnswer {
  rule: MaterialRule;
  target: string;
}

const ANY = '__any__';
let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** null if cancelled (Esc, Cancel) or if a dialog is already open. */
export function askRule(c: RuleChoices): Promise<RuleAnswer | null> {
  if (open) return Promise.resolve(null);
  open = true;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal mat-rule');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Assign by Rule');
  const row = el('div', 'modal-buttons');

  const select = (label: string, options: [string, string][], value: string) => {
    const wrap = el('label', 'mat-field');
    const s = el('select');
    s.append(...options.map(([v, text]) => Object.assign(el('option', undefined, text), { value: v })));
    s.value = value;
    wrap.append(el('span', 'mat-field-label', label), s);
    box.append(wrap);
    return s;
  };
  box.prepend(el('div', 'modal-title', c.title ?? 'Assign by Rule'));
  const cls = select('Class', [[ANY, 'Any'], ...c.classes.map((x): [string, string] => [x, x])], ANY);
  const storey = select('Level', [[ANY, 'Any'], ...c.storeys.map((x): [string, string] => [x, x])], ANY);
  const current =
    c.withCurrent === false
      ? null
      : select('Current material', [[ANY, 'Any'], ['', 'No material'], ...c.materials.map((m): [string, string] => [m.code, m.name])], ANY);
  const target = select(c.targetLabel ?? 'Assign material', c.materials.map((m): [string, string] => [m.code, m.name]), c.target ?? c.materials[0]?.code ?? '');
  box.append(row);
  scrim.append(box);

  return new Promise((resolve) => {
    const finish = (answer: RuleAnswer | null) => {
      scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(answer);
    };
    const ok = el('button', 'modal-btn modal-btn-primary', 'Assign');
    ok.type = 'button';
    ok.disabled = c.materials.length === 0;
    ok.addEventListener('click', () => {
      const rule: MaterialRule = {};
      if (cls.value !== ANY) rule.cls = cls.value;
      if (storey.value !== ANY) rule.storey = storey.value;
      if (current && current.value !== ANY) rule.material = current.value;
      finish({ rule, target: target.value });
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
      }
    });
    document.body.append(scrim);
    cls.focus();
  });
}
