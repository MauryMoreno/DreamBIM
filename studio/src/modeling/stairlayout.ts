// Local, pure layout of a stair: steps, landing, clear zones, opening and railing lines.
import {
  STAIR_CLEAR,
  STAIR_GAP,
  STAIR_HEADROOM,
  STAIR_MAX_RISE,
  STAIR_MAX_RISER,
  STAIR_MAX_WIDTH,
  STAIR_MIN_RISE,
  STAIR_MIN_WIDTH,
  STAIR_STRAIGHT_MAX_RISERS,
  STAIR_TREAD,
} from './constants';
import type { Rect } from './plan2d';
import type { Vec3 } from '../composer/xform';

export type StairShape = 'straight' | 'u';
export type StairTurn = 'left' | 'right';

export interface StairFlight {
  risers: number;
  treads: number;
  x0: number;
  y: number;
  dir: 1 | -1;
  z0: number;
}

export interface RailLine {
  from: Vec3;
  to: Vec3;
  where: 'flight' | 'landing' | 'opening';
}

export interface StairLayout {
  risers: number;
  riser: number;
  tread: number;
  width: number;
  rise: number;
  flights: StairFlight[];
  landing: (Rect & { z: number }) | null;
  footprint: Rect;
  bottomClear: Rect;
  topClear: Rect;
  opening: Rect;
  rails: RailLine[];
}

const T = STAIR_TREAD;
const mm = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/** Rectangle with coordinates rounded to the millimeter in the right order. */
const rect = (x0: number, x1: number, y0: number, y1: number): Rect => ({
  x0: mm(Math.min(x0, x1)),
  x1: mm(Math.max(x0, x1)),
  y0: mm(Math.min(y0, y1)),
  y1: mm(Math.max(y0, y1)),
});

const mirror = (r: Rect): Rect => rect(r.x0, r.x1, -r.y1, -r.y0);

function fail(message: string): never {
  throw new Error(message);
}

/**
 * Lays out a stair between two elevations. `slab` is the thickness of the arrival floor (for the opening).
 * Lanza Error con el motivo si la altura o la forma no sirven.
 */
