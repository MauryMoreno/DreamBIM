// Precios de un archivo IFCx: los APU (`studio::cost::price` con `prj::apu::detalle`) y sus insumos (`prj::apu::insumo`). El precio de un APU es la suma de cantidad × precio de sus insumos. Puro.
import type { IfcxFile } from '../ifcx/types';

export interface Price {
  code: string;
  description: string;
  unit: string;
  price: number;
  /** Unit price analysis: the inputs `price` comes from (empty if the price is written). */
  breakdown?: ApuLine[];
  /** Table 21 codes the APU applies to, with what hangs from them (`prj::apu::detalle.clasificacion`: one or several). */
  classifications?: string[];
  /** Code of the material it applies to, if the APU depends on it (`prj::apu::detalle.material`). */
  material?: string;
  /** Clase IFC a la que se aplica, si el APU depende de ella (`prj::apu::detalle.clase`, p. ej. IfcColumn). */
  ifcClass?: string;
  /** Table 23 (Products) codes it applies to (`prj::apu::detalle.producto`: one or several). */
  products?: string[];
}

/** A line of an APU: an input with its yield. `precio` is that of the input; partial = quantity × price. */
export interface ApuLine {
  tipo: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precio: number;
}

export const K_COST_PRICE = 'studio::cost::price';
/** El desglose del APU: `{ insumos: [{ ref?, cantidad, … }] }`. */
export const K_APU = 'prj::apu::detalle';
/** Un insumo (material, mano de obra, equipo) con su precio; los APU lo referencian con `ref`. */
export const K_INSUMO = 'prj::apu::insumo';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * El precio de un APU (`prj::apu::detalle.insumos`): Σ cantidad × precio de sus insumos, redondeado a 2 decimales. Un
 * an input with `ref` takes the price of the `prj::apu::insumo` node given by `insumo(path)`. null if there are no inputs or if
 * some line lacks the price: then the written price applies.
 */
export function apuPrice(attrs: Record<string, unknown>, insumo: (path: string) => Record<string, unknown> | null): number | null {
  const apu = attrs[K_APU];
  if (!isObject(apu) || !Array.isArray(apu.insumos) || !apu.insumos.length) return null;
  let total = 0;
  for (const raw of apu.insumos) {
    if (!isObject(raw)) continue;
    const ins = typeof raw.ref === 'string' ? insumo(raw.ref) : null;
    const precio = finite(ins?.precio) ?? finite(raw.precio);
    if (precio === null) return null;
    total += (finite(raw.cantidad) ?? 0) * precio;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Los precios de un archivo. Un precio con APU (`prj::apu::detalle.insumos`) vale Σ cantidad × precio de sus
 * inputs; an input with `ref` to a `prj::apu::insumo` node of the file takes from it description, unit, type and
 * price, so that changing an input changes all the APUs that use it. If some line lacks the price,
 * vale el `price` escrito.
 */
export function pricesFromFile(file: IfcxFile): Price[] {
  const insumos = new Map<string, Record<string, unknown>>();
  for (const n of file.data ?? []) {
    const v = n.attributes?.[K_INSUMO];
    if (isObject(v)) insumos.set(n.path, v);
  }
  const out: Price[] = [];
  for (const n of file.data ?? []) {
    const v = n.attributes?.[K_COST_PRICE] as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object' || typeof v.code !== 'string' || typeof v.price !== 'number') continue;
    const price: Price = {
      code: v.code,
      description: typeof v.description === 'string' ? v.description : '',
      unit: typeof v.unit === 'string' ? v.unit : '',
      price: v.price,
    };
    const apu = n.attributes?.[K_APU];
    if (isObject(apu)) {
      const codes = (Array.isArray(apu.clasificacion) ? apu.clasificacion : [apu.clasificacion]).filter((c): c is string => typeof c === 'string' && c !== '');
      if (codes.length) price.classifications = codes;
      if (typeof apu.material === 'string' && apu.material) price.material = apu.material;
      if (typeof apu.clase === 'string' && apu.clase) price.ifcClass = apu.clase;
      const products = (Array.isArray(apu.producto) ? apu.producto : [apu.producto]).filter((c): c is string => typeof c === 'string' && c !== '');
      if (products.length) price.products = products;
    }
    if (isObject(apu) && Array.isArray(apu.insumos) && apu.insumos.length) {
      const lines: ApuLine[] = [];
      for (const raw of apu.insumos) {
        if (!isObject(raw)) continue;
        const ins = typeof raw.ref === 'string' ? insumos.get(raw.ref) : undefined;
        const precio = finite(ins?.precio) ?? finite(raw.precio);
        const cantidad = finite(raw.cantidad) ?? 0;
        lines.push({
          tipo: text(ins?.tipo) || text(raw.tipo),
          codigo: text(ins?.codigo) || text(raw.codigo),
          descripcion: text(ins?.descripcion) || text(raw.descripcion),
          unidad: text(ins?.unidad) || text(raw.unidad),
          cantidad,
          precio: precio ?? 0,
        });
      }
      price.breakdown = lines;
      const total = apuPrice(n.attributes ?? {}, (path) => insumos.get(path) ?? null);
      if (total !== null) price.price = total;
    }
    out.push(price);
  }
  return out;
}
