import { ReviewCheck } from './types';
import { STEPS4, fmt } from './geometry';
import type { ReviewContext } from './context';

export function installAccess(ctx: ReviewContext): void {
  // accesos: recorrido por recintos, puertas y escaleras
  const reachable = new Set<number>();

  const queue: number[] = [];

  for (const r of ctx.roomsByGid.values()) {
    if (r.exits) {
      reachable.add(r.gid);
      queue.push(r.gid);
    }
  }

  while (queue.length) {
    const gid = queue.pop() as number;
    const r = ctx.roomsByGid.get(gid);
    if (!r) continue;
    for (const n of r.neighbours) {
      if (reachable.has(n)) continue;
      reachable.add(n);
      queue.push(n);
    }
  }

  {
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    let count = 0;
    for (const g of ctx.grids) {
      for (const r of g.rooms) {
        count++;
        if (!reachable.has(r.gid)) {
          fails.push({ ok: false, detail: `a room on ${g.level.name} has no way out`, level: g.level.name, at: r.center });
        }
      }
    }
    ctx.add('rooms-access', fails.length ? fails : [{ ok: true, detail: `all ${count} rooms reach an exit` }]);
  }

  // paso libre: componentes conexas de celdas libres (los vanos anchos unen recintos)
  const comp = new Int32Array(ctx.total).fill(-1);

  let comps = 0;

  for (const g of ctx.grids) {
    for (let i = 0; i < g.n; i++) {
      if (comp[ctx.node(g, i)] !== -1 || !ctx.freePass(g, i)) continue;
      const id = comps++;
      const stack = [i];
      comp[ctx.node(g, i)] = id;
      while (stack.length) {
        const c = stack.pop() as number;
        const ix = c % g.nx;
        const iy = Math.floor(c / g.nx);
        for (const [dx, dy] of STEPS4) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= g.nx || ny >= g.ny) continue;
          const k = nx + ny * g.nx;
          if (comp[ctx.node(g, k)] !== -1 || !ctx.freePass(g, k)) continue;
          comp[ctx.node(g, k)] = id;
          stack.push(k);
        }
      }
    }
  }

  const parent = Array.from({ length: comps }, (_, i) => i);

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (const p of ctx.stairsPorts) {
    const c1 = comp[p.base];
    const c2 = comp[p.top];
    if (c1 >= 0 && c2 >= 0) union(c1, c2);
  }

  const exitRoots = new Set<number>();

  for (const r of ctx.roomsByGid.values()) {
    if (!r.exits) continue;
    for (const c of r.cells) {
      const id = comp[ctx.node(r.grid, c)];
      if (id >= 0) exitRoots.add(find(id));
    }
  }

  {
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    for (const g of ctx.grids) {
      for (const r of g.rooms) {
        let free = 0;
        let ok = false;
        for (const c of r.cells) {
          const id = comp[ctx.node(g, c)];
          if (id < 0) continue;
          free++;
          if (exitRoots.has(find(id))) ok = true;
        }
        if (!free || !ok) {
          fails.push({
            ok: false,
            detail: `the way out of a room on ${g.level.name} is narrower than ${fmt(ctx.limits.minPassage)} m`,
            level: g.level.name,
            at: r.center,
          });
        }
      }
    }
    ctx.add('passage', fails.length ? fails : [{ ok: true, detail: `every room has a way out of at least ${fmt(ctx.limits.minPassage)} m` }]);
  }
}