export function stairLayout(rise: number, shape: StairShape, width: number, slab: number, turn: StairTurn = 'left'): StairLayout {
  if (!(rise >= STAIR_MIN_RISE && rise <= STAIR_MAX_RISE)) fail('the storey height must be between 1 and 6 m');
  if (!(width >= STAIR_MIN_WIDTH && width <= STAIR_MAX_WIDTH)) fail("'width' must be between 0.9 and 2 m");

  const risers = Math.ceil(rise / STAIR_MAX_RISER - 1e-9);
  const riser = rise / risers;
  const w = width;
  const C = Math.max(w, STAIR_CLEAR);
  const half = w / 2;

  if (shape === 'straight') {
    if (risers > STAIR_STRAIGHT_MAX_RISERS) {
      fail(`a straight stair takes at most ${STAIR_STRAIGHT_MAX_RISERS} risers; this storey needs ${risers}: use shape 'u'`);
    }
    const L = mm((risers - 1) * T);
    // primera huella cuya cara superior deja menos de la altura libre pedida
    const threshold = rise - slab - STAIR_HEADROOM;
    let xh = 0;
    for (let i = 0; i < risers - 1; i++) {
      if ((i + 1) * riser > threshold) {
        xh = mm(i * T);
        break;
      }
    }
    const y0 = mm(-half);
    const y1 = mm(half);
    const opening = rect(xh, L, y0, y1);
    const z = rise;
    const rails: RailLine[] = [
      { from: [0, y0, riser], to: [L, y0, rise], where: 'flight' },
      { from: [0, y1, riser], to: [L, y1, rise], where: 'flight' },
      { from: [xh, y0, z], to: [xh, y1, z], where: 'opening' },
      { from: [xh, y0, z], to: [L, y0, z], where: 'opening' },
      { from: [xh, y1, z], to: [L, y1, z], where: 'opening' },
    ];
    return {
      risers,
      riser,
      tread: T,
      width: w,
      rise,
      flights: [{ risers, treads: risers - 1, x0: 0, y: 0, dir: 1, z0: 0 }],
      landing: null,
      footprint: rect(0, L, y0, y1),
      bottomClear: rect(-C, 0, y0, y1),
      topClear: rect(L, L + C, y0, y1),
      opening,
      rails,
    };
  }

  if (risers < 4) fail('the storey is too low for a U stair');
  const n1 = Math.ceil(risers / 2);
  const n2 = risers - n1;
  const L1 = mm((n1 - 1) * T);
  const L2 = mm((n2 - 1) * T);
  const xa = mm(L1 - L2);
  const threshold = rise - slab - STAIR_HEADROOM;
  // si ninguna huella del tramo 1 se queda sin altura libre (pisos altos), el hueco no lo necesita
  let xh = L1;
  for (let i = 0; i < n1 - 1; i++) {
    if ((i + 1) * riser > threshold) {
      xh = mm(i * T);
      break;
    }
  }
  if (xh < xa) fail('the storey is too low for a U stair');

  const y0 = mm(-half);
  const y1 = mm(w + STAIR_GAP + half);
  const landing: Rect & { z: number } = { ...rect(L1, L1 + w, y0, y1), z: n1 * riser };
  const flight2Y = mm(w + STAIR_GAP);
  const opening = rect(xa, L1 + w, y0, y1);
  const topClear = rect(xa - C, xa, flight2Y - half, flight2Y + half);
  const bottomClear = rect(-C, 0, y0, mm(half));

  const rails: RailLine[] = [
    { from: [0, y0, riser], to: [L1, y0, n1 * riser], where: 'flight' },
    { from: [0, mm(half), riser], to: [L1, mm(half), n1 * riser], where: 'flight' },
    { from: [L1, mm(flight2Y - half), n1 * riser + riser], to: [xa, mm(flight2Y - half), rise], where: 'flight' },
    { from: [L1, mm(flight2Y + half), n1 * riser + riser], to: [xa, mm(flight2Y + half), rise], where: 'flight' },
    { from: [L1, y0, landing.z], to: [L1 + w, y0, landing.z], where: 'landing' },
    { from: [L1, y1, landing.z], to: [L1 + w, y1, landing.z], where: 'landing' },
    { from: [L1 + w, y0, landing.z], to: [L1 + w, y1, landing.z], where: 'landing' },
  ];
  // arrival edge (x = xa across the width of flight 2): it carries no railing; the rest of the edge does
  const low = mm(flight2Y - half);
  const high = mm(flight2Y + half);
  if (low - y0 > 1e-9) rails.push({ from: [xa, y0, rise], to: [xa, low, rise], where: 'opening' });
  if (y1 - high > 1e-9) rails.push({ from: [xa, high, rise], to: [xa, y1, rise], where: 'opening' });
  rails.push(
    { from: [L1 + w, y0, rise], to: [L1 + w, y1, rise], where: 'opening' },
    { from: [xa, y0, rise], to: [L1 + w, y0, rise], where: 'opening' },
    { from: [xa, y1, rise], to: [L1 + w, y1, rise], where: 'opening' },
  );

  const left: StairLayout = {
    risers,
    riser,
    tread: T,
    width: w,
    rise,
    flights: [
      { risers: n1, treads: n1 - 1, x0: 0, y: 0, dir: 1, z0: 0 },
      { risers: n2, treads: n2 - 1, x0: L1, y: flight2Y, dir: -1, z0: n1 * riser },
    ],
    landing,
    footprint: rect(0, L1 + w, y0, y1),
    bottomClear,
    topClear,
    opening,
    rails,
  };
  if (turn === 'left') return left;

  // 'right' es el espejo en y
  return {
    ...left,
    flights: left.flights.map((f) => ({ ...f, y: mm(-f.y) })),
    landing: { ...mirror(landing), z: landing.z },
    footprint: mirror(left.footprint),
    bottomClear: mirror(left.bottomClear),
    topClear: mirror(left.topClear),
    opening: mirror(left.opening),
    rails: left.rails.map((r) => ({ ...r, from: [r.from[0], mm(-r.from[1]), r.from[2]], to: [r.to[0], mm(-r.to[1]), r.to[2]] })),
  };
}
