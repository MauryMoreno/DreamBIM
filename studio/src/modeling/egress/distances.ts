import { CELL, DIAG, EPS } from './geometry';
import { Grid } from './grid-types';

/** Grid of minimum distances by cells (8 neighbors) from the given sources. */
export function gridDistances(g: Grid, sources: number[], allowed: (i: number) => boolean): Float64Array {
  const dist = new Float64Array(g.n).fill(Infinity);
  const heap = new MinHeap();
  for (const s of sources) {
    if (s < 0 || s >= g.n || dist[s] === 0) continue;
    dist[s] = 0;
    heap.push(s, 0);
  }
  while (heap.size) {
    const [id, d] = heap.pop();
    if (d > dist[id] + EPS) continue;
    const ix = id % g.nx;
    const iy = Math.floor(id / g.nx);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= g.nx || ny >= g.ny) continue;
        const k = nx + ny * g.nx;
        if (!allowed(k)) continue;
        const nd = d + CELL * (dx && dy ? DIAG : 1);
        if (nd < dist[k] - EPS) {
          dist[k] = nd;
          heap.push(k, nd);
        }
      }
    }
  }
  return dist;
}

/** Approximate distance from each cell to the nearest non-walkable cell (two passes, no heap). */
export function distanceToObstacles(g: Grid): Float64Array {
  const d = new Float64Array(g.n);
  const INF = 1e9;
  for (let i = 0; i < g.n; i++) d[i] = g.passable[i] ? INF : 0;
  const relax = (k: number, v: number): boolean => {
    if (v < d[k]) {
      d[k] = v;
      return true;
    }
    return false;
  };
  for (let iy = 0; iy < g.ny; iy++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const k = ix + iy * g.nx;
      let v = d[k];
      if (ix > 0) v = Math.min(v, d[k - 1] + CELL);
      if (iy > 0) {
        v = Math.min(v, d[k - g.nx] + CELL);
        if (ix > 0) v = Math.min(v, d[k - g.nx - 1] + CELL * DIAG);
        if (ix + 1 < g.nx) v = Math.min(v, d[k - g.nx + 1] + CELL * DIAG);
      }
      relax(k, v);
    }
  }
  for (let iy = g.ny - 1; iy >= 0; iy--) {
    for (let ix = g.nx - 1; ix >= 0; ix--) {
      const k = ix + iy * g.nx;
      let v = d[k];
      if (ix + 1 < g.nx) v = Math.min(v, d[k + 1] + CELL);
      if (iy + 1 < g.ny) {
        v = Math.min(v, d[k + g.nx] + CELL);
        if (ix + 1 < g.nx) v = Math.min(v, d[k + g.nx + 1] + CELL * DIAG);
        if (ix > 0) v = Math.min(v, d[k + g.nx - 1] + CELL * DIAG);
      }
      relax(k, v);
    }
  }
  return d;
}

/** Binary min-heap of (id, key) pairs. */
export class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const id = this.ids[0];
    const key = this.keys[0];
    const lastId = this.ids.pop() as number;
    const lastKey = this.keys.pop() as number;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return [id, key];
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = id;
    const key = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = key;
  }
}

/** Global distances of the building, with the stairs as portals. */
export function allDistances(
  grids: Grid[],
  offsets: number[],
  portals: { a: number; b: number; cost: number }[],
  sources: number[],
  allowed: (gi: number, i: number) => boolean,
): Float64Array {
  let total = 0;
  for (const g of grids) total += g.n;
  const dist = new Float64Array(total).fill(Infinity);
  const heap = new MinHeap();
  const levelIndex = (id: number): number => {
    let gi = 0;
    while (gi + 1 < offsets.length && id >= offsets[gi + 1]) gi++;
    return gi;
  };
  const portalFrom = new Map<number, { to: number; cost: number }[]>();
  for (const p of portals) {
    if (!portalFrom.has(p.a)) portalFrom.set(p.a, []);
    if (!portalFrom.has(p.b)) portalFrom.set(p.b, []);
    portalFrom.get(p.a)!.push({ to: p.b, cost: p.cost });
    portalFrom.get(p.b)!.push({ to: p.a, cost: p.cost });
  }
  const allowedNode = (id: number): boolean => {
    if (id < 0 || id >= total) return false;
    const gi = levelIndex(id);
    return allowed(gi, id - offsets[gi]);
  };
  for (const s of sources) {
    if (s < 0 || s >= total || dist[s] === 0) continue;
    dist[s] = 0;
    heap.push(s, 0);
  }
  while (heap.size) {
    const [id, d] = heap.pop();
    if (d > dist[id] + EPS) continue;
    const gi = levelIndex(id);
    const g = grids[gi];
    const i = id - offsets[gi];
    const ix = i % g.nx;
    const iy = Math.floor(i / g.nx);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 0 || ny < 0 || nx >= g.nx || ny >= g.ny) continue;
        if (!allowed(gi, nx + ny * g.nx)) continue;
        const k = offsets[gi] + nx + ny * g.nx;
        const nd = d + CELL * (dx && dy ? DIAG : 1);
        if (nd < dist[k] - EPS) {
          dist[k] = nd;
          heap.push(k, nd);
        }
      }
    }
    for (const p of portalFrom.get(id) ?? []) {
      if (!allowedNode(p.to)) continue;
      const nd = d + p.cost;
      if (nd < dist[p.to] - EPS) {
        dist[p.to] = nd;
        heap.push(p.to, nd);
      }
    }
  }
  return dist;
}
