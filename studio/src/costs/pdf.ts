// Read a PDF inside the app with pdf.js (Mozilla, Apache-2.0): each page is drawn as it is and its text is
// known with its position, to choose a figure or any text over the page. pdf.js gives the text in pieces;
// the pieces of the same line that are together are joined into stretches ("$ 452,00" ends up in one), as pdfplumber does.
// pdf.js is loaded only when a PDF is opened. A box of a page (scanned, or with an image) is read with OCR
// (ver ocr.ts).
import type { OcrProgress } from './ocr';
import type { Grid, PdfDoc, PdfPageData, PdfRun } from './quoteparse';

/** A piece of text of the page: its text, its top-left corner, its width and its height (in points). */
export interface PdfPiece {
  text: string;
  x: number;
  top: number;
  width: number;
  size: number;
}

/**
 * Joins the pieces into stretches. A line is the pieces that overlap vertically with it (in a scan the words
 * of a line have different heights: "con" is lower than "Ventana"). In each line, from left to right, a
 * piece follows the previous one if the gap is smaller than somewhat more than half the height of the line (with a space if seen).
 */
export function joinRuns(pieces: PdfPiece[]): PdfRun[] {
  const sorted = pieces.filter((p) => p.text.trim() !== '' && p.size > 0).sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: { top: number; bottom: number; pieces: PdfPiece[] }[] = [];
  for (const p of sorted) {
    const bottom = p.top + p.size;
    const line = lines.find((l) => Math.min(l.bottom, bottom) - Math.max(l.top, p.top) >= Math.min(l.bottom - l.top, p.size) * 0.5);
    if (line) {
      line.pieces.push(p);
      line.top = Math.min(line.top, p.top);
      line.bottom = Math.max(line.bottom, bottom);
    } else lines.push({ top: p.top, bottom, pieces: [p] });
  }
  const runs: PdfRun[] = [];
  for (const line of lines.sort((a, b) => a.top - b.top)) {
    const height = Math.max(...line.pieces.map((p) => p.size));
    line.pieces.sort((a, b) => a.x - b.x);
    let cur: PdfRun | null = null;
    for (const p of line.pieces) {
      const gap = cur ? p.x - (cur.x + cur.width) : Infinity;
      if (cur && gap < height * 0.6) {
        const space = gap > height * 0.1 && !/\s$/.test(cur.text) && !/^\s/.test(p.text);
        cur.text += (space ? ' ' : '') + p.text;
        cur.width = p.x + p.width - cur.x;
        cur.size = Math.max(cur.size, p.top + p.size - cur.top);
        if (p.top < cur.top) {
          cur.size += cur.top - p.top;
          cur.top = p.top;
        }
      } else {
        cur = { text: p.text, x: p.x, top: p.top, width: p.width, size: p.size };
        runs.push(cur);
      }
    }
  }
  for (const r of runs) r.text = r.text.replace(/\s+/g, ' ').trim();
  return runs.filter((r) => r.text !== '');
}

/** The grid of a PDF: each line a row, each stretch a cell (to search in it). */
export function gridOfPdf(pages: PdfPageData[]): Grid {
  const rows: Grid = [];
  for (const page of pages) {
    let line: string[] = [];
    let top = -Infinity;
    for (const r of page.runs) {
      if (line.length && Math.abs(r.top - top) > r.size * 0.5) {
        rows.push(line);
        line = [];
      }
      if (!line.length) top = r.top;
      line.push(r.text);
    }
    if (line.length) rows.push(line);
  }
  return rows;
}

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

/** pdf.js, loaded the first time, with its worker (the one that reads the file, outside the interface thread). */
function pdfjs(): Promise<PdfJs> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, worker]) => {
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  });
  return lib;
}

