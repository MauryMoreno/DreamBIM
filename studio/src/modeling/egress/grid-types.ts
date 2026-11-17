import { type LevelParams } from '../document';
import { type Vec2 } from '../footprint';
import { CELL, Poly } from './geometry';

export interface Room {
  gid: number;
  /** Index of the room within its grid (what `grid.room` stores). */
  local: number;
  grid: Grid;
  cells: number[];
  area: number;
  center: Vec2;
  common: boolean;
  doors: number;
  exits: boolean;
  neighbours: Set<number>;
  doorRooms: Set<number>;
}

export interface DoorInfo {
  grid: Grid;
  wallId: string;
  center: Vec2;
  sides: [Vec2, Vec2];
  rooms: [number, number];
  exterior: [boolean, boolean];
  width: number;
  entrance: boolean;
}

export interface StairPort {
  base: number;
  top: number;
  cost: number;
  baseRoom: number;
  topRoom: number;
  bottomCenter: Vec2;
  topCenter: Vec2;
  baseLevelId: string;
  topLevelId: string;
}

export interface Grid {
  level: LevelParams;
  li: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  n: number;
  passable: Uint8Array;
  door: Uint8Array;
  room: Int32Array;
  rooms: Room[];
  doors: DoorInfo[];
  floors: Poly[];
  walls: Poly[];
}

export const cellPos = (g: Grid, i: number): Vec2 => {
  const ix = i % g.nx;
  const iy = Math.floor(i / g.nx);
  return [g.x0 + (ix + 0.5) * CELL, g.y0 + (iy + 0.5) * CELL];
};

export const cellIndex = (g: Grid, p: Vec2): number => {
  const ix = Math.floor((p[0] - g.x0) / CELL);
  const iy = Math.floor((p[1] - g.y0) / CELL);
  if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return -1;
  return ix + iy * g.nx;
};

/** Nearest walkable cell to `p` (radius `max` cells), or -1. */
export const nearestPassable = (g: Grid, p: Vec2, max = 12): number => {
  const start = cellIndex(g, p);
  if (start >= 0 && g.passable[start]) return start;
  const si = Math.floor((p[0] - g.x0) / CELL);
  const sj = Math.floor((p[1] - g.y0) / CELL);
  for (let r = 1; r <= max; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const i = si + dx;
        const j = sj + dy;
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        const k = i + j * g.nx;
        if (g.passable[k]) return k;
      }
    }
  }
  return -1;
};
