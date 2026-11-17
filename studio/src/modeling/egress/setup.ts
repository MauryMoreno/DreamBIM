import { ReviewLimits } from './types';
import { DEFAULTS, CELL, EPS } from './geometry';
import { Grid, cellIndex } from './grid-types';
import { buildGrid } from './grid-build';
import { distanceToObstacles } from './distances';
import { sortedLevels } from '../document';
import { type Vec2 } from '../footprint';
import type { ReviewContext } from './context';

export function installSetup(ctx: ReviewContext): void {
  const limits: ReviewLimits = { ...DEFAULTS, ...(ctx.opts.limits ?? {}) };
  ctx.limits = limits;

  const levels = sortedLevels(ctx.doc.levels);
  ctx.levels = levels;

  const grids = levels.map((level, li) => buildGrid(ctx.doc, level, li));
  ctx.grids = grids;

  const byLevel = new Map(grids.map((g) => [g.level.id, g]));
  ctx.byLevel = byLevel;

  const offsets: number[] = [];
  ctx.offsets = offsets;

  ctx.total = 0;

  for (const g of grids) {
    offsets.push(ctx.total);
    ctx.total += g.n;
  }

  const node = (g: Grid, i: number): number => offsets[g.li] + i;
  ctx.node = node;

  // distances to the non-walkable cells (for the clear passage)
  const nearWall = grids.map(distanceToObstacles);

  const passThreshold = limits.minPassage / 2 - CELL / 2;

  const corrThreshold = limits.minCorridor / 2 - CELL / 2;

  const freePass = (g: Grid, i: number): boolean => g.passable[i] === 1 && nearWall[g.li][i] >= passThreshold - EPS;
  ctx.freePass = freePass;

  const freeCorr = (g: Grid, i: number): boolean => g.passable[i] === 1 && nearWall[g.li][i] >= corrThreshold - EPS;
  ctx.freeCorr = freeCorr;

  /** Nearest free cell to `p` (the stair crosses through the clear passage, not along the edge of a wall). */
  const nearestFree = (g: Grid, p: Vec2, max = 15): number => {
    const start = cellIndex(g, p);
    if (start >= 0 && freePass(g, start)) return start;
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
          if (freePass(g, k)) return k;
        }
      }
    }
    return -1;
  };
  ctx.nearestFree = nearestFree;
}
