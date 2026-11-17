// Choose the price of a table code in a document (quotation, a supplier's list): the document is seen
// as a grid of cells (with a tab per sheet if it is an Excel workbook) and a click on a figure takes it as its
// unit price; in a cell with text ("Valor unitario: $ 452.000") each figure is chosen separately. The
// open document is kept (`DocState`) to choose that of the next code without opening it again, and if the code already
// had a chosen price that document is opened with its cell marked. All inside the app: Excel, Word, CSV or text
// (o texto pegado, copiado de un PDF o de un correo).
import { installChrome } from './docpicker/chrome';
import { installDocs } from './docpicker/docs';
import { installBar } from './docpicker/bar';
import { installPaste } from './docpicker/paste';
import { installDocument } from './docpicker/document';
import { installPdf } from './docpicker/pdf';
import { installGrid } from './docpicker/grid';
import { installRender } from './docpicker/render';
import { installFinish } from './docpicker/finish';
import type { DocPickerContext } from './docpicker/context';
import { PickOptions, Picked } from './docpicker/types';
export type { DocState, PickOptions, Picked } from './docpicker/types';
export { docName, cellName, parseRef, refLabel, numbersIn } from './docpicker/helpers';

let open = false;

/** Abre el documento para elegir un precio; resuelve al precio elegido o null (Cancel, Esc). */
export function pickFromDocument(o: PickOptions): Promise<Picked | null> {

  if (open) return Promise.resolve(null);

  open = true;
  const ctx = { o } as unknown as DocPickerContext;
  installChrome(ctx);
  installDocs(ctx);
  installBar(ctx);
  installPaste(ctx);
  installDocument(ctx);
  installPdf(ctx);
  installGrid(ctx);
  installRender(ctx);
  installFinish(ctx);

  return new Promise((resolve) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ctx.finish = (v) => {
      ctx.scrim.remove();
      open = false;
      if (previous?.isConnected) previous.focus();
      resolve(v);
    };
    ctx.cancel.addEventListener('click', () => ctx.finish(null));
    ctx.body.addEventListener('mouseup', ctx.onSelect);
    ctx.body.addEventListener('keyup', ctx.onSelect);
    ctx.box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (ctx.boxing) ctx.setBoxing(false);
        else ctx.finish(null);
      }
    });
    document.body.append(ctx.scrim);
    // the keyboard goes to the picker (Esc closes it, not the editor underneath)
    ctx.box.tabIndex = -1;
    ctx.box.focus();
    ctx.render();
    void ctx.reopen();
  });
}
