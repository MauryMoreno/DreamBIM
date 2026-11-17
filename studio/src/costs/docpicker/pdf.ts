import { docKey, el, parseRef, refLabel, BOX_REF } from './helpers';
import { type OcrBox, type PdfDoc, type PdfPageData, type PdfRun } from '../quoteparse';
import type { DocPickerContext } from './context';

export function installPdf(ctx: DocPickerContext): void {
  ctx.setBoxing = setBoxing;
  ctx.renderPdf = renderPdf;
  /**
   * Reads with OCR a box of a page and puts its text on top, to choose it; if the box has a single figure,
   * the button offers it directly.
   */
  async function readBox(pdf: PdfDoc, pg: PdfPageData, i: number, rect: OcrBox['rect'], wrap: HTMLElement, layer: HTMLElement, scale: number): Promise<void> {
    const [x, y, w, h] = rect;
    const frame = el('div', 'pdf-box is-reading');
    Object.assign(frame.style, { left: `${x * scale}px`, top: `${y * scale}px`, width: `${w * scale}px`, height: `${h * scale}px` });
    const note = el('span', 'pdf-box-note', 'Reading (OCR)…');
    frame.append(note);
    layer.append(frame);
    ctx.hint.textContent = 'Reading the text in the box with OCR…';
    let runs: PdfRun[];
    try {
      runs = await pdf.scanBox!(i, rect, (p, status) => {
        note.textContent = /recogni/i.test(status) ? `Reading (OCR)… ${Math.round(p * 100)}%` : 'Preparing the text recognition…';
      });
    } catch (e) {
      frame.classList.replace('is-reading', 'is-error');
      note.textContent = e instanceof Error ? e.message : String(e);
      ctx.hint.textContent = '';
      return;
    }
    pg.boxes = [...(pg.boxes ?? []).filter((b) => b.rect.join() !== rect.join()), { rect, runs }];
    if (!wrap.isConnected) return;
    ctx.fillLayer(layer, pg, i, scale, ctx.pickedHere());
    wrap.querySelector('.pdf-page-empty')?.remove();
    const found = ctx.amountsIn(runs, ctx.boxKey(i, rect));
    const text = runs.map((r) => r.text).join(' ');
    if (!runs.length) ctx.hint.textContent = 'No text was found in the box: draw it again, a little bigger';
    else if (ctx.o.picked && layer.querySelector('.is-picked')) {
      // it is the box of the earlier price, re-read on opening
      ctx.hint.textContent = `Picked before: ${refLabel(ctx.o.picked.cell)} · click another number or select any text to change it`;
    } else if (found.length === 1) {
      const only = found[0];
      ctx.hint.textContent = `Read with OCR: “${text}”`;
      ctx.useSel.hidden = false;
      ctx.useSel.textContent = `Use ${only.value}`;
      ctx.useSel.title = `Use ${only.value} (read with OCR) as the price`;
      ctx.useSel.onclick = () => ctx.finish({ value: only.value, cell: only.ref, doc: docKey(ctx.s.doc!), name: ctx.s.doc!.name });
    } else ctx.hint.textContent = `Read with OCR: “${text}” · click the number with the price`;
    layer.querySelector<HTMLElement>('.is-picked')?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }

  /** Draw a box with the mouse over a page; on release it is read with OCR. */
  function boxTool(pdf: PdfDoc, pg: PdfPageData, i: number, wrap: HTMLElement, layer: HTMLElement, scale: number): void {
    wrap.addEventListener('mousedown', (e) => {
      if (!ctx.boxing || e.button !== 0) return;
      e.preventDefault();
      const at = wrap.getBoundingClientRect();
      const x0 = e.clientX - at.left;
      const y0 = e.clientY - at.top;
      const frame = el('div', 'pdf-box is-drawing');
      layer.append(frame);
      let rect: [number, number, number, number] = [x0, y0, 0, 0];
      const move = (ev: MouseEvent) => {
        const x1 = Math.max(0, Math.min(at.width || Infinity, ev.clientX - at.left));
        const y1 = Math.max(0, Math.min(at.height || Infinity, ev.clientY - at.top));
        rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
        Object.assign(frame.style, { left: `${rect[0]}px`, top: `${rect[1]}px`, width: `${rect[2]}px`, height: `${rect[3]}px` });
      };
      const up = (ev: MouseEvent) => {
        move(ev);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        frame.remove();
        if (rect[2] < 6 || rect[3] < 6) return;
        setBoxing(false);
        // in page units, as integers (that is how it is saved)
        const inPage = rect.map((v) => Math.round(v / scale)) as OcrBox['rect'];
        void readBox(pdf, pg, i, inPage, wrap, layer, scale);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  function setBoxing(on: boolean): void {
    ctx.boxing = on;
    ctx.body.classList.toggle('is-boxing', on);
    ctx.bar.querySelector('.doc-picker-box')?.setAttribute('aria-pressed', String(on));
    if (on) {
      ctx.useSel.hidden = true;
      ctx.hint.textContent = 'Draw a box around the price to read it with OCR (Esc to cancel)';
    }
  }

  /**
   * A PDF (or an image) as it is: each page drawn (when it is seen) and its text on top, invisible but in place,
   * to click on a figure or select any part. What is an image (a scan, a photo, a table
   * pegada como imagen) se lee con OCR solo donde se dibuja un recuadro.
   */
  function renderPdf(pdf: PdfDoc): void {
    const before = ctx.pickedHere();
    const pages = el('div', 'pdf-pages');
    const avail = ctx.body.clientWidth - 48;
    const draws: (() => void)[] = [];
    const reread: (() => void)[] = [];
    // the box the earlier price came from, to read it again
    const prevBox = ctx.o.picked && ctx.s.doc && docKey(ctx.s.doc) === ctx.o.picked.doc ? BOX_REF.exec(parseRef(ctx.o.picked.cell).cell) : null;
    pdf.pages.forEach((pg, i) => {
      // the page at the width of the modal (without exceeding twice its size)
      const scale = avail > 200 ? Math.min(2, avail / pg.width) : 1.3;
      const wrap = el('div', 'pdf-page');
      wrap.style.width = `${pg.width * scale}px`;
      wrap.style.height = `${pg.height * scale}px`;
      const canvas = el('canvas', 'pdf-canvas');
      const layer = el('div', 'pdf-text');
      ctx.fillLayer(layer, pg, i, scale, before);
      wrap.append(canvas, layer, el('div', 'pdf-pageno', `Page ${i + 1} of ${pdf.pages.length}`));
      if (pdf.scanBox) boxTool(pdf, pg, i, wrap, layer, scale);
      if (!pg.runs.length && !pg.boxes?.length && pdf.scanBox) {
        wrap.append(el('div', 'pdf-ocr pdf-page-empty', 'This page is an image: use Read Area (OCR) and draw a box around the price'));
      }
      pages.append(wrap);
      let drawn = false;
      const draw = () => {
        if (drawn) return;
        drawn = true;
        pdf.render(i, canvas, scale).catch(() => wrap.classList.add('is-broken'));
      };
      draws.push(draw);
      wrap.dataset.page = String(i);
      if (prevBox && Number(prevBox[1]) === i + 1) {
        const rect = prevBox.slice(2, 6).map(Number) as OcrBox['rect'];
        if (!pg.boxes?.some((b) => b.rect.join() === rect.join())) {
          reread.push(() => {
            draw();
            wrap.scrollIntoView?.({ block: 'start' });
            void readBox(pdf, pg, i, rect, wrap, layer, scale);
          });
        }
      }
    });
    ctx.body.replaceChildren(pages);
    if (!pdf.scanBox && !pdf.pages.some((pg) => pg.runs.length)) ctx.error.textContent = 'This PDF has no text (it may be a scan): its prices cannot be picked; copy them by hand';
    // each page is drawn when it is seen (a long PDF is not drawn whole on opening)
    if (typeof IntersectionObserver === 'function') {
      const seen = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) draws[Number((e.target as HTMLElement).dataset.page)]?.();
      }, { root: ctx.body, rootMargin: '400px' });
      for (const w of pages.children) seen.observe(w);
    } else draws.forEach((d) => d());
    const mark = ctx.body.querySelector<HTMLElement>('.is-picked');
    if (mark) {
      draws[Number(mark.closest<HTMLElement>('.pdf-page')?.dataset.page ?? 0)]?.();
      mark.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    }
    // the earlier price came from a box read with OCR: only that box is read again
    reread.forEach((f) => f());
  }
}
