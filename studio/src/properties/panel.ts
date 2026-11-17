// Panel Propiedades al estilo Revit: selector de tipo, contador y grupos plegables
// con tabla nombre | valor. Todo el texto del modelo entra con textContent.
import type { ComposedNode, IfcxSchema } from '../ifcx/types';
import { svgIcon, type StudioIcon } from '../shell/icons';
import { buildPropertyGroups, typeHeader, type LinkedProps, type PayloadToggle, type PropertyGroup, type PropertyRow } from './groups';
import type { RefContext } from './references';
import { parseLength, type StudioProps } from './studio';

type Child = Node | string | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  for (const c of children) if (c) e.append(c);
  return e;
}

const FAMILY_ICON: [RegExp, StudioIcon][] = [
  [/wall/i, 'wall'], [/door/i, 'door'], [/window/i, 'window'], [/slab|floor/i, 'floor'], [/roof/i, 'roof'],
  [/column/i, 'column'], [/beam/i, 'beam'], [/stair/i, 'stairs'], [/ramp/i, 'ramp'], [/footing|foundation|pile/i, 'foundation'],
  [/storey/i, 'level'],
];

function familyIcon(family: string): StudioIcon {
  return FAMILY_ICON.find(([re]) => re.test(family))?.[1] ?? 'cube3d';
}

export class PropertiesPanel {
  constructor(private root: HTMLElement) {
    this.root.classList.add('props');
    this.show(null, {});
  }

  /**
   * Con `studio` (documento editable de Studio) las filas con `edit` son campos; con `linked`
   * (linked element in an editable document) its simple attributes too. With `payloads`, the
   * payloads of the node are loaded and unloaded from their checkbox. With `refs`, the References group and the
   * marcas de procedencia por atributo.
   */
  show(node: ComposedNode | null, schemas: Record<string, IfcxSchema>, studio?: StudioProps, linked?: LinkedProps, payloads?: PayloadToggle, refs?: RefContext): void {
    if (!node) {
      this.root.replaceChildren(el('div', 'prop-empty', 'Nothing selected'));
      return;
    }
    const { family, type } = typeHeader(node);

    const selector = el('div', 'prop-type', undefined,
      el('span', 'prop-type-icon', undefined, svgIcon(familyIcon(family), 28)),
      el('div', 'prop-type-text', undefined,
        el('div', 'prop-type-family', family),
        el('div', 'prop-type-name', type)));
    selector.title = `${family} · ${type}`;

    const edit = el('button', 'prop-edit-type', 'Edit Type');
    edit.type = 'button';
    edit.disabled = true;
    edit.title = 'Coming soon';

    const bar = el('div', 'prop-selection', undefined, el('span', 'prop-count', '1 element selected'), edit);

    const body = el('div', 'prop-groups');
    for (const g of buildPropertyGroups(node, schemas, studio, linked, payloads, refs)) body.append(this.group(g));

    this.root.replaceChildren(selector, bar, body);
    this.root.scrollTop = 0;
  }

  /** With a multiple selection, the panel keeps showing the main one but counts all of them. */
  setCount(n: number): void {
    const c = this.root.querySelector('.prop-count');
    if (c) c.textContent = n === 1 ? '1 element selected' : `${n} elements selected`;
  }

  private group(g: PropertyGroup): HTMLElement {
    const details = el('details', 'prop-group', undefined, el('summary', undefined, g.title));
    details.open = true;
    const table = el('table', 'prop-table');
    const tbody = el('tbody');
    for (const r of g.rows) {
      const indent = (r.indent ?? 0) > 0;
      const name = el('td', 'prop-name', indent ? `↳ ${r.label}` : r.label);
      name.title = r.key;
      if (r.mark) {
        const mark = el('span', r.mark.kind === 'overrides' ? 'prop-mark prop-mark-overrides' : 'prop-mark', r.mark.text);
        mark.title = r.mark.title;
        name.append(mark);
      }
      const value = el('td', 'prop-value', r.edit ? undefined : r.value, r.edit ? this.field(r) : null);
      value.title = r.title ?? r.value;
      if (r.actions?.length) {
        // el texto se recorta dentro de su span; los botones quedan fuera y siempre visibles
        const wrap = el('div', 'prop-ref-value', undefined, el('span', 'prop-ref-text', r.value));
        for (const a of r.actions) {
          const btn = el('button', 'prop-action', a.label);
          btn.type = 'button';
          btn.setAttribute('aria-label', a.label);
          btn.addEventListener('click', () => a.run());
          wrap.append(btn);
        }
        value.replaceChildren(wrap);
      }
      const tr = el('tr', undefined, undefined, name, value);
      if (indent) tr.classList.add('prop-indent');
      if (r.missing) tr.classList.add('prop-missing');
      tbody.append(tr);
    }
    table.append(tbody);
    details.append(table);
    return details;
  }

  /** The field of the row and, if the row is edited, the ↺ button that returns it to the value of the file. */
  private field(r: PropertyRow): HTMLElement {
    const control = this.control(r);
    if (!r.reset) return control;
    const reset = el('button', 'prop-reset', '↺');
    reset.type = 'button';
    reset.title = 'Reset to file value';
    reset.setAttribute('aria-label', 'Reset to file value');
    const run = r.reset;
    reset.addEventListener('click', async () => {
      if (reset.disabled) return;
      reset.disabled = true;
      await run();
      reset.disabled = false;
    });
    return el('div', 'prop-field', undefined, control, reset);
  }

  /** Campo de una fila editable: confirma con Enter, al salir o al elegir; Esc la restaura. */
  private control(r: PropertyRow): HTMLElement {
    const edit = r.edit!;
    if (edit.kind === 'bool') {
      const box = el('input', 'prop-check');
      box.type = 'checkbox';
      box.checked = edit.checked;
      box.setAttribute('aria-label', r.label);
      box.addEventListener('change', async () => {
        if (box.disabled) return;
        box.disabled = true;
        const ok = await edit.commit(box.checked);
        box.disabled = false;
        if (!ok) box.checked = edit.checked;
      });
      return box;
    }
    if (edit.kind === 'select') {
      const select = el('select', 'prop-select');
      for (const o of edit.options) {
        const opt = el('option', undefined, o.label);
        opt.value = o.value;
        select.append(opt);
      }
      select.value = edit.selected;
      select.addEventListener('change', async () => {
        if (select.disabled) return;
        select.disabled = true;
        const ok = await edit.commit(select.value);
        select.disabled = false;
        if (!ok) select.value = edit.selected;
      });
      return select;
    }
    const input = el('input', 'prop-input');
    input.type = 'text';
    input.value = r.value;
    input.spellcheck = false;
    const apply = async (): Promise<void> => {
      if (input.disabled || input.value === r.value) return;
      // a number that cannot be read goes back to the previous value without writing anything
      const n = edit.kind === 'number' ? parseLength(input.value) : null;
      if (edit.kind === 'number' && n === null) {
        input.value = r.value;
        return;
      }
      input.disabled = true;
      const ok = await (edit.kind === 'length' ? edit.commit(parseLength(input.value) ?? NaN)
        : edit.kind === 'number' ? edit.commit(n!)
        : edit.commit(input.value));
      input.disabled = false;
      if (!ok) input.value = r.value;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void apply();
      } else if (e.key === 'Escape') {
        e.stopPropagation(); // no deselecciona ni cancela otra herramienta
        input.value = r.value;
      }
    });
    input.addEventListener('blur', () => void apply());
    return input;
  }
}
