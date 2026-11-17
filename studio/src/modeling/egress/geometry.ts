import { REVIEW_CELL, REVIEW_MAX_TRAVEL, REVIEW_MAX_TRAVEL_TO_STAIR, REVIEW_MIN_CORRIDOR, REVIEW_MIN_PASSAGE } from '../constants';
import { type Vec2 } from '../footprint';
import { pointInPolygon } from '../plan2d';
import { ReviewLimits } from './types';

export const DEFAULTS: ReviewLimits = {
  maxTravel: REVIEW_MAX_TRAVEL,
  maxTravelToStair: REVIEW_MAX_TRAVEL_TO_STAIR,
  minPassage: REVIEW_MIN_PASSAGE,
  minCorridor: REVIEW_MIN_CORRIDOR,
};

export const CELL = REVIEW_CELL;

export const DIAG = Math.SQRT2;

export const EPS = 1e-9;

export const MAX_FAILURES = 5;

/** The four neighbors of a cell (a constant: no array is created per visited cell). */
export const STEPS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Number formatted as in the messages: at most two decimals and no padding zeros. */
export const fmt = (v: number): string => String(+v.toFixed(2));

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Poly {
  pts: Vec2[];
  box: Box;
}

export const boxOf = (pts: Vec2[]): Box => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x0, y0, x1, y1 };
};

export const polyOf = (pts: Vec2[]): Poly => ({ pts, box: boxOf(pts) });

export const inBox = (p: Vec2, b: Box): boolean => p[0] >= b.x0 - EPS && p[0] <= b.x1 + EPS && p[1] >= b.y0 - EPS && p[1] <= b.y1 + EPS;

export const inPoly = (p: Vec2, poly: Poly): boolean => inBox(p, poly.box) && pointInPolygon(p, poly.pts);

export const centerOf = (pts: Vec2[]): Vec2 => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
};

export interface OpenRect {
  cx: number;
  cy: number;
  ux: number;
  uy: number;
  halfU: number;
  halfV: number;
}

export const inOpen = (p: Vec2, o: OpenRect): boolean => {
  const dx = p[0] - o.cx;
  const dy = p[1] - o.cy;
  const u = dx * o.ux + dy * o.uy;
  const v = -dx * o.uy + dy * o.ux;
  return Math.abs(u) <= o.halfU + EPS && Math.abs(v) <= o.halfV + EPS;
};
