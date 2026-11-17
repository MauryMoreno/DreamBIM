// El selector de documentos (recuperado): referencias de celda y elegir una cifra en un documento de texto.
import { beforeEach, describe, expect, it } from 'vitest';
import { cellName, docName, numbersIn, parseRef, pickFromDocument, refLabel, type DocState } from '../src/costs/docpicker';

beforeEach(() => {
  document.body.replaceChildren();
});

describe('referencias de celda', () => {
  it('A zip without compression (method 0): enough to read a minimal .xlsx (the reader does not check the CRC).', () => {
    expect(cellName(0, 0)).toBe('A1');
    expect(cellName(2, 27)).toBe('AB3');
  });

  it('parseRef recuerda la hoja de un libro de varias hojas, la cifra y el texto seleccionado', () => {
    expect(parseRef('Precios!E3#2')).toEqual({ sheet: 'Precios', cell: 'E3', nth: 2, range: null });
    expect(parseRef('A7@12-18')).toEqual({ sheet: null, cell: 'A7', nth: null, range: [12, 18] });
  });

  it('joinRuns joins the pieces together of the same line', () => {
    expect(refLabel('Precios!E3#2')).toBe('cell E3 of Precios, number 2');
    expect(refLabel('pg2[120,340,80,18].1#1')).toBe('page 2, area read with OCR, number 1');
    expect(refLabel('T2.3.1')).toBe('table 2, row 3, column 1');
  });

  it('docName quita la carpeta', () => {
    expect(docName('C:/q/Cotización Acme.pdf')).toBe('Cotización Acme.pdf');
    expect(docName('pegado')).toBe('pegado');
  });

  it('gridOfBlocks puts the paragraphs and the tables of a Word document in rows', () => {
    expect(numbersIn('Valor unitario: $ 452.000 y 3,5 (AL-501)', ',').map((n) => n.value)).toEqual([452000, 3.5]);
  });
});

describe('elegir un precio', () => {
  it('un clic en la cifra de un documento de texto la devuelve con su celda y su documento', async () => {
    const state: DocState = { doc: { name: 'cotizacion.txt', path: 'C:/q/cotizacion.txt', grid: [['Concreto', '150,50'], ['Acero', '1,15']] }, decimal: ',' };
    const done = pickFromDocument({ target: '01.01 Losas', state });
    const cell = document.querySelector<HTMLElement>('[data-cell="B1"]')!;
    expect(cell).not.toBeNull();
    cell.click();
    expect(await done).toEqual({ value: 150.5, cell: 'B1', doc: 'C:/q/cotizacion.txt', name: 'cotizacion.txt' });
  });

  it('Cancel devuelve null', async () => {
    const state: DocState = { doc: { name: 'a.txt', grid: [['1']] }, decimal: '.' };
    const done = pickFromDocument({ target: 'x', state });
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(await done).toBeNull();
  });
});
