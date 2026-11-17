// Leer documentos de precios: CSV (con su separador), libros de Excel (un zip con XML) y texto en UTF-8 o
// Windows-1252. Recovered from the reading of classification tables that was removed with the previous Costs.

/** Separa un CSV (RFC 4180: comillas, comillas dobles escapadas, saltos \r\n) en filas de celdas. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// --- CSV ---------------------------------------------------------------------------------------------

/** Separator with the most occurrences outside quotes in the first lines: `,`, `;` or tab. */
function detectDelimiter(text: string): string {
  const count: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 12; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c in count) count[c]++;
    else if (!quoted && c === '\n') lines++;
  }
  return (Object.entries(count).sort((a, b) => b[1] - a[1])[0] ?? [','])[0];
}

export function rowsFromCsv(text: string): string[][] {
  const body = text.replace(/^﻿/, '');
  return splitCsv(body, detectDelimiter(body));
}

// --- XLSX (un zip con XML) ---------------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(data as unknown as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The zip entries that `want` asks for, decompressed (methods 0 and 8). */
export async function unzip(bytes: Uint8Array, want: (name: string) => boolean, kind = '.xlsx'): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error(`Not a valid ${kind} file`);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`Unsupported compression in the ${kind} file`);
  }
  return out;
}

/** An XML of the zip as a document; without its declaration, which some programs write with single quotes. */
export const parseXml = (data: Uint8Array): Document =>
  new DOMParser().parseFromString(new TextDecoder().decode(data).replace(/^﻿?\s*<\?xml[^>]*\?>/, ''), 'application/xml');

const textOf = (el: Element): string => [...el.getElementsByTagName('t')].map((t) => t.textContent ?? '').join('');

/** Letras de columna ('AB' → 27). */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Una hoja de un libro: su nombre y sus filas. */
export interface XlsxSheet {
  name: string;
  rows: string[][];
}

/**
 * The sheets of the workbook in their order (that of `xl/workbook.xml`). With `keepRows`, each row stays at its Excel number
 * (the empty ones as []), so that "E3" is cell E3 of Excel; without it, the empty rows are removed.
 */
export async function sheetsFromXlsx(bytes: Uint8Array, keepRows = false): Promise<XlsxSheet[]> {
  const files = await unzip(
    bytes,
    (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  const sheetFiles = [...files.keys()].filter((n) => n.startsWith('xl/worksheets/'));
  if (!sheetFiles.length) throw new Error('The .xlsx file has no sheets');
  const shared = files.has('xl/sharedStrings.xml') ? [...parseXml(files.get('xl/sharedStrings.xml')!).getElementsByTagName('si')].map(textOf) : [];
  // the order and the names of the workbook; without it, by the number of the file (sheet2 before sheet10)
  let order: { name: string; file: string }[] = [];
  if (files.has('xl/workbook.xml') && files.has('xl/_rels/workbook.xml.rels')) {
    const target = new Map<string, string>();
    for (const r of parseXml(files.get('xl/_rels/workbook.xml.rels')!).getElementsByTagName('Relationship')) {
      const t = (r.getAttribute('Target') ?? '').replace(/^\//, '');
      target.set(r.getAttribute('Id') ?? '', t.startsWith('xl/') ? t : `xl/${t}`);
    }
    for (const sh of parseXml(files.get('xl/workbook.xml')!).getElementsByTagName('sheet')) {
      const file = target.get(sh.getAttribute('r:id') ?? '');
      if (file && files.has(file)) order.push({ name: sh.getAttribute('name') ?? file, file });
    }
  }
  if (!order.length) {
    const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
    order = sheetFiles.sort((a, b) => num(a) - num(b)).map((file, i) => ({ name: `Sheet${i + 1}`, file }));
  }
  return order.map(({ name, file }) => {
    let rows: string[][] = [];
    for (const row of parseXml(files.get(file)!).getElementsByTagName('row')) {
      const cells: string[] = [];
      for (const c of row.getElementsByTagName('c')) {
        const type = c.getAttribute('t');
        const raw = c.getElementsByTagName('v')[0]?.textContent ?? '';
        const value = type === 's' ? shared[Number(raw)] ?? '' : type === 'inlineStr' ? textOf(c) : raw;
        cells[columnOf(c.getAttribute('r') ?? '')] = value;
      }
      const r = Array.from(cells, (x) => x ?? '');
      const at = Number(row.getAttribute('r'));
      if (keepRows && at >= 1) rows[at - 1] = r;
      else rows.push(r);
    }
    rows = Array.from(rows, (r) => r ?? []);
    if (keepRows) {
      while (rows.length && !rows[rows.length - 1].some((c) => c.trim() !== '')) rows.pop();
    } else rows = rows.filter((r) => r.some((c) => c.trim() !== ''));
    return { name, rows };
  });
}

/**
 * Texto de un archivo de tabla: UTF-8 si lo es; si no, Windows-1252 (el `OmniClassTaxonomy.txt` de Revit no viene en
 * UTF-8 and its "Façades" would break).
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
