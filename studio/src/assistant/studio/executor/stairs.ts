import { Command } from './types';
import { parsePlaceStairs, parseStairSpots } from '../../../modeling/stairplace';
import type { ExecutorContext } from './context';

export function installStairs(ctx: ExecutorContext): void {
  const stairsCommands: Command[] = [
    {
      name: 'stair_spots',
      args:
        "from (level name), to (level name), shape ('straight' | 'u'), width? (default 1.1), " +
        'limit? (default 10, max 20)',
      description:
        'Find valid places for a stair between a level and the next one above. Every spot already passes all checks ' +
        '(clear floor at both ends, no wall in the way, opening inside the upper floor). Read-only.',
      run: (a) => {
        ctx.model();
        const q = parseStairSpots(a);
        const r = ctx.host.stairSpots(q);
        return {
          risers: r.risers,
          riser: r.riser,
          spots: r.spots.map((s) => ({
            at: s.origin,
            rotation: s.angle,
            ...(s.turn ? { turn: s.turn } : {}),
            stacked: s.stacked,
            walls: s.walls,
            length: s.length,
            depth: s.depth,
          })),
          ...(r.reason ? { reason: r.reason } : {}),
        };
      },
    },
    {
      name: 'place_stairs',
      args:
        "items [{from, to, shape ('straight' | 'u'), at [x, y], rotation? (degrees), width?, " +
        "turn? ('left' | 'right')}] — use the values of a stair_spots result",
      description:
        'Create stairs with their railings and the opening in the upper floor (one undo step). Each stair is ' +
        'checked again and rejected with the reason if it does not fit.',
      preview: async (a) => (await ctx.host.placeStairs(parsePlaceStairs(a), true)).summary,
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const out = await ctx.host.placeStairs(parsePlaceStairs(a), false);
        return { ...out.summary, paths: ctx.stairPaths(out.ids) };
      },
    },
  ];
  ctx.stairsCommands = stairsCommands;
}
