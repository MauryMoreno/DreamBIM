import { centerOf } from './geometry';
import { Room, StairPort, nearestPassable } from './grid-types';
import { placeStair } from '../staircheck';
import type { ReviewContext } from './context';

export function installLink(ctx: ReviewContext): void {
  // --- puertas, escaleras y sus enlaces -------------------------------------------------------
  const lowest = ctx.levels[0];
  ctx.lowest = lowest;

  const stairsPorts: StairPort[] = [];
  ctx.stairsPorts = stairsPorts;

  ctx.exits = 0;

  const roomsByGid = new Map<number, Room>();
  ctx.roomsByGid = roomsByGid;

  let nextGid = 0;

  for (const g of ctx.grids) {
    for (const r of g.rooms) {
      r.gid = nextGid++;
      roomsByGid.set(r.gid, r);
    }
  }

  for (const g of ctx.grids) {
    for (const d of g.doors) {
      d.entrance = g.level.id === lowest.id && (d.exterior[0] || d.exterior[1]);
      if (d.entrance) ctx.exits++;
      const [ra, rb] = d.rooms;
      const roomOf = (r: number) => (r >= 0 ? g.rooms[r] : undefined);
      const A = roomOf(ra);
      const B = roomOf(rb);
      if (A && B && A !== B) {
        A.neighbours.add(B.gid);
        B.neighbours.add(A.gid);
        A.doorRooms.add(B.gid);
        B.doorRooms.add(A.gid);
        A.doors++;
        B.doors++;
      } else if (A) A.doors++;
      else if (B) B.doors++;
      if (d.entrance) {
        if (A && !d.exterior[0]) {
          A.exits = true;
          A.doors++;
        }
        if (B && !d.exterior[1]) {
          B.exits = true;
          B.doors++;
        }
      }
    }
  }

  for (const s of ctx.doc.stairs) {
    let placed;
    try {
      placed = placeStair(ctx.doc, s);
    } catch {
      continue;
    }
    const baseG = ctx.byLevel.get(s.baseLevelId);
    const topG = ctx.byLevel.get(s.topLevelId);
    if (!baseG || !topG) continue;
    const bc = centerOf(placed.bottomClear);
    const tc = centerOf(placed.topClear);
    const bi = nearestPassable(baseG, bc);
    const ti = nearestPassable(topG, tc);
    const br = bi >= 0 ? baseG.room[bi] : -1;
    const tr = ti >= 0 ? topG.room[ti] : -1;
    const baseRoom = br >= 0 ? baseG.rooms[br] : undefined;
    const topRoom = tr >= 0 ? topG.rooms[tr] : undefined;
    if (baseRoom) baseRoom.common = true;
    if (topRoom) topRoom.common = true;
    if (baseRoom && topRoom && baseRoom !== topRoom) {
      baseRoom.neighbours.add(topRoom.gid);
      topRoom.neighbours.add(baseRoom.gid);
    }
    const treads = placed.layout.risers - placed.layout.flights.length;
    const cost = treads * 0.28 + (placed.layout.landing ? s.width : 0);
    const bf = ctx.nearestFree(baseG, bc);
    const tf = ctx.nearestFree(topG, tc);
    stairsPorts.push({
      base: bf >= 0 ? ctx.node(baseG, bf) : -1,
      top: tf >= 0 ? ctx.node(topG, tf) : -1,
      cost,
      baseRoom: baseRoom ? baseRoom.gid : -1,
      topRoom: topRoom ? topRoom.gid : -1,
      bottomCenter: bc,
      topCenter: tc,
      baseLevelId: s.baseLevelId,
      topLevelId: s.topLevelId,
    });
  }

  // common area: also the room of an entrance with doors to two or more rooms
  for (const g of ctx.grids) {
    for (const d of g.doors) {
      if (!d.entrance) continue;
      for (let k = 0; k < 2; k++) {
        const r = d.rooms[k];
        if (r < 0 || d.exterior[k]) continue;
        const room = g.rooms[r];
        if (room.doorRooms.size >= 2) room.common = true;
      }
    }
  }
}
