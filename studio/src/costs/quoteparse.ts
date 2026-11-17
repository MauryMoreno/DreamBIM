// Read a price document (quotation, a supplier's list) inside the app and without external services: the
// document becomes a grid of cells from which the wanted value is chosen, and the numbers are read with their
// separador decimal y de miles. Puro.

/** Una rejilla de celdas: filas de texto. */
export type Grid = string[][];

/** Una hoja de un libro de Excel. */
export interface QuoteSheet {
  name: string;
  grid: Grid;
}

/** A block of a Word document: a paragraph (perhaps a heading or a list item) or a table. */
export type DocBlock =
  | { kind: 'p'; text: string; heading?: number; list?: boolean; part?: 'header' | 'footer' }
  | { kind: 'table'; rows: { text: string; span: number }[][]; part?: 'header' | 'footer' };

/** A stretch of text of a PDF page: its text and where it is (in points, from the top left). */
export interface PdfRun {
  text: string;
  x: number;
  top: number;
  width: number;
  size: number;
}

/** A page of a PDF: its size in points and its text. */
export interface PdfPageData {
  width: number;
  height: number;
  runs: PdfRun[];
  /** The boxes of the page that were read with OCR, with their text (in the same units as the page). */
  boxes?: OcrBox[];
}

/** A box `[x, y, width, height]` of a page (in its units) read with OCR, and the text that came out. */
export interface OcrBox {
  rect: [number, number, number, number];
  runs: PdfRun[];
}

/**
 * An open PDF (or image): its pages and how to draw one (the `index`, from 0) on a canvas at a scale; and,
 * if possible, how to read with OCR only a box `[x, y, width, height]` of a page (it gives its text, in the units
 * of the page).
 */
export interface PdfDoc {
  pages: PdfPageData[];
  render(index: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  scanBox?(index: number, rect: OcrBox['rect'], progress?: (progress: number, status: string) => void): Promise<PdfRun[]>;
}

/** Un documento abierto: su nombre y sus celdas (las de su primera hoja, y todas sus hojas si es un libro). */
export interface QuoteSource {
  name: string;
  /** Su ruta en el disco, para volver a abrirlo; falta en el texto pegado. */
  path?: string;
  grid: Grid;
  /** Las hojas de un libro de Excel, en su orden; `grid` es la primera. */
  sheets?: QuoteSheet[];
  /** A Word document: it is seen as a document (paragraphs and tables), not as a grid. */
  blocks?: DocBlock[];
  /** A PDF: its pages are seen as they are, with their text on top to choose it. */
  pdf?: PdfDoc;
}

/** Pasted text or from a .txt: rows by lines and cells by tab, `;`, `|` or two or more spaces. */
export function gridFromText(text: string): Grid {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const tabs = lines.filter((l) => l.includes('\t')).length;
  const semis = lines.filter((l) => l.includes(';')).length;
  const pipes = lines.filter((l) => l.includes('|')).length;
  const most = Math.max(tabs, semis, pipes);
  const split = (l: string): string[] => {
    if (most > 0 && most >= lines.length / 2) {
      const sep = most === tabs ? '\t' : most === semis ? ';' : '|';
      return l.split(sep);
    }
    return l.split(/\s{2,}/);
  };
  return lines.map((l) => split(l).map((c) => c.trim())).map((r) => (r[0] === '' && r.length > 1 ? r.slice(1) : r));
}

/**
 * A number from a document: without currency or spaces, with its decimal separator and the thousands one that applies
 * ("$ 1.234,50" with comma → 1234.5; "1,234.50" with point → 1234.5). null if it is not a number.
 */
export function parseAmount(text: string, decimal: '.' | ','): number | null {
  let t = text.replace(/[^\d.,\-]/g, '');
  if (!/\d/.test(t)) return null;
  t = decimal === ',' ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The most likely decimal separator of the document: the last sign of the figures with one or two decimals. */
export function guessDecimal(grid: Grid): '.' | ',' {
  let comma = 0;
  let dot = 0;
  for (const r of grid) {
    for (const c of r) {
      const t = c.trim();
      const m = /\d([.,])\d{1,2}\s*$/.exec(t);
      if (m) (m[1] === ',' ? comma++ : dot++);
      // a whole price with a thousands separator ("452.000", "1,250,000") votes for the other sign as the decimal
      else if (/\d{1,3}(\.\d{3})+\s*$/.test(t)) comma++;
      else if (/\d{1,3}(,\d{3})+\s*$/.test(t)) dot++;
    }
  }
  return comma > dot ? ',' : '.';
}
