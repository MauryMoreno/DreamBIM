import type { QuoteSheet } from '../quoteparse';
import { DocState, PickOptions, Picked } from './types';
import { type DocBlock, type Grid, type OcrBox, type PdfDoc, type PdfPageData, type PdfRun, type QuoteSource } from '../quoteparse';

/** What the parts of pickFromDocument share: its parameters and every local that more than one part uses. */
export interface DocPickerContext {
  o: PickOptions;
  s: DocState;
  scrim: HTMLDivElement;
  box: HTMLDivElement;
  bar: HTMLDivElement;
  tabs: HTMLDivElement;
  body: HTMLDivElement;
  error: HTMLDivElement;
  hint: HTMLSpanElement;
  cancel: HTMLButtonElement;
  useSel: HTMLButtonElement;
  sheetsOf: (d: QuoteSource) => QuoteSheet[];
  sheetIndex: () => number;
  currentGrid: () => Grid;
  sheetPrefix: () => string;
  setDoc: (d: QuoteSource, sheet?: number) => void;
  sheetOfPicked: (d: QuoteSource) => number;
  pickedHere: () => { cell: string; nth: number | null; range: [number, number] | null; } | null;
  renderBar: () => void;
  renderTabs: () => void;
  renderPaste: () => void;
  fillText: (box: HTMLElement, text: string, ref: string, before: ReturnType<() => { cell: string; nth: number | null; range: [number, number] | null; } | null>, numbers?: boolean) => void;
  renderDocument: (blocks: DocBlock[]) => void;
  boxing: boolean;
  boxKey: (i: number, rect: OcrBox["rect"]) => string;
  fillLayer: (layer: HTMLElement, pg: PdfPageData, i: number, scale: number, before: ReturnType<() => { cell: string; nth: number | null; range: [number, number] | null; } | null>) => void;
  amountsIn: (runs: PdfRun[], prefix: string) => { value: number; ref: string; }[];
  setBoxing: (on: boolean) => void;
  renderPdf: (pdf: PdfDoc) => void;
  renderGrid: () => void;
  selectionInGrid: () => { td: HTMLElement; from: number; to: number; text: string; } | null;
  onSelect: () => void;
  render: () => void;
  reopen: () => Promise<void>;
  finish: (v: Picked | null) => void;
}
