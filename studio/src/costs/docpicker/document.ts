import { el, isAmount, numbersIn } from './helpers';
import { parseAmount, type DocBlock, type OcrBox, type PdfPageData, type PdfRun } from '../quoteparse';
import type { DocPickerContext } from './context';

export function installDocument(ctx: DocPickerContext): void {
  ctx.renderDocument = renderDocument;
  ctx.fillLayer = fillLayer;
  ctx.amountsIn = amountsIn;
  /** A Word document as a document: its paragraphs and its tables, without a grid. */
  function renderDocument(blocks: DocBlock[]): void {
    const before = ctx.pickedHere();
    const page = el('div', 'doc-page');
    let paragraphs = 0;
    let tables = 0;
    for (const b of blocks) {
      if (b.kind === 'p') {
        const p = el('p', `doc-row doc-par${b.heading ? ` doc-h${b.heading}` : ''}${b.list ? ' doc-li' : ''}${b.part ? ` doc-${b.part}` : ''}`);
        // in a heading ("2. Windows") the figures are not prices: they are not offered (they can be selected)
        ctx.fillText(p, b.text, `P${++paragraphs}`, before, !b.heading);
        page.append(p);
      } else {
        const t = ++tables;
        const table = el('table', `doc-table${b.part ? ` doc-${b.part}` : ''}`);
        const tbody = el('tbody');
        b.rows.forEach((r, ri) => {
          const tr = el('tr', 'doc-row');
          r.forEach((c, ci) => {
            const td = el('td');
            if (c.span > 1) td.colSpan = c.span;
            ctx.fillText(td, c.text, `T${t}.${ri + 1}.${ci + 1}`, before);
            tr.append(td);
          });
          tbody.append(tr);
        });
        table.append(tbody);
        page.append(table);
      }
    }
    for (const x of page.querySelectorAll('.doc-cell')) {
      if (x.classList.contains('is-picked') || x.querySelector('.is-picked')) x.closest('.doc-row')?.classList.add('is-picked-row');
    }
    ctx.body.replaceChildren(page);
    ctx.body.querySelector<HTMLElement>('.is-picked')?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }

  /** To measure the text and fit it to the width it takes on the page. */
  let ruler: CanvasRenderingContext2D | null | undefined;

  /** A box is being drawn to read it with OCR (the "Read Area (OCR)" button). */
  ctx.boxing = false;

  /** A stretch of text in its place over the page, invisible, with its width. */
  function runSpan(r: PdfRun, ref: string, scale: number, before: ReturnType<typeof ctx.pickedHere>): HTMLElement {
    if (ruler === undefined) ruler = document.createElement('canvas').getContext?.('2d') ?? null;
    const span = el('span', 'pdf-run');
    span.style.left = `${r.x * scale}px`;
    span.style.top = `${r.top * scale}px`;
    span.style.fontSize = `${r.size * scale}px`;
    ctx.fillText(span, r.text, ref, before);
    if (ruler) {
      ruler.font = `${r.size * scale}px sans-serif`;
      const w = ruler.measureText(r.text).width;
      if (w > 0) span.style.transform = `scaleX(${(r.width * scale) / w})`;
    }
    return span;
  }

  const boxKey = (i: number, rect: OcrBox['rect']) => `pg${i + 1}[${rect.join(',')}]`;
  ctx.boxKey = boxKey;

  /** The text of a page over its drawing: its own and that of the boxes read with OCR (marked). */
  function fillLayer(layer: HTMLElement, pg: PdfPageData, i: number, scale: number, before: ReturnType<typeof ctx.pickedHere>): void {
    layer.replaceChildren();
    pg.runs.forEach((r, k) => layer.append(runSpan(r, `pg${i + 1}.${k + 1}`, scale, before)));
    for (const b of pg.boxes ?? []) {
      const [x, y, w, h] = b.rect;
      const frame = el('div', `pdf-box is-read${b.runs.length ? '' : ' is-empty'}`);
      Object.assign(frame.style, { left: `${x * scale}px`, top: `${y * scale}px`, width: `${w * scale}px`, height: `${h * scale}px` });
      frame.dataset.box = boxKey(i, b.rect);
      if (!b.runs.length) frame.append(el('span', 'pdf-box-note', 'No text found here'));
      layer.append(frame);
      b.runs.forEach((r, k) => layer.append(runSpan(r, `${boxKey(i, b.rect)}.${k + 1}`, scale, before)));
    }
  }

  /** The figures that can be chosen in some stretches (the saved cell of each one). */
  function amountsIn(runs: PdfRun[], prefix: string): { value: number; ref: string }[] {
    const out: { value: number; ref: string }[] = [];
    runs.forEach((r, k) => {
      const ref = `${prefix}.${k + 1}`;
      const n = parseAmount(r.text, ctx.s.decimal);
      if (isAmount(r.text, n)) out.push({ value: n!, ref });
      else numbersIn(r.text, ctx.s.decimal).forEach((m, t) => out.push({ value: m.value, ref: `${ref}#${t + 1}` }));
    });
    return out;
  }
}
