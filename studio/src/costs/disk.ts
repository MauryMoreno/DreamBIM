// Costs disk: open and re-read a price document (quotation) as a grid, to choose a price.
import { files } from '../platform/files';
import { errorMessage, fileName } from '../model/open';
import { decodeText, rowsFromCsv, sheetsFromXlsx } from './docread';
import { blocksFromDocx, gridOfBlocks } from './docx';
import { gridOfPdf, readImage, readPdf } from './pdf';
import { gridFromText, type QuoteSource } from './quoteparse';

/** Price document dialog and reading as a grid: Excel (.xlsx), CSV or text. null if cancelled. */
export async function pickQuoteFile(): Promise<QuoteSource | null> {
  const picked = await files().pickOpen([
    { name: 'Quote or price list (PDF, Excel, Word, image, CSV, text)', extensions: ['pdf', 'xlsx', 'docx', 'jpg', 'jpeg', 'png', 'csv', 'txt', 'tsv'] },
  ]);
  return picked === null ? null : readQuoteFile(picked);
}

/** Lee un documento de precios (PDF, Excel con todas sus hojas, Word, CSV o texto) como rejilla de celdas. */
export async function readQuoteFile(path: string): Promise<QuoteSource> {
  let bytes: Uint8Array;
  try {
    bytes = await files().readBinary(path);
  } catch (e) {
    throw new Error(errorMessage(e));
  }
  const name = fileName(path);
  if (/\.xlsx$/i.test(name)) {
    const sheets = (await sheetsFromXlsx(bytes, true)).map((s) => ({ name: s.name, grid: s.rows }));
    return { name, path, grid: sheets[0].grid, sheets };
  }
  if (/\.(jpe?g|png)$/i.test(name)) {
    const pdf = await readImage(bytes, /\.png$/i.test(name) ? 'image/png' : 'image/jpeg');
    return { name, path, grid: [], pdf };
  }
  if (/\.pdf$/i.test(name)) {
    const pdf = await readPdf(bytes);
    return { name, path, grid: gridOfPdf(pdf.pages), pdf };
  }
  if (/\.docx$/i.test(name)) {
    const blocks = await blocksFromDocx(bytes);
    return { name, path, grid: gridOfBlocks(blocks), blocks };
  }
  if (/\.csv$/i.test(name)) return { name, path, grid: rowsFromCsv(decodeText(bytes)) };
  return { name, path, grid: gridFromText(decodeText(bytes)) };
}
