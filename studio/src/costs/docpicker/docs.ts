import { docKey, parseRef } from './helpers';
import { guessDecimal, type Grid, type QuoteSource } from '../quoteparse';
import type { DocPickerContext } from './context';

export function installDocs(ctx: DocPickerContext): void {
  /** The sheets of the document: those of the workbook, or a single unnamed one. */
  const sheetsOf = (d: QuoteSource) => (d.sheets?.length ? d.sheets : [{ name: '', grid: d.grid }]);
  ctx.sheetsOf = sheetsOf;

  const sheetIndex = () => Math.max(0, Math.min(ctx.s.sheet ?? 0, ctx.s.doc ? sheetsOf(ctx.s.doc).length - 1 : 0));
  ctx.sheetIndex = sheetIndex;

  const currentGrid = (): Grid => (ctx.s.doc ? sheetsOf(ctx.s.doc)[sheetIndex()].grid : []);
  ctx.currentGrid = currentGrid;

  /** El nombre de la hoja en la celda guardada, solo si el libro tiene varias. */
  const sheetPrefix = () => (ctx.s.doc && sheetsOf(ctx.s.doc).length > 1 ? `${sheetsOf(ctx.s.doc)[sheetIndex()].name}!` : '');
  ctx.sheetPrefix = sheetPrefix;

  const setDoc = (d: QuoteSource, sheet = 0) => {
    ctx.s.doc = d;
    ctx.s.sheet = sheet;
    ctx.s.decimal = guessDecimal(sheetsOf(d)[sheet]?.grid ?? d.grid);
  };
  ctx.setDoc = setDoc;

  /** The sheet of the saved cell (the first if it does not say which or it no longer exists). */
  const sheetOfPicked = (d: QuoteSource): number => {
    const r = ctx.o.picked ? parseRef(ctx.o.picked.cell) : null;
    return r?.sheet ? Math.max(0, sheetsOf(d).findIndex((x) => x.name === r.sheet)) : 0;
  };
  ctx.sheetOfPicked = sheetOfPicked;

  /** The previous cell, only if the open document (and the sheet shown) is the one it was chosen from. */
  const pickedHere = (): { cell: string; nth: number | null; range: [number, number] | null } | null => {
    if (!ctx.o.picked || !ctx.s.doc || docKey(ctx.s.doc) !== ctx.o.picked.doc) return null;
    const r = parseRef(ctx.o.picked.cell);
    const sheets = sheetsOf(ctx.s.doc);
    const here = r.sheet ? sheets.length > 1 && sheets[sheetIndex()].name === r.sheet : sheetIndex() === 0;
    return here ? { cell: r.cell, nth: r.nth, range: r.range } : null;
  };
  ctx.pickedHere = pickedHere;
}
