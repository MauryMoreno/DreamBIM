import { ReviewCheck } from './types';
import { fmt } from './geometry';
import { cellPos, nearestPassable } from './grid-types';
import { gridDistances, allDistances } from './distances';
import { type Vec2 } from '../footprint';
import type { ReviewContext } from './context';

export function installTravel(ctx: ReviewContext): void {
  // recorrido: distancias desde las entradas, cruzando escaleras
  let maxTravelAt: Map<number, { d: number; at: Vec2 }> | null = null;

  ctx.maxTravel = new Map<number, number>();

  if (ctx.exits) {
    const sources: number[] = [];
    for (const g of ctx.grids) {
      for (const d of g.doors) {
        if (!d.entrance) continue;
        for (let k = 0; k < 2; k++) {
          if (d.exterior[k]) continue;
          const p = d.sides[k];
          const c = nearestPassable(g, p);
          if (c >= 0) sources.push(ctx.node(g, c));
        }
      }
    }
    const dist = allDistances(
      ctx.grids,
      ctx.offsets,
      ctx.stairsPorts.map((p) => ({ a: p.base, b: p.top, cost: p.cost })),
      sources,
      (gi, i) => ctx.freePass(ctx.grids[gi], i),
    );
    maxTravelAt = new Map();
    for (const g of ctx.grids) {
      let best = 0;
      let at: Vec2 = [g.x0, g.y0];
      for (let i = 0; i < g.n; i++) {
        if (!ctx.freePass(g, i)) continue;
        const d = dist[ctx.node(g, i)];
        if (!Number.isFinite(d)) continue;
        if (d > best) {
          best = d;
          at = cellPos(g, i);
        }
      }
      ctx.maxTravel.set(g.li, best);
      maxTravelAt.set(g.li, { d: best, at });
    }

    const fails: Omit<ReviewCheck, 'id'>[] = [];
    for (const g of ctx.grids) {
      const v = ctx.maxTravel.get(g.li) ?? 0;
      if (v > ctx.limits.maxTravel + 1e-6) {
        fails.push({
          ok: false,
          detail: `the farthest point on ${g.level.name} is ${fmt(v)} m from an exit (limit ${fmt(ctx.limits.maxTravel)})`,
          level: g.level.name,
          at: maxTravelAt.get(g.li)?.at,
        });
      }
    }
    const longest = Math.max(...[...ctx.maxTravel.values()], 0);
    ctx.add('travel', fails.length ? fails : [{ ok: true, detail: `the longest way to an exit is ${fmt(longest)} m` }]);
  }

  // recorrido hasta la escalera en los niveles altos
  if (ctx.levels.length > 1) {
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    const stairMax = new Map<number, number>();
    for (const g of ctx.grids) {
      if (g.level.id === ctx.lowest.id) continue;
      const sources: number[] = [];
      for (const p of ctx.stairsPorts) {
        if (p.topLevelId !== g.level.id || p.top < 0) continue;
        const c = p.top - ctx.offsets[g.li];
        if (c >= 0 && c < g.n && g.passable[c]) sources.push(c);
      }
      let best = 0;
      let at: Vec2 = [g.x0, g.y0];
      if (sources.length) {
        const d = gridDistances(g, sources, (i) => ctx.freePass(g, i));
        for (let i = 0; i < g.n; i++) {
          if (!ctx.freePass(g, i)) continue;
          const v = d[i];
          if (!Number.isFinite(v)) continue;
          if (v > best) {
            best = v;
            at = cellPos(g, i);
          }
        }
      } else {
        best = Infinity;
      }
      stairMax.set(g.li, best);
      if (!(best <= ctx.limits.maxTravelToStair + 1e-6)) {
        fails.push({
          ok: false,
          detail: Number.isFinite(best)
            ? `the farthest point on ${g.level.name} is ${fmt(best)} m from a stair (limit ${fmt(ctx.limits.maxTravelToStair)})`
            : `no stair reaches ${g.level.name}`,
          level: g.level.name,
          at: Number.isFinite(best) ? at : undefined,
        });
      }
    }
    const worst = Math.max(...[...stairMax.values()].filter(Number.isFinite), 0);
    ctx.add('travel-stair', fails.length ? fails : [{ ok: true, detail: `the longest way to a stair is ${fmt(worst)} m` }]);
  }
}
