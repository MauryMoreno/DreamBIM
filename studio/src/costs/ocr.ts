// Read the text of an image (a scanned page, a photo of a quotation) with Tesseract (tesseract.js,
// Apache-2.0), inside the app: the engine and the languages (Spanish and English) are served from the `ocr/` folder of the app
// (see vite.config.ts), downloading nothing. It gives each word with its box, to join them into stretches like the text of
// a PDF. Tesseract is loaded only the first time it is needed and its worker stays ready for the following pages.
import type { Worker } from 'tesseract.js';
import type { PdfPiece } from './pdf';

/** How the reading is going: from 0 to 1, and what it is doing. */
export type OcrProgress = (progress: number, status: string) => void;

/** A word the OCR read: its text, its box (in image pixels) and its confidence (0–100). */
export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

/**
 * The words as pieces of text, in page units (`scale` image pixels per unit). Those
 * confianza muy baja (manchas, rayas) se dejan fuera.
 */
export function piecesOfWords(words: OcrWord[], scale = 1): PdfPiece[] {
  return words
    // outside also the loose strokes: the border of a table cell comes out as "|"
    .filter((w) => w.text.trim() !== '' && w.confidence >= 30 && !/^[|¦_\-—–=~.,:;'"`´]+$/.test(w.text.trim()))
    .map((w) => ({
      text: w.text,
      x: w.bbox.x0 / scale,
      top: w.bbox.y0 / scale,
      width: (w.bbox.x1 - w.bbox.x0) / scale,
      size: (w.bbox.y1 - w.bbox.y0) / scale,
    }));
}

/** The confidence of a reading: the mean of that of its words, weighted by their length (0 if nothing was read). */
export function confidenceOf(words: OcrWord[]): number {
  const total = words.reduce((n, w) => n + w.text.length, 0);
  return total ? words.reduce((n, w) => n + w.confidence * w.text.length, 0) / total : 0;
}

let worker: Promise<Worker> | null = null;
let onProgress: OcrProgress | null = null;

/** The `ocr/` folder of the app, as a full address (the worker requests it from its own thread). */
const ocrBase = (): string => new URL('ocr/', document.baseURI).href;

function getWorker(): Promise<Worker> {
  worker ??= import('tesseract.js').then(async ({ createWorker, OEM, PSM }) => {
    const w = await createWorker(['spa', 'eng'], OEM.LSTM_ONLY, {
      workerPath: `${ocrBase()}worker.min.js`,
      corePath: `${ocrBase()}tesseract-core-simd-lstm.wasm.js`,
      langPath: ocrBase().replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,
      logger: (m: { progress: number; status: string }) => onProgress?.(m.progress, m.status),
    });
    // sparse text: it looks for each word wherever it is (also the lone figure of a table cell, which the automatic
    // mode skips); the order is set afterwards by the position of each word
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    return w;
  }).catch((e) => {
    worker = null;
    throw new Error(`The text recognition (OCR) could not start: ${e instanceof Error ? e.message : String(e)}`);
  });
  return worker;
}

/**
 * How the text is laid out: "sparse", loose words all over the image (a page); "block", a block of text (a
 * box drawn around some lines); "line", a single line (a box around a price).
 */
export type OcrLayout = 'sparse' | 'block' | 'line';

/** Reads the text of a canvas; it gives its words with their box in canvas pixels. */
export async function recognizeCanvas(canvas: HTMLCanvasElement, progress?: OcrProgress, layout: OcrLayout = 'sparse'): Promise<OcrWord[]> {
  const w = await getWorker();
  onProgress = progress ?? null;
  try {
    const { PSM } = await import('tesseract.js');
    const psm = { sparse: PSM.SPARSE_TEXT, block: PSM.SINGLE_BLOCK, line: PSM.SINGLE_LINE }[layout];
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
    const words: OcrWord[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) for (const x of l.words) words.push({ text: x.text, bbox: x.bbox, confidence: x.confidence });
    return words;
  } finally {
    onProgress = null;
  }
}
