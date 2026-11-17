import { ReviewCheck } from './types';
import type { ReviewContext } from './context';

export function installProgram(ctx: ReviewContext): void {
  if (ctx.opts.apartments) {
    const fails: Omit<ReviewCheck, 'id'>[] = [];
    const nameKey = (s: string): string => s.trim().toLowerCase();
    for (const [name, asked] of Object.entries(ctx.opts.apartments)) {
      const g = ctx.grids.find((x) => nameKey(x.level.name) === nameKey(name));
      if (!g) {
        fails.push({ ok: false, detail: `no level named '${name}'` });
        continue;
      }
      const counted = g.rooms.filter((r) => !r.common && r.doors > 0).length;
      if (counted !== asked) {
        fails.push({
          ok: false,
          detail: `${g.level.name} has ${counted} apartments, ${asked} were asked`,
          level: g.level.name,
        });
      }
    }
    ctx.add('program', fails.length ? fails : [{ ok: true, detail: 'the apartment counts match the plan' }]);
  }

  const outLevels = ctx.grids.map((g) => ({
    level: g.level.name,
    rooms: g.rooms.length,
    apartments: g.rooms.filter((r) => !r.common && r.doors > 0).length,
    common: g.rooms.filter((r) => r.common).length,
    max_travel: Math.round((ctx.maxTravel.get(g.li) ?? 0) * 100) / 100,
  }));
  ctx.outLevels = outLevels;
}
