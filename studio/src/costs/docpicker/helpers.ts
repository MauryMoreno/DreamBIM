import { parseAmount, type QuoteSource } from '../quoteparse';

/** How the document is saved in `prj::origen`: its path, or its name if it was pasted text. */
export const docKey = (d: QuoteSource): string => d.path ?? d.name;

/** The name of the document of a saved path. */
export const docName = (doc: string): string => doc.split(/[\\/]/).pop() || doc;

export const isPath = (doc: string): boolean => /[\\/]/.test(doc);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** "C5": the column in letters and the row from 1, as in a spreadsheet. */
export function cellName(row: number, col: number): string {
  let s = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${row + 1}`;
}

/**
 * The parts of a saved cell: `Precios!E3#2` → sheet "Precios", cell E3, second figure; `A7@12-18` → the text
 * selected in cell A7, from character 12 to 18.
 */
export function parseRef(ref: string): { sheet: string | null; cell: string; nth: number | null; range: [number, number] | null } {
  const bang = ref.lastIndexOf('!');
  const sheet = bang >= 0 ? ref.slice(0, bang) : null;
  const rest = ref.slice(bang + 1);
  const sel = /^([^@#]+)@(\d+)-(\d+)$/.exec(rest);
  if (sel) return { sheet, cell: sel[1], nth: null, range: [Number(sel[2]), Number(sel[3])] };
  const [cell, nth] = rest.split('#');
  return { sheet, cell, nth: nth ? Number(nth) : null, range: null };
}

/**
 * A saved cell to read it: "cell E3 of Precios, number 2", "cell A7, selected text"; in a Word document,
 * «paragraph 5» (`P5`) o «table 2, row 3, column 1» (`T2.3.1`); en un PDF, «page 2» (`pg2.15`, su tramo 15).
 */
export function refLabel(ref: string): string {
  const r = parseRef(ref);
  const t = /^T(\d+)\.(\d+)\.(\d+)$/.exec(r.cell);
  const p = /^P(\d+)$/.exec(r.cell);
  const pg = /^pg(\d+)\.\d+$/.exec(r.cell);
  const box = BOX_REF.exec(r.cell);
  const where = t
    ? `table ${t[1]}, row ${t[2]}, column ${t[3]}`
    : p ? `paragraph ${p[1]}` : pg ? `page ${pg[1]}` : box ? `page ${box[1]}, area read with OCR` : `cell ${r.cell}`;
  return `${where}${r.sheet ? ` of ${r.sheet}` : ''}${r.nth ? `, number ${r.nth}` : ''}${r.range ? ', selected text' : ''}`;
}

/**
 * The price of a text selected by hand: the only figure it has (also that of a code, if it is selected
 * solo esa parte). null si no tiene ninguna o tiene varias.
 */
export function amountOfSelection(text: string, decimal: '.' | ','): { value: number; error: null } | { value: null; error: string } {
  const found = text.match(/\d(?:[\d.,]*\d)?/g) ?? [];
  if (!found.length) return { value: null, error: 'The selection has no number' };
  if (found.length > 1) return { value: null, error: 'The selection has several numbers; select only the price' };
  const value = parseAmount(found[0]!, decimal);
  return value === null ? { value: null, error: 'The selection is not a number' } : { value, error: null };
}

/** A lone figure in the cell, with its currency and no other letters. */
export const isAmount = (text: string, n: number | null): boolean =>
  n !== null && /^[-+]?\d[\d.,]*$/.test(text.replace(/us\$|usd|cop|eur|mxn|[$€£\s]/gi, ''));

/**
 * The figures inside a text: loose, not attached to letters nor parts of a code or a date ("AL-501", "5/8",
 * «12/05/2026» no cuentan).
 */
export function numbersIn(text: string, decimal: '.' | ','): { at: number; text: string; value: number }[] {
  const out: { at: number; text: string; value: number }[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d\-/.,])\d(?:[\d.,]*\d)?(?![\p{L}\d\-/]|[.,]\d)/gu)) {
    const value = parseAmount(m[0], decimal);
    if (value !== null) out.push({ at: m.index!, text: m[0], value });
  }
  return out;
}

/** A box read with OCR in a saved cell: `pg2[120,340,80,18].1#1` → page 2, the box, its stretch 1. */
export const BOX_REF = /^pg(\d+)\[(\d+),(\d+),(\d+),(\d+)\]\./;
