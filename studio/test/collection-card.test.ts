import { describe, expect, it, vi } from 'vitest';
import type { CardInfo } from '../src/collection/cardinfo';
import { renderCard, renderErrorCard } from '../src/collection/card';

const base = (over: Partial<CardInfo> = {}): CardInfo => ({
  path: '/lib/hvac/Grille/g.ifcx',
  name: 'Return Grille',
  ifcClass: 'IfcAirTerminal',
  reference: '16x4 Connection',
  description: 'Una rejilla',
  discipline: 'hvac',
  typeFolder: 'hvac/Grille',
  dims: { width: 1.4519, depth: 1.1176, height: 0.9335 },
  extra: [['Material', 'Steel']],
  meshes: 2,
  materials: 1,
  lods: [
    { level: 0, triangles: 984, error: 0 },
    { level: 1, triangles: 492, error: 0.0021 },
    { level: 2, triangles: 192, error: 0.0074 },
  ],
  ...over,
});
const text = (e: Element, sel: string) => e.querySelector(sel)?.textContent ?? null;

describe('renderCard', () => {
  it('without LOD there is only one button', () => {
    const c = renderCard(base(), 'large');
    expect(c.classList.contains('card-large')).toBe(true);
    expect(text(c, '.card-name')).toBe('Return Grille');
    expect(text(c, '.card-class')).toBe('IfcAirTerminal');
    expect(c.querySelector('.card-dims')!.textContent).toContain('1452 mm');
    expect(text(c, '.card-ref')).toContain('16x4 Connection');
    expect(text(c, '.card-desc')).toBe('Una rejilla');
    expect(text(c, '.card-extra')).toContain('Material');
    const lods = [...c.querySelectorAll('.card-lods button')].map((b) => b.textContent);
    expect(lods[1]).toContain('492');
    expect(lods[1]).toContain('2.1 mm');
  });

  it('the names from the disk are text, not HTML', () => {
    const c = renderCard(base(), 'small', { thumb: 'data:image/png;base64,AA' });
    expect(text(c, '.card-name')).toBe('Return Grille');
    expect(c.querySelector<HTMLImageElement>('.card-art img')!.src).toBe('data:image/png;base64,AA');
    expect(c.querySelector('.card-desc')).toBeNull();
    expect(c.querySelector('.card-extra')).toBeNull();
  });

  it('omite lo que falta', () => {
    const c = renderCard(base({ reference: null, description: null, dims: { width: 0.5 }, extra: [] }), 'large');
    expect(c.querySelector('.card-ref')).toBeNull();
    expect(c.querySelector('.card-desc')).toBeNull();
    expect(c.querySelector('.card-extra')).toBeNull();
    expect(c.querySelectorAll('.card-dims > *')).toHaveLength(1);
  });

  it('the footer counts the sizes of the kind only if there is more than one', () => {
    const c = renderCard(base({ lods: [{ level: 0, triangles: 10, error: 0 }] }), 'large');
    expect(c.querySelectorAll('.card-lods button')).toHaveLength(1);
  });

  it('pulsar un LOD avisa y marca el actual', () => {
    const onLod = vi.fn();
    const c = renderCard(base(), 'large', { lod: 1, onLod });
    const bs = [...c.querySelectorAll<HTMLButtonElement>('.card-lods button')];
    expect(bs.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    bs[2].click();
    expect(onLod).toHaveBeenCalledWith(2);
  });

  it('el marco depende de la disciplina', () => {
    expect(renderCard(base({ discipline: 'fontaneria' }), 'small').classList.contains('card-d-fontaneria')).toBe(true);
    expect(renderCard(base({ discipline: 'otra' }), 'small').classList.contains('card-d-other')).toBe(true);
    expect(renderCard(base({ discipline: '' }), 'small').classList.contains('card-d-other')).toBe(true);
  });

  it('it carries the entry number with zeros, like a Pokedex', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const c = renderCard(base({ name: evil, description: evil }), 'large');
    expect(c.querySelector('.card-name')!.children).toHaveLength(0);
    expect(text(c, '.card-name')).toBe(evil);
    expect(c.querySelector('.card-desc')!.children).toHaveLength(0);
  });

  it('la carta de error muestra el nombre y el mensaje', () => {
    const c = renderErrorCard('roto.ifcx', 'Not a valid IFCX file: boom');
    expect(c.textContent).toContain('roto.ifcx');
    expect(c.textContent).toContain('Not a valid IFCX file: boom');
  });

  it('the measures are bars relative to the largest of the library', () => {
    const c = renderCard(base(), 'large', { sizes: { index: 3, total: 32 } });
    expect(text(c, '.card-foot')).toContain('3 / 32 sizes');
    expect(text(renderCard(base(), 'large', { sizes: { index: 1, total: 1 } }), '.card-foot')).not.toContain('sizes');
    expect(text(renderCard(base(), 'large'), '.card-foot')).not.toContain('sizes');
  });

  it('the small one shows the folder and the full path on hover', () => {
    expect(text(renderCard(base(), 'small', { number: 7 }), '.card-num')).toBe('#007');
    expect(text(renderCard(base(), 'large', { number: 1234 }), '.card-num')).toBe('#1234');
    expect(renderCard(base(), 'small').querySelector('.card-num')).toBeNull();
  });

  it('a card in the root of the library has no folder', () => {
    const c = renderCard(base(), 'large', { statMax: { width: 2.9038, depth: 1.1176, height: 0.9335 } });
    const fills = [...c.querySelectorAll<HTMLElement>('.card-bar-fill')].map((f) => f.style.width);
    expect(fills).toEqual(['50%', '100%', '100%']);
  });

  it('las pastillas de tipo llevan disciplina y clase', () => {
    const c = renderCard(base(), 'small');
    expect([...c.querySelectorAll('.card-pill')].map((p) => p.textContent)).toEqual(['HVAC', 'IfcAirTerminal']);
  });

  it('the big one has the Location section with folder and file', () => {
    const c = renderCard(base(), 'small');
    const loc = c.querySelector<HTMLElement>('.card-loc')!;
    expect(loc.textContent).toBe('hvac › Grille');
    expect(loc.title).toBe('/lib/hvac/Grille/g.ifcx');
  });

  it('extracts the parameters', () => {
    const c = renderCard(base({ typeFolder: '' }), 'small');
    expect(c.querySelector('.card-loc')!.textContent).toBe('Library root');
  });

  it('the refined level (-1) goes first; a mesh without it counts its original', () => {
    const c = renderCard(base(), 'large');
    const loc = c.querySelector('.card-location')!;
    expect(loc.textContent).toContain('hvac › Grille');
    expect(loc.textContent).toContain('/lib/hvac/Grille/g.ifcx');
    expect(text(c, '.card-ref')).toBe('16x4 Connection');
  });

  it('el nivel refinado se llama LOD −1 y se marca como refinado', () => {
    const lods = [{ level: -1, triangles: 3936, error: 0.001 }, { level: 0, triangles: 984, error: 0 }, { level: 2, triangles: 192, error: 0.0074 }];
    const big = renderCard(base({ lods }), 'large');
    const first = big.querySelector('.card-lods button')!.textContent!;
    expect(first).toContain('LOD −1');
    expect(first).toContain('refined');
    expect(text(renderCard(base({ lods }), 'small'), '.card-lods')).toBe('LOD −1–2');
  });
});
