import { ReviewCheck } from './types';
import { CELL, STEPS4, fmt } from './geometry';
import { cellPos } from './grid-types';
import { type Vec2 } from '../footprint';
import type { ReviewContext } from './context';

export function installPassages(ctx: ReviewContext): void {
  // common corridor: with the passage of the corridor, its doors and stairs remain connected
  {
    const common = [...ctx.roomsByGid.values()].filter((r) => r.common);
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    for (const r of common) {
      const freeCells = r.cells.filter((c) => ctx.freeCorr(r.grid, c));
      if (!freeCells.length) {
        fails.push({
          ok: false,
          detail: `the common corridor on ${r.grid.level.name} is narrower than ${fmt(ctx.limits.minCorridor)} m`,
          level: r.grid.level.name,
          at: r.center,
        });
        continue;
      }
      const local = new Map<number, number>();
      let ids = 0;
      for (const c of freeCells) {
        if (local.has(c)) continue;
        const id = ids++;
        const stack = [c];
        local.set(c, id);
        while (stack.length) {
          const x = stack.pop() as number;
          const ix = x % r.grid.nx;
          const iy = Math.floor(x / r.grid.nx);
          for (const [dx, dy] of STEPS4) {
            const nx = ix + dx;
            const ny = iy + dy;
            if (nx < 0 || ny < 0 || nx >= r.grid.nx || ny >= r.grid.ny) continue;
            const k = nx + ny * r.grid.nx;
            if (r.grid.room[k] !== r.local) continue;
            if (!ctx.freeCorr(r.grid, k) || local.has(k)) continue;
            local.set(k, id);
            stack.push(k);
          }
        }
      }
      const targetComps = new Set<number>();
      let narrow = false;
      const nearestComponent = (p: Vec2): number | null => {
        let best = -1;
        let bestD = Infinity;
        for (const c of freeCells) {
          const q = cellPos(r.grid, c);
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        if (best < 0 || bestD > ctx.limits.minCorridor + CELL) return null;
        return local.get(best) ?? null;
      };
      const addTarget = (p: Vec2): void => {
        const id = nearestComponent(p);
        if (id === null) narrow = true;
        else targetComps.add(id);
      };
      for (const g of ctx.grids) {
        for (const d of g.doors) {
          if (g !== r.grid) continue;
          if (d.rooms[0] === r.local || d.rooms[1] === r.local) addTarget(d.center);
        }
      }
      for (const p of ctx.stairsPorts) {
        if (p.baseRoom === r.gid) addTarget(p.bottomCenter);
        if (p.topRoom === r.gid) addTarget(p.topCenter);
      }
      if (narrow || targetComps.size > 1) {
        fails.push({
          ok: false,
          detail: `the common corridor on ${r.grid.level.name} is narrower than ${fmt(ctx.limits.minCorridor)} m`,
          level: r.grid.level.name,
          at: r.center,
        });
      }
    }
    if (common.length) {
      ctx.add('corridor', fails.length ? fails : [{ ok: true, detail: `the common corridors are ${fmt(ctx.limits.minCorridor)} m clear` }]);
    }
  }

  // the stair is reached from the common space, not from an apartment
  {
    const commonRooms = [...ctx.roomsByGid.values()].filter((r) => r.common);
    if (commonRooms.length) {
      const reach = new Set<number>();
      const stack: number[] = [];
      for (const r of commonRooms) {
        if (r.exits) {
          reach.add(r.gid);
          stack.push(r.gid);
        }
      }
      while (stack.length) {
        const gid = stack.pop() as number;
        const r = ctx.roomsByGid.get(gid);
        if (!r) continue;
        for (const n of r.neighbours) {
          const other = ctx.roomsByGid.get(n);
          if (!other || !other.common || reach.has(n)) continue;
          reach.add(n);
          stack.push(n);
        }
      }
      const fails: Omit<ReviewCheck, 'id'>[] = [];
      for (const r of commonRooms) {
        if (!reach.has(r.gid)) {
          fails.push({
            ok: false,
            detail: `the stair on ${r.grid.level.name} is reached through an apartment`,
            level: r.grid.level.name,
            at: r.center,
          });
        }
      }
      ctx.add('common', fails.length ? fails : [{ ok: true, detail: 'every common space reaches an exit without crossing an apartment' }]);
    }
  }
}
