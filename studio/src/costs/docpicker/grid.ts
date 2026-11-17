import { docKey, el, cellName, refLabel, amountOfSelection } from './helpers';
import type { DocPickerContext } from './context';

export function installGrid(ctx: DocPickerContext): void {
  ctx.renderGrid = renderGrid;
  ctx.selectionInGrid = selectionInGrid;
  ctx.onSelect = onSelect;
  function renderGrid(): void {
    if (!ctx.s.doc) {
      ctx.body.replaceChildren(el('p', 'cost-empty', ctx.o.openFile ? 'Open the quote or paste its text.' : 'Paste the text of the quote.'));
      return;
    }
    if (ctx.s.doc.blocks) {
      ctx.renderDocument(ctx.s.doc.blocks);
      return;
    }
    if (ctx.s.doc.pdf) {
      ctx.renderPdf(ctx.s.doc.pdf);
      return;
    }
    const grid = ctx.currentGrid();
    if (!grid.length) {
      ctx.body.replaceChildren(el('p', 'cost-empty', 'This sheet is empty.'));
      return;
    }
    const before = ctx.pickedHere();
    const prefix = ctx.sheetPrefix();
    const width = Math.max(1, ...grid.map((r) => r.length));
    const table = el('table', 'doc-grid');
    const head = el('tr');
    head.append(el('th', 'doc-rowno'));
    for (let j = 0; j < width; j++) head.append(el('th', undefined, cellName(0, j).replace(/\d+$/, '')));
    table.append(el('thead'), el('tbody'));
    table.tHead!.append(head);
    grid.forEach((r, i) => {
      const tr = el('tr', 'doc-row');
      tr.append(el('td', 'doc-rowno', String(i + 1)));
      for (let j = 0; j < width; j++) {
        const td = el('td');
        ctx.fillText(td, r[j] ?? '', `${prefix}${cellName(i, j)}`, before);
        if (td.classList.contains('is-picked') || td.querySelector('.is-picked')) tr.classList.add('is-picked-row');
        tr.append(td);
      }
      table.tBodies[0].append(tr);
    });
    ctx.body.replaceChildren(table);
    // la celda de antes, a la vista
    ctx.body.querySelector<HTMLElement>('.is-picked')?.scrollIntoView?.({ block: 'center', inline: 'center' });
  }

  /** The text selection inside a grid cell: its cell, where it starts and ends and its text. */
  function selectionInGrid(): { td: HTMLElement; from: number; to: number; text: string } | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const cellOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('.doc-cell') ?? null;
    const td = cellOf(range.startContainer);
    if (!td || td !== cellOf(range.endContainer) || !ctx.body.contains(td)) return null;
    const lead = document.createRange();
    lead.setStart(td, 0);
    lead.setEnd(range.startContainer, range.startOffset);
    const raw = range.toString();
    // sin los espacios de los bordes
    const from = lead.toString().length + (raw.length - raw.trimStart().length);
    const text = raw.trim();
    return text ? { td, from, to: from + text.length, text } : null;
  }

  /** What is selected: if it has a figure, the button offers it as a price. */
  function onSelect(): void {
    const got = selectionInGrid();
    if (!got) {
      ctx.useSel.hidden = true;
      return;
    }
    const a = amountOfSelection(got.text, ctx.s.decimal);
    ctx.error.textContent = a.error ?? '';
    ctx.useSel.hidden = a.value === null;
    if (a.value === null) return;
    const ref = `${got.td.dataset.cell}@${got.from}-${got.to}`;
    ctx.useSel.textContent = `Use ${a.value}`;
    ctx.useSel.title = `Use “${got.text}” (${refLabel(ref)}) as the price`;
    ctx.useSel.onclick = () => ctx.finish({ value: a.value, cell: ref, doc: docKey(ctx.s.doc!), name: ctx.s.doc!.name });
  }
}
