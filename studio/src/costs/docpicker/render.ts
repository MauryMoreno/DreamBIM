import { docKey, docName, isPath, el, refLabel } from './helpers';
import type { DocPickerContext } from './context';

export function installRender(ctx: DocPickerContext): void {
  ctx.render = render;
  ctx.reopen = reopen;
  function render(): void {
    ctx.useSel.hidden = true;
    ctx.renderBar();
    ctx.renderTabs();
    ctx.renderGrid();
    const before = ctx.o.picked && ctx.pickedHere() ? ctx.o.picked.cell : null;
    ctx.hint.textContent = !ctx.s.doc
      ? ''
      : before
        ? `Picked before: ${refLabel(before)} · click another number or select any text to change it`
        : 'Click the number with the price per unit, or select it with the mouse';
  }

  /** If the code already had a chosen price, its document is opened (re-reading it if it is not the open one) at its sheet. */
  async function reopen(): Promise<void> {
    const p = ctx.o.picked;
    if (!p) return;
    if (ctx.s.doc && docKey(ctx.s.doc) === p.doc) {
      ctx.s.sheet = ctx.sheetOfPicked(ctx.s.doc);
      render();
      return;
    }
    if (!isPath(p.doc) || !ctx.o.readFile) {
      ctx.error.textContent = `The price came from ${docName(p.doc)}, ${refLabel(p.cell)}; open it again to see where`;
      return;
    }
    ctx.body.replaceChildren(el('p', 'cost-empty', `Opening ${docName(p.doc)}…`));
    try {
      const d = await ctx.o.readFile(p.doc);
      ctx.setDoc(d, ctx.sheetOfPicked(d));
      render();
    } catch (e) {
      ctx.error.textContent = `Could not open ${docName(p.doc)}: ${e instanceof Error ? e.message : String(e)}`;
      render();
    }
  }
}
