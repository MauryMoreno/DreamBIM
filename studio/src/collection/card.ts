// Card of the Collection, Pokedex style: the small one, for the grid, is an entry (number,
// el modelo en su escenario, nombre y pastillas de tipo); la grande, para el detalle, la ficha completa: el
// live model on the left and on the right the measurements as stat bars, the levels of detail as an
// evolution chain, the description and the parameters.
import type { CardInfo } from './cardinfo';

export const DISCIPLINES = ['arquitectura', 'electrico', 'fontaneria', 'hvac', 'mobiliario'] as const;

/** Name of each discipline in the interface (in English, like the rest of Studio). */
const DISCIPLINE_LABEL: Record<string, string> = {
  arquitectura: 'Architecture',
  electrico: 'Electrical',
  fontaneria: 'Plumbing',
  hvac: 'HVAC',
  mobiliario: 'Furniture',
};

type Dims = CardInfo['dims'];

export interface CardOptions {
  /** Miniatura (data URL) para el dibujo. */
  thumb?: string;
  /** Entry number in the Collection (from 1). */
  number?: number;
  /** Nivel de detalle mostrado y aviso al elegir otro (solo la carta grande). */
  lod?: number;
  onLod?(level: number): void;
  /** Which size it is among those of its kind (only the big card, and only if there is more than one). */
  sizes?: { index: number; total: number };
  /** Largest measurement of the library on each axis: the bar of each measurement is relative to it. */
  statMax?: Dims;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text: the names come from the disk
  return e;
}

const mm = (m: number) => `${Math.round(m * 1000)} mm`;
const errMm = (m: number) => `±${(m * 1000).toFixed(1)} mm`;
const tri = (n: number) => `${n.toLocaleString('en-US')} tri`;
/** "LOD 2"; the refined one, with a typographic minus sign: "LOD −1". */
const lodName = (level: number) => `LOD ${level < 0 ? `−${-level}` : level}`;
/** Entry number with at least three digits (7 → 007), as in a Pokedex. */
const dexNumber = (n: number) => `#${String(n).padStart(3, '0')}`;

/** Color class of the discipline: one per known discipline and a neutral one for the rest. */
export const disciplineClass = (d: string): string =>
  (DISCIPLINES as readonly string[]).includes(d) ? `card-d-${d}` : 'card-d-other';

/** Visible name of the discipline ('' if the card is in the root). */
export const disciplineLabel = (d: string): string => DISCIPLINE_LABEL[d] ?? d;

/** Pastillas de tipo: la disciplina (con su color) y la clase IFC. */
function pills(info: CardInfo): HTMLElement {
  const m = el('div', 'card-meta');
  if (info.discipline) {
    const d = el('span', 'card-pill card-pill-disc');
    d.append(el('span', 'card-swatch'), document.createTextNode(disciplineLabel(info.discipline)));
    m.append(d);
  }
  if (info.ifcClass) m.append(el('span', 'card-pill card-class', info.ifcClass));
  return m;
}

function art(thumb: string | undefined): HTMLElement {
  const a = el('div', 'card-art');
  if (thumb) {
    const img = el('img', 'card-thumb');
    img.src = thumb;
    img.alt = '';
    img.draggable = false;
    a.append(img);
  }
  return a;
}

/** Folder of the card inside the library, readable: "hvac › Grille" ('Library root' in the root). */
const folderLabel = (typeFolder: string): string => typeFolder.split(/[\\/]/).filter(Boolean).join(' › ') || 'Library root';

/** Location line of the small card; the full path, on hover. */
function location(info: CardInfo): HTMLElement {
  const loc = el('div', 'card-loc', folderLabel(info.typeFolder));
  loc.title = info.path;
  return loc;
}

/** Row of parameters: label on the left, value on the right. */
function row(label: string, value: string): HTMLElement {
  const r = el('div', 'card-param');
  r.append(el('span', 'card-row-label', label), el('span', 'card-row-value', value));
  return r;
}

/** Measurement as a stat bar, relative to the largest of the library on that axis. */
function stat(label: string, v: number, max: number | undefined): HTMLElement {
  const r = el('div', 'card-dim');
  const bar = el('span', 'card-bar');
  const fill = el('span', 'card-bar-fill');
  const pct = max && max > 0 ? Math.min(100, Math.max(4, Math.round((v / max) * 100))) : 100;
  fill.style.width = `${pct}%`;
  bar.append(fill);
  r.append(el('span', 'card-row-label', label), bar, el('span', 'card-row-value', mm(v)));
  return r;
}

