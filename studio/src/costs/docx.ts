// Read a Word document (.docx) without external services, as a document: its blocks in order (paragraphs, with the
// headings marked, and tables with their merged cells), the headers before and the footers after, and the text of the
// text boxes in their paragraph. It also gives the equivalent grid (each paragraph a row, each table row a
// fila). El .docx es un zip con `word/document.xml`.
import { parseXml, unzip } from './docread';
import type { DocBlock, Grid } from './quoteparse';

/** Los hijos directos de `el` con ese nombre local (`p`, `tbl`, `tr`, `tc`…). */
const kids = (el: Element, local: string): Element[] => [...el.children].filter((c) => c.localName === local);

/** The text of a paragraph: its `w:t`, with tabs as `\t` and breaks as a space. */
function paragraphText(p: Element): string {
  let out = '';
  const walk = (el: Element) => {
    for (const c of el.children) {
      if (c.localName === 't') out += c.textContent ?? '';
      else if (c.localName === 'tab') out += '\t';
      else if (c.localName === 'br' || c.localName === 'cr') out += ' ';
      // a paragraph inside this one (that of a text box) is kept separate
      else if (c.localName === 'p') {
        out += ' ';
        walk(c);
      }
      // las propiedades y el texto borrado en el control de cambios no cuentan
      else if (c.localName !== 'delText' && c.localName !== 'del' && c.localName !== 'pPr') walk(c);
    }
  };
  walk(p);
  return out.replace(/ {2,}/g, ' ').trim();
}

/** The heading level of a paragraph (1–3) by its style ("Heading1", "Title" or their Spanish names); 0 if it is not a heading. */
function headingOf(p: Element): number {
  const style = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '';
  if (/^(title|t[ií]tulo)$/i.test(style)) return 1;
  const m = /^(?:heading|t[ií]tulo|ttulo)\s*(\d)$/i.exec(style);
  return m ? Math.min(3, Number(m[1])) : 0;
}

/** A list item: with its own numbering or with a list style ("List Bullet" or its Spanish name). */
const isListItem = (p: Element): boolean =>
  p.getElementsByTagName('w:numPr').length > 0 || /^(list|lista)/i.test(p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '');

/** The text of a cell: its paragraphs (and those of its nested tables) separated by a space. */
const cellText = (tc: Element): string => [...tc.getElementsByTagName('w:p')].map(paragraphText).filter(Boolean).join(' ');

/** How wide a cell is (`w:gridSpan`). */
function spanOf(tc: Element): number {
  const g = tc.getElementsByTagName('w:gridSpan')[0];
  const n = Number(g?.getAttribute('w:val'));
  return Number.isInteger(n) && n > 1 ? n : 1;
}

function readBlocks(container: Element, out: DocBlock[], part?: 'header' | 'footer'): void {
  for (const c of container.children) {
    if (c.localName === 'p') {
      const text = paragraphText(c);
      if (!text) continue;
      const heading = headingOf(c);
      out.push({ kind: 'p', text, ...(heading ? { heading } : {}), ...(isListItem(c) ? { list: true } : {}), ...(part ? { part } : {}) });
    } else if (c.localName === 'tbl') {
      const rows = kids(c, 'tr')
        .map((tr) => kids(tr, 'tc').map((tc) => ({ text: cellText(tc), span: spanOf(tc) })))
        .filter((r) => r.some((x) => x.text !== ''));
      if (rows.length) out.push({ kind: 'table', rows, ...(part ? { part } : {}) });
    } else if (c.localName === 'sdt') {
      // un control de contenido: su contenido es otro bloque
      for (const content of kids(c, 'sdtContent')) readBlocks(content, out, part);
    }
  }
}

/** The grid of some blocks: each paragraph a row (split by tabs), each table row a row. */
export function gridOfBlocks(blocks: DocBlock[]): Grid {
  const rows: Grid = [];
  for (const b of blocks) {
    if (b.kind === 'p') rows.push(b.text.includes('\t') ? b.text.split('\t').map((x) => x.trim()) : [b.text]);
    else for (const r of b.rows) rows.push(r.flatMap((c) => [c.text, ...Array<string>(c.span - 1).fill('')]));
  }
  return rows;
}

/** The blocks of a .docx: headers, the body in its order and footers. */
export async function blocksFromDocx(bytes: Uint8Array): Promise<DocBlock[]> {
  const partName = /^word\/(header|footer)(\d*)\.xml$/;
  const files = await unzip(bytes, (n) => n === 'word/document.xml' || partName.test(n), '.docx');
  const xml = files.get('word/document.xml');
  if (!xml) throw new Error('The .docx file has no document');
  const body = parseXml(xml).getElementsByTagName('w:body')[0];
  if (!body) throw new Error('The .docx file has no document');
  const parts = (kind: string) =>
    [...files.keys()]
      .filter((n) => partName.exec(n)?.[1] === kind)
      .sort((a, b) => Number(partName.exec(a)![2] || 0) - Number(partName.exec(b)![2] || 0));
  const blocks: DocBlock[] = [];
  const seen = new Set<string>();
  // the same header is often repeated (first page, even, odd): once per text
  const addPart = (name: string, kind: 'header' | 'footer') => {
    const got: DocBlock[] = [];
    readBlocks(parseXml(files.get(name)!).documentElement, got, kind);
    for (const b of got) {
      const key = JSON.stringify(b.kind === 'p' ? b.text : b.rows);
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(b);
    }
  };
  parts('header').forEach((n) => addPart(n, 'header'));
  readBlocks(body, blocks);
  parts('footer').forEach((n) => addPart(n, 'footer'));
  return blocks;
}
