// Lectura de documentos de precios (recuperada): cifras, rejillas, CSV, Excel y Word.
import { describe, expect, it } from 'vitest';
import { gridFromText, guessDecimal, parseAmount } from '../src/costs/quoteparse';
import { joinRuns } from '../src/costs/pdf';
import { rowsFromCsv, sheetsFromXlsx } from '../src/costs/docread';
import { gridOfBlocks } from '../src/costs/docx';

/** removing the measurement leaves a heading line */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const entries = Object.entries(files);
  for (const [name, text] of entries) {
    const n = enc.encode(name);
    const data = enc.encode(text);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    const c = new Uint8Array(46);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    parts.push(local, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('cifras y rejillas', () => {
  it('parseAmount lee coma y punto decimal', () => {
    expect(parseAmount('$ 1.234,56', ',')).toBe(1234.56);
    expect(parseAmount('1,234.56', '.')).toBe(1234.56);
    expect(parseAmount('abc', '.')).toBeNull();
  });

  it('guessDecimal adivina la coma', () => {
    expect(guessDecimal([['Concreto', '12,50'], ['Acero', '3,75']])).toBe(',');
    expect(guessDecimal([['Concreto', '12.50']])).toBe('.');
  });

  it('guessDecimal reconoce los miles en precios enteros', () => {
    // «$ 452.000» y «1.250.000» son miles con punto: el decimal es la coma
    expect(guessDecimal([['Concreto', '$ 452.000'], ['Acero', '1.250.000']])).toBe(',');
    expect(parseAmount('$ 452.000', guessDecimal([['$ 452.000']]))).toBe(452000);
    expect(guessDecimal([['Concreto', '$ 1,250,000']])).toBe('.');
  });

  it('gridFromText separa por tabulador o por dos espacios', () => {
    expect(gridFromText('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(gridFromText('Concreto   150,00\nAcero   1,15')).toEqual([['Concreto', '150,00'], ['Acero', '1,15']]);
  });

  it('editing a code clears the old reference to an APU', () => {
    const runs = joinRuns([
      { text: '$', x: 10, top: 100, width: 6, size: 10 },
      { text: '452,00', x: 18, top: 100, width: 30, size: 10 },
      { text: 'Otra', x: 10, top: 140, width: 20, size: 10 },
    ]);
    expect(runs.map((r) => r.text)).toEqual(['$ 452,00', 'Otra']);
  });

  it('rowsFromCsv con punto y coma y comillas', () => {
    expect(rowsFromCsv('Código;Precio\r\n"A;1";"1,5"\r\n')).toEqual([['Código', 'Precio'], ['A;1', '1,5']]);
  });

  it('removing the parent deletes the key and keeps the code', () => {
    const grid = gridOfBlocks([
      { kind: 'p', text: 'Cotización' },
      { kind: 'table', rows: [[{ text: 'Ítem', span: 1 }, { text: 'Precio', span: 1 }], [{ text: 'Losa', span: 1 }, { text: '150', span: 1 }]] },
    ]);
    expect(grid[0]).toContain('Cotización');
    expect(grid.some((r) => r.includes('Losa') && r.includes('150'))).toBe(true);
  });
});

describe('Excel', () => {
  it('sheetsFromXlsx lee las hojas en su orden, con sus nombres y celdas', async () => {
    const bytes = zip({
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Precios" r:id="rId1"/><sheet name="Notas" r:id="rId2"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>Concreto</t></si><si><t>Ver nota</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>150.5</v></c></row></sheetData></worksheet>',
      'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>',
    });
    const sheets = await sheetsFromXlsx(bytes, true);
    expect(sheets.map((s) => s.name)).toEqual(['Precios', 'Notas']);
    expect(sheets[0].rows[0]).toEqual(['Concreto', '150.5']);
    expect(sheets[1].rows[1]).toEqual(['Ver nota']);
  });
});
