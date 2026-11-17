import { el } from './helpers';
import { guessDecimal } from '../quoteparse';
import type { DocPickerContext } from './context';

export function installBar(ctx: DocPickerContext): void {
  ctx.renderBar = renderBar;
  ctx.renderTabs = renderTabs;
  function renderBar(): void {
    const parts: HTMLElement[] = [];
    if (ctx.o.openFile) {
      const openBtn = el('button', 'cost-btn', ctx.s.doc ? 'Open Another File…' : 'Open File…');
      openBtn.type = 'button';
      openBtn.title = 'Excel (.xlsx), Word (.docx), CSV or text';
      openBtn.addEventListener('click', async () => {
        try {
          const d = await ctx.o.openFile!();
          if (!d) return;
          ctx.setDoc(d);
          ctx.error.textContent = '';
          ctx.render();
        } catch (e) {
          ctx.error.textContent = e instanceof Error ? e.message : String(e);
        }
      });
      parts.push(openBtn);
    }
    const pasteBtn = el('button', 'cost-btn', 'Paste Text…');
    pasteBtn.type = 'button';
    pasteBtn.addEventListener('click', () => ctx.renderPaste());
    parts.push(pasteBtn);
    if (ctx.s.doc?.pdf?.scanBox) {
      // read with OCR only a box of the page: what is an image (a scan, a table pasted as an image)
      const boxBtn = el('button', 'cost-btn doc-picker-box', 'Read Area (OCR)');
      boxBtn.type = 'button';
      boxBtn.title = 'Draw a box on the page to read only that area with OCR';
      boxBtn.setAttribute('aria-pressed', String(ctx.boxing));
      boxBtn.addEventListener('click', () => ctx.setBoxing(!ctx.boxing));
      parts.push(boxBtn);
    }
    if (ctx.s.doc) {
      const name = el('span', 'doc-picker-name', ctx.s.doc.name);
      if (ctx.s.doc.path) name.title = ctx.s.doc.path;
      parts.push(name);
      const dec = el('select');
      dec.setAttribute('aria-label', 'Decimal separator');
      dec.append(Object.assign(el('option', undefined, '1.234,50'), { value: ',' }), Object.assign(el('option', undefined, '1,234.50'), { value: '.' }));
      dec.value = ctx.s.decimal;
      dec.addEventListener('change', () => {
        ctx.s.decimal = dec.value as ',' | '.';
        ctx.render();
      });
      parts.push(dec);
      const search = el('input', 'cost-search');
      search.type = 'search';
      search.placeholder = 'Filter rows';
      search.setAttribute('aria-label', 'Filter rows');
      search.addEventListener('input', () => filterRows(search.value));
      parts.push(search);
    }
    ctx.bar.replaceChildren(...parts);
  }

  /** One tab per sheet of the workbook; none if it has only one. */
  function renderTabs(): void {
    const sheets = ctx.s.doc ? ctx.sheetsOf(ctx.s.doc) : [];
    ctx.tabs.hidden = sheets.length < 2;
    ctx.tabs.replaceChildren(
      ...(sheets.length < 2
        ? []
        : sheets.map((sh, i) => {
            const t = el('button', 'doc-picker-sheet', sh.name);
            t.type = 'button';
            t.setAttribute('role', 'tab');
            t.setAttribute('aria-selected', String(i === ctx.sheetIndex()));
            t.addEventListener('click', () => {
              ctx.s.sheet = i;
              ctx.s.decimal = guessDecimal(sh.grid);
              ctx.render();
            });
            return t;
          })),
    );
  }

  function filterRows(q: string): void {
    const t = q.trim().toLowerCase();
    for (const tr of ctx.body.querySelectorAll<HTMLElement>('.doc-row')) tr.hidden = !!t && !tr.textContent!.toLowerCase().includes(t);
  }
}
