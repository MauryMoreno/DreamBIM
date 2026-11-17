import { CheckId, ReviewCheck } from './types';
import { MAX_FAILURES, fmt, boxOf } from './geometry';
import { type Vec2 } from '../footprint';
import { checkStair } from '../staircheck';
import type { ReviewContext } from './context';

export function installEntrances(ctx: ReviewContext): void {
  // --- comprobaciones -------------------------------------------------------------------------
  const checks: ReviewCheck[] = [];
  ctx.checks = checks;

  const add = (id: CheckId, entries: Omit<ReviewCheck, 'id'>[]): void => {
    if (!entries.length) return;
    for (const e of entries.slice(0, MAX_FAILURES)) checks.push({ id, ...e });
  };
  ctx.add = add;

  const lots = ctx.opts.lot;

  if (lots) {
    const setback = lots.setback ?? 0;
    const pts: Vec2[] = [];
    for (const g of ctx.grids) {
      for (const w of g.walls) pts.push(...w.pts);
      for (const f of g.floors) pts.push(...f.pts);
    }
    if (pts.length) {
      const b = boxOf(pts);
      const over = [
        { side: 'front', d: setback - b.y0 },
        { side: 'back', d: b.y1 - (lots.depth - setback) },
        { side: 'left', d: setback - b.x0 },
        { side: 'right', d: b.x1 - (lots.width - setback) },
      ];
      const worst = over.reduce((a, c) => (c.d > a.d ? c : a));
      if (worst.d > 1e-6) {
        add('lot', [{ ok: false, detail: `the building leaves the lot by ${fmt(worst.d)} m on the ${worst.side} side` }]);
      } else {
        add('lot', [{ ok: true, detail: 'the building fits inside the lot' }]);
      }
    }
  }

  const lowestName = ctx.lowest.name;

  if (ctx.exits) {
    add('entrance', [{ ok: true, detail: `${ctx.exits} door${ctx.exits === 1 ? '' : 's'} to the outside on ${lowestName}` }]);
  } else {
    add('entrance', [{ ok: false, detail: `no door to the outside on ${lowestName}`, level: lowestName }]);
  }

  if (lots && ctx.exits) {
    const front = ctx.grids.some((g) =>
      g.doors.some(
        (d) =>
          d.entrance &&
          d.exterior.some((ext, k) => ext && d.sides[k][1] - d.center[1] < -1e-6),
      ),
    );
    add('front-entrance', [
      front
        ? { ok: true, detail: 'the entrance is on the street side (y = 0)' }
        : { ok: false, detail: 'no entrance on the street side (y = 0)' },
    ]);
  }

  if (ctx.levels.length > 1) {
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    for (let i = 0; i + 1 < ctx.levels.length; i++) {
      const a = ctx.levels[i];
      const b = ctx.levels[i + 1];
      const between = ctx.doc.stairs.filter((s) => s.baseLevelId === a.id && s.topLevelId === b.id);
      if (!between.length) {
        fails.push({ ok: false, detail: `no stair between ${a.name} and ${b.name}`, level: a.name });
        continue;
      }
      let reason: string | null = null;
      let ok = false;
      for (const s of between) {
        reason = checkStair(ctx.doc, s);
        if (reason === null) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        fails.push({ ok: false, detail: `the stair between ${a.name} and ${b.name} is not valid: ${reason}`, level: a.name });
      }
    }
    add('stairs', fails.length ? fails : [{ ok: true, detail: `${ctx.doc.stairs.length} stair${ctx.doc.stairs.length === 1 ? '' : 's'} between the levels` }]);
  }
}
