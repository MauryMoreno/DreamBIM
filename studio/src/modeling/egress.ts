// Geometric review of access, evacuation and stairs: it walks each level as a grid,
// recognizes rooms, doors and stairs, and checks that everything can be reached from an exit.
import { sortedLevels, type StudioDoc } from './document';
import { installSetup } from './egress/setup';
import { installLink } from './egress/link';
import { installEntrances } from './egress/entrances';
import { installAccess } from './egress/access';
import { installPassages } from './egress/passages';
import { installTravel } from './egress/travel';
import { installProgram } from './egress/program';
import type { ReviewContext } from './egress/context';
import { ReviewOptions, Review, RoomProbe } from './egress/types';
import { Room, cellIndex } from './egress/grid-types';
import { buildGrid } from './egress/grid-build';
export type { ReviewLimits, ReviewOptions, Review, RoomProbe } from './egress/types';

/** Rejilla de recintos y puertas del documento, sin escaleras ni comprobaciones. */
export function roomProbe(doc: StudioDoc): RoomProbe {
  const gridList = sortedLevels(doc.levels).map((level, li) => buildGrid(doc, level, li));
  const byId = new Map(gridList.map((g) => [g.level.id, g]));
  const all: Room[] = [];
  for (const g of gridList) {
    for (const r of g.rooms) {
      r.gid = all.length;
      all.push(r);
    }
  }
  for (const g of gridList) {
    for (const d of g.doors) {
      const A = d.rooms[0] >= 0 ? g.rooms[d.rooms[0]] : undefined;
      const B = d.rooms[1] >= 0 ? g.rooms[d.rooms[1]] : undefined;
      if (A && B && A !== B) {
        A.doors++;
        B.doors++;
        A.doorRooms.add(B.gid);
        B.doorRooms.add(A.gid);
      } else if (A) A.doors++;
      else if (B) B.doors++;
    }
  }
  return {
    roomAt(levelId, p) {
      const g = byId.get(levelId);
      if (!g) return null;
      const i = cellIndex(g, p);
      if (i < 0 || !g.passable[i]) return null;
      const r = g.rooms[g.room[i]];
      return r ? { area: r.area, doors: r.doors } : null;
    },
  };
}

export function reviewDoc(doc: StudioDoc, opts: ReviewOptions = {}): Review {
  const ctx = { doc, opts } as unknown as ReviewContext;
  installSetup(ctx);
  installLink(ctx);
  installEntrances(ctx);
  installAccess(ctx);
  installPassages(ctx);
  installTravel(ctx);
  installProgram(ctx);

  return { ok: ctx.checks.every((c) => c.ok), checks: ctx.checks, exits: ctx.exits, levels: ctx.outLevels };
}
