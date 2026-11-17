import { docKey, el, isAmount, numbersIn } from './helpers';
import { gridFromText, parseAmount } from '../quoteparse';
import type { DocPickerContext } from './context';

export function installPaste(ctx: DocPickerContext): void {
  ctx.renderPaste = renderPaste;
  ctx.fillText = fillText;
  function renderPaste(): void {
    const wrap = el('div', 'doc-picker-paste');
    const area = el('textarea', 'quote-paste');
    area.placeholder = 'Paste the quote here (copied from a PDF, an e-mail or a spreadsheet)';
    area.setAttribute('aria-label', 'Pasted text');
    const use = el('button', 'cost-btn', 'Use This Text');
    use.type = 'button';
    use.addEventListener('click', () => {
      if (!area.value.trim()) return;
      ctx.setDoc({ name: 'Pasted text', grid: gridFromText(area.value) });
      ctx.render();
    });
    wrap.append(area, use);
    ctx.tabs.hidden = true;
    ctx.body.replaceChildren(wrap);
    area.focus();
  }

  /** Hace que un elemento se elija con clic o Enter. */
  const pickable = (e: HTMLElement, value: number, ref: string) => {
    e.classList.add('is-pickable');
    e.tabIndex = 0;
    e.title = `Use ${value} as the price`;
    e.dataset.ref = ref;
    const take = () => ctx.finish({ value, cell: ref, doc: docKey(ctx.s.doc!), name: ctx.s.doc!.name });
    // when releasing after dragging to select text the figure is not chosen: the selection counts
    e.addEventListener('click', () => {
      if (!ctx.selectionInGrid()) take();
    });
    e.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') take();
    });
  };

  /**
   * The text of a cell or a paragraph, choosable: whole if it is a lone figure; otherwise, each loose figure; and marked what
   * was chosen before (the figure, or the text selected by hand).
   */
  function fillText(box: HTMLElement, text: string, ref: string, before: ReturnType<typeof ctx.pickedHere>, numbers = true): void {
    box.classList.add('doc-cell');
    box.dataset.cell = ref;
    const n = text ? parseAmount(text, ctx.s.decimal) : null;
    const local = ref.slice(ctx.sheetPrefix().length);
    if (before?.range && before.cell === local) {
      const [a, b] = before.range;
      box.append(text.slice(0, a), el('mark', 'doc-sel is-picked', text.slice(a, b)), text.slice(b));
    } else if (isAmount(text, n)) {
      box.textContent = text;
      pickable(box, n!, ref);
      if (before && before.cell === local && !before.nth) box.classList.add('is-picked');
    } else {
      // with text: each figure is chosen separately
      const nums = text && numbers ? numbersIn(text, ctx.s.decimal) : [];
      let at = 0;
      nums.forEach((m, k) => {
        if (m.at > at) box.append(text.slice(at, m.at));
        const span = el('span', 'doc-num', m.text);
        pickable(span, m.value, `${ref}#${k + 1}`);
        if (before && before.cell === local && before.nth === k + 1) span.classList.add('is-picked');
        box.append(span);
        at = m.at + m.text.length;
      });
      if (at < text.length) box.append(text.slice(at));
    }
  }
}
