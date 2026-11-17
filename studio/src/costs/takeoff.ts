// Measures of each element of the model (quantity, length, area, volume and weight), from which the quantity of a
// partida. Puro.
import type { QuantityRow } from '../render/viewer';
import type { MaterialDef } from '../materials/state';
import type { Measure } from './system';

export interface ElementMeasures {
  path: string;
  count: 1;
  length: number;
  area: number;
  volume: number;
  /** null = ninguna de sus mallas tiene material con densidad. */
  weight: number | null;
}

/**
 * Measures per element (it groups the rows by `element`). The world box of the element, with the sides
 * d1 ≥ d2 ≥ d3, da `area = d1 × d2` (largo × alto en un muro, la planta en una losa) y `length = d1`, o el
 * eje del muro si `wallLength` lo conoce.
 */
export function elementMeasures(
  rows: QuantityRow[],
  materials: readonly MaterialDef[],
  wallLength: (path: string) => number | null,
): Map<string, ElementMeasures> {
  const density = new Map(materials.map((d) => [d.code, d.density]));
  const acc = new Map<string, { box: number[]; volume: number; weight: number; dense: boolean }>();
  for (const r of rows) {
    let a = acc.get(r.element);
    if (!a) acc.set(r.element, (a = { box: [...r.box], volume: 0, weight: 0, dense: false }));
    else {
      for (let i = 0; i < 3; i++) {
        a.box[i] = Math.min(a.box[i], r.box[i]);
        a.box[i + 3] = Math.max(a.box[i + 3], r.box[i + 3]);
      }
    }
    a.volume += r.volume;
    const d = r.materialCode === null ? undefined : density.get(r.materialCode);
    if (d !== undefined) {
      a.weight += r.volume * d;
      a.dense = true;
    }
  }
  const out = new Map<string, ElementMeasures>();
  for (const [path, a] of acc) {
    const dims = [a.box[3] - a.box[0], a.box[4] - a.box[1], a.box[5] - a.box[2]].sort((x, y) => y - x);
    out.set(path, {
      path,
      count: 1,
      length: wallLength(path) ?? dims[0],
      area: dims[0] * dims[1],
      volume: a.volume,
      weight: a.dense ? a.weight : null,
    });
  }
  return out;
}

export const NO_DENSITY = 'Some elements have no density';

/** Valor de la medida para un elemento (weight sin densidad cuenta 0). */
export function valueOf(m: ElementMeasures, measure: Measure): number {
  return measure === 'weight' ? m.weight ?? 0 : m[measure];
}
