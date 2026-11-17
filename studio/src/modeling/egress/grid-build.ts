import { REVIEW_MIN_ROOM_AREA } from '../constants';
import { type LevelParams, type StudioDoc } from '../document';
import { wallFootprints, type Vec2 } from '../footprint';
import { doorSides, placeStair } from '../staircheck';
import { CELL, EPS, Box, Poly, boxOf, polyOf, inPoly, OpenRect, inOpen } from './geometry';
import { Grid, cellPos, cellIndex } from './grid-types';

export function buildGrid(doc: StudioDoc, level: LevelParams, li: number): Grid {
  const floors = doc.floors
    .filter((f) => f.levelId === level.id)
    .map((f) => polyOf(f.boundary));
  const walls = [...wallFootprints(doc.walls.filter((w) => w.baseLevelId === level.id)).values()].map(polyOf);
  const grid: Grid = {
    level,
    li,
    x0: 0,
    y0: 0,
    nx: 0,
    ny: 0,
    n: 0,
    passable: new Uint8Array(0),
    door: new Uint8Array(0),
    room: new Int32Array(0),
    rooms: [],
    doors: [],
    floors,
    walls,
  };
  if (!floors.length) return grid;

  const all = floors.flatMap((f) => f.pts);
  const box = boxOf(all);
  grid.x0 = box.x0;
  grid.y0 = box.y0;
  grid.nx = Math.max(1, Math.ceil((box.x1 - box.x0) / CELL));
  grid.ny = Math.max(1, Math.ceil((box.y1 - box.y0) / CELL));
  grid.n = grid.nx * grid.ny;
  grid.passable = new Uint8Array(grid.n);
  grid.door = new Uint8Array(grid.n);
  grid.room = new Int32Array(grid.n).fill(-1);

  const holes: Poly[] = [];
  for (const s of doc.stairs) {
    try {
      const placed = placeStair(doc, s);
      if (s.topLevelId === level.id) holes.push(polyOf(placed.opening));
      if (s.baseLevelId === level.id) holes.push(polyOf(placed.footprint));
    } catch {
      // a stair that can no longer be laid out hides nothing
    }
  }

  const thickness = new Map(doc.walls.filter((w) => w.baseLevelId === level.id).map((w) => [w.id, w.thickness]));
  const opens: OpenRect[] = [];
  for (const door of doorSides(doc, level.id)) {
    const t = thickness.get(door.wallId) ?? 0.2;
    const dx = door.sides[0][0] - door.center[0];
    const dy = door.sides[0][1] - door.center[1];
    const len = Math.hypot(dx, dy) || 1;
    opens.push({
      cx: door.center[0],
      cy: door.center[1],
      ux: -dy / len,
      uy: dx / len,
      halfU: door.width / 2,
      halfV: (t + 0.2) / 2,
    });
  }

  // walls and openings are painted only in the cells of their box, they are not tested against every cell of the level
  const inWall = new Uint8Array(grid.n);
  const inDoor = new Uint8Array(grid.n);
  const paint = (box: Box, mask: Uint8Array, hit: (p: Vec2) => boolean): void => {
    const ix0 = Math.max(0, Math.floor((box.x0 - grid.x0) / CELL) - 1);
    const iy0 = Math.max(0, Math.floor((box.y0 - grid.y0) / CELL) - 1);
    const ix1 = Math.min(grid.nx - 1, Math.floor((box.x1 - grid.x0) / CELL) + 1);
    const iy1 = Math.min(grid.ny - 1, Math.floor((box.y1 - grid.y0) / CELL) + 1);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const k = ix + iy * grid.nx;
        if (!mask[k] && hit(cellPos(grid, k))) mask[k] = 1;
      }
    }
  };
  for (const w of walls) paint(w.box, inWall, (p) => inPoly(p, w));
  for (const o of opens) {
    const r = Math.hypot(o.halfU, o.halfV);
    paint({ x0: o.cx - r, y0: o.cy - r, x1: o.cx + r, y1: o.cy + r }, inDoor, (p) => inOpen(p, o));
  }

  for (let i = 0; i < grid.n; i++) {
    if (inWall[i] && !inDoor[i]) continue;
    const p = cellPos(grid, i);
    if (!floors.some((f) => inPoly(p, f))) continue;
    if (holes.some((h) => inPoly(p, h))) continue;
    grid.passable[i] = 1;
    if (inDoor[i]) grid.door[i] = 1;
  }

  // recintos: componentes conexas de celdas pisables fuera de los vanos
  const visited = new Uint8Array(grid.n);
  for (let i = 0; i < grid.n; i++) {
    if (!grid.passable[i] || grid.door[i] || visited[i]) continue;
    const cells: number[] = [];
    const stack = [i];
    visited[i] = 1;
    while (stack.length) {
      const c = stack.pop() as number;
      cells.push(c);
      const ix = c % grid.nx;
      const iy = Math.floor(c / grid.nx);
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= grid.nx || ny >= grid.ny) return;
        const k = nx + ny * grid.nx;
        if (!grid.passable[k] || grid.door[k] || visited[k]) return;
        visited[k] = 1;
        stack.push(k);
      };
      push(ix + 1, iy);
      push(ix - 1, iy);
      push(ix, iy + 1);
      push(ix, iy - 1);
    }
    const area = cells.length * CELL * CELL;
    if (area < REVIEW_MIN_ROOM_AREA - EPS) continue;
    const gid = grid.rooms.length;
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      grid.room[c] = gid;
      const p = cellPos(grid, c);
      sx += p[0];
      sy += p[1];
    }
    grid.rooms.push({
      gid,
      local: gid,
      grid,
      cells,
      area,
      center: [sx / cells.length, sy / cells.length],
      common: false,
      doors: 0,
      exits: false,
      neighbours: new Set(),
      doorRooms: new Set(),
    });
  }

  for (const door of doorSides(doc, level.id)) {
    const rooms = door.sides.map((side) => {
      const c = cellIndex(grid, side);
      return c >= 0 && grid.passable[c] ? grid.room[c] : -1;
    }) as [number, number];
    const exterior = door.sides.map((side) => !floors.some((f) => inPoly(side, f))) as [boolean, boolean];
    grid.doors.push({
      grid,
      wallId: door.wallId,
      center: door.center,
      sides: door.sides,
      rooms,
      exterior,
      width: door.width,
      entrance: false,
    });
  }
  return grid;
}