function renderSmall(info: CardInfo, opts: CardOptions): HTMLElement {
  const root = el('article', `card card-small ${disciplineClass(info.discipline)}`);
  root.dataset.path = info.path;
  const inner = el('div', 'card-inner');
  const a = art(opts.thumb);
  if (opts.number) a.append(el('span', 'card-num', dexNumber(opts.number)));
  const body = el('div', 'card-body');
  const name = el('div', 'card-name', info.name);
  name.title = info.name;
  const levels = info.lods.map((l) => l.level);
  const lods = el('div', 'card-lods');
  lods.append(el('span', 'card-lod', levels.length > 1 ? `${lodName(levels[0])}–${levels.at(-1)}` : lodName(levels[0] ?? 0)));
  body.append(name, pills(info), location(info), lods);
  inner.append(a, body);
  root.append(inner);
  return root;
}

function renderLarge(info: CardInfo, opts: CardOptions): HTMLElement {
  const root = el('article', `card card-large ${disciplineClass(info.discipline)}`);
  root.dataset.path = info.path;
  const inner = el('div', 'card-inner');
  const spec = el('div', 'card-spec');

  const top = el('header', 'card-top');
  if (opts.number) top.append(el('span', 'card-num', dexNumber(opts.number)));
  top.append(el('h2', 'card-name', info.name), pills(info));
  if (info.reference) top.append(el('div', 'card-ref', info.reference));
  spec.append(top);

  if (info.description) spec.append(el('p', 'card-desc', info.description));

  const rows: [string, keyof Dims][] = [
    ['Width', 'width'],
    ['Depth', 'depth'],
    ['Height', 'height'],
  ];
  const dims = el('div', 'card-dims');
  for (const [label, k] of rows) {
    const v = info.dims[k];
    if (v !== undefined) dims.append(stat(label, v, opts.statMax?.[k]));
  }
  if (dims.children.length) {
    const s = el('section', 'card-section card-stats');
    s.append(el('h3', 'card-section-title', 'Size'), dims);
    spec.append(s);
  }

  const lodSection = el('section', 'card-section card-lod-section');
  lodSection.append(el('h3', 'card-section-title', 'Level of detail'));
  const lods = el('div', 'card-lods');
  lods.setAttribute('role', 'group');
  lods.setAttribute('aria-label', 'Level of detail');
  for (const l of info.lods) {
    const b = el('button', 'card-lod');
    b.type = 'button';
    b.setAttribute('aria-pressed', String((opts.lod ?? 0) === l.level));
    b.append(
      el('span', 'card-lod-level', lodName(l.level)),
      el('span', 'card-lod-detail', tri(l.triangles)),
      el('span', 'card-lod-detail', l.level === 0 ? 'original' : l.level < 0 ? 'refined' : errMm(l.error)),
    );
    b.addEventListener('click', () => opts.onLod?.(l.level));
    lods.append(b);
  }
  lodSection.append(lods);
  spec.append(lodSection);

  if (info.extra.length) {
    const extra = el('section', 'card-section card-extra');
    extra.append(el('h3', 'card-section-title', 'Parameters'));
    for (const [k, v] of info.extra) extra.append(row(k, v));
    spec.append(extra);
  }

  const loc = el('section', 'card-section card-location');
  loc.append(el('h3', 'card-section-title', 'Location'), row('Folder', folderLabel(info.typeFolder)));
  const file = row('File', info.path);
  file.classList.add('card-path');
  loc.append(file);
  spec.append(loc);

  const meshes =`${info.meshes} ${info.meshes === 1 ? 'mesh' : 'meshes'}`;
  const colors = `${info.materials} ${info.materials === 1 ? 'color' : 'colors'}`;
  const sizes = opts.sizes && opts.sizes.total > 1 ? ` · ${opts.sizes.index} / ${opts.sizes.total} sizes` : '';
  spec.append(el('footer', 'card-foot', `${meshes} · ${colors}${sizes}`));

  inner.append(art(opts.thumb), spec);
  root.append(inner);
  return root;
}

export function renderCard(info: CardInfo, size: 'small' | 'large', opts: CardOptions = {}): HTMLElement {
  return size === 'small' ? renderSmall(info, opts) : renderLarge(info, opts);
}

/** Carta de un archivo que no se pudo leer o analizar. */
export function renderErrorCard(name: string, error: string): HTMLElement {
  const root = el('article', 'card card-small card-d-other card-error');
  const inner = el('div', 'card-inner');
  const body = el('div', 'card-body');
  const n = el('div', 'card-name', name);
  n.title = name;
  body.append(n, el('div', 'card-error-msg', error));
  inner.append(el('div', 'card-art card-art-error'), body);
  root.append(inner);
  return root;
}