/** Opens a PDF: the size and the text stretches of each page, and how to draw it. */
export async function readPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const m = await pdfjs();
  let doc;
  try {
    doc = await m.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    throw new Error(e instanceof Error && /password/i.test(e.message) ? 'The PDF is protected with a password' : 'Not a valid .pdf file');
  }
  const pages: PdfPageData[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const pieces: PdfPiece[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      // from the PDF coordinates (bottom left) to those of the page (top left)
      const tx = m.Util.transform(vp.transform, item.transform);
      const size = Math.hypot(tx[2], tx[3]);
      pieces.push({ text: item.str, x: tx[4], top: tx[5] - size, width: item.width * vp.scale, size });
    }
    pages.push({ width: vp.width, height: vp.height, runs: joinRuns(pieces) });
  }
  const draw = async (index: number, canvas: HTMLCanvasElement, scale: number, ratio: number) => {
    const page = await doc.getPage(index + 1);
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width * ratio);
    canvas.height = Math.floor(vp.height * ratio);
    canvas.style.width = `${vp.width}px`;
    canvas.style.height = `${vp.height}px`;
    await page.render({ canvas, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
  };
  return {
    pages,
    render: (index, canvas, scale) => draw(index, canvas, scale, window.devicePixelRatio || 1),
    // only the box, at 3 and 5 px per point (216 and 360 ppi): enlarging more deforms the figures (a 5 comes out as 9); in
    // un recuadro grande, menos, para no pasar de unos 2400 px
    scanBox: (index, rect, progress) => {
      const [x, y, w, h] = rect;
      const fit = 2400 / Math.max(w, h);
      const scales = [...new Set([Math.min(3, fit), Math.min(5, fit)])];
      return scanRegion(rect, scales, progress, async (canvas, scale) => {
        const page = await doc.getPage(index + 1);
        const vp = page.getViewport({ scale });
        canvas.width = Math.ceil(w * scale);
        canvas.height = Math.ceil(h * scale);
        await page.render({ canvas, viewport: vp, background: 'white', transform: [1, 0, 0, 1, -x * scale, -y * scale] }).promise;
      });
    },
  };
}

/** The white margin put around the box (Tesseract has trouble reading what touches the edge). */
const PAD = 16;

/**
 * Reads with OCR a box of a page at each scale of `scales` (pixels per unit): `paint` draws it on a
 * canvas, a white margin is added and it is read. It keeps the reading with the most confidence; the text comes back in the
 * units of the page.
 */
async function scanRegion(
  rect: [number, number, number, number],
  scales: number[],
  progress: OcrProgress | undefined,
  paint: (canvas: HTMLCanvasElement, scale: number) => Promise<void>,
): Promise<PdfRun[]> {
  const { confidenceOf, piecesOfWords, recognizeCanvas } = await import('./ocr');
  let best: { words: Awaited<ReturnType<typeof recognizeCanvas>>; scale: number; confidence: number } | null = null;
  for (const [n, scale] of scales.entries()) {
    const region = document.createElement('canvas');
    await paint(region, scale);
    const padded = document.createElement('canvas');
    padded.width = region.width + PAD * 2;
    padded.height = region.height + PAD * 2;
    const ctx = padded.getContext('2d');
    if (!ctx) throw new Error('The area could not be drawn');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, padded.width, padded.height);
    ctx.drawImage(region, PAD, PAD);
    const words = await recognizeCanvas(padded, (p, status) => progress?.((n + p) / scales.length, status), 'block');
    const confidence = confidenceOf(words);
    if (!best || confidence > best.confidence) best = { words, scale, confidence };
  }
  if (!best) return [];
  const [x, y] = rect;
  const s = best.scale;
  return joinRuns(piecesOfWords(best.words, s).map((p) => ({ ...p, x: p.x - PAD / s + x, top: p.top - PAD / s + y })));
}

/** Opens an image (photo or scan of a quotation, JPG or PNG) as a page; its text is read by boxes. */
export async function readImage(bytes: Uint8Array, type: string): Promise<PdfDoc> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes.slice()], { type }));
  } catch {
    throw new Error('Not a valid image file');
  }
  const page: PdfPageData = { width: bitmap.width, height: bitmap.height, runs: [] };
  return {
    pages: [page],
    render: async (_i, canvas, scale) => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(bitmap.width * scale * ratio);
      canvas.height = Math.floor(bitmap.height * scale * ratio);
      canvas.style.width = `${bitmap.width * scale}px`;
      canvas.style.height = `${bitmap.height * scale}px`;
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    },
    // a photo already brings its resolution (its units are pixels): it is read as it is and at double (without exceeding 2400 px)
    scanBox: (_i, rect, progress) => {
      const [x, y, w, h] = rect;
      const fit = 2400 / Math.max(w, h);
      const scales = [...new Set([Math.min(1, fit), Math.min(2, fit)])];
      return scanRegion(rect, scales, progress, async (canvas, scale) => {
        canvas.width = Math.ceil(w * scale);
        canvas.height = Math.ceil(h * scale);
        canvas.getContext('2d')?.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height);
      });
    },
  };
}
