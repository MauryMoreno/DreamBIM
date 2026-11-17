import { type QuoteSource } from '../quoteparse';
import type { PriceOrigin } from '../system';

/** The open document, shared among the rows of the editor; `sheet` is the sheet that is seen. */
export interface DocState {
  doc: QuoteSource | null;
  decimal: '.' | ',';
  sheet?: number;
}

export interface PickOptions {
  /** For whom it is chosen: "21-02 20 10 Exterior Walls". */
  target: string;
  state: DocState;
  /** Where it was chosen from before: that document is opened with that cell marked. */
  picked?: PriceOrigin;
  /** Opens a document (Excel, Word, CSV, text) as a grid; null if cancelled. Without this only text is pasted. */
  openFile?(): Promise<QuoteSource | null>;
  /** Vuelve a leer un documento por su ruta (el de `picked`). */
  readFile?(path: string): Promise<QuoteSource>;
}

/** El precio elegido, su celda y el documento (su ruta, o su nombre si es texto pegado). */
export interface Picked {
  value: number;
  /** `E3`, `Precios!E3` en un libro de varias hojas, y `#2` si es la segunda cifra de una celda con texto. */
  cell: string;
  doc: string;
  name: string;
}
