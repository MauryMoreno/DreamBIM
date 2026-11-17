// Executor of the commands of the agent's `Studio` tool. It validates the arguments, queries or
// drives the app through `StudioHost` and always returns a `StudioOutcome`: a failure is an error
// with the reason in English (the agent reads it and corrects itself), never an exception.
import type { StudioHost } from './host';
import { installHelpers } from './executor/helpers';
import { installQuery } from './executor/query';
import { installView } from './executor/view';
import { installMaterials } from './executor/materials';
import { installBuilding } from './executor/building';
import { installStairs } from './executor/stairs';
import { installReview } from './executor/review';
import { installEdit } from './executor/edit';
import { installRegistry } from './executor/registry';
import type { ExecutorContext } from './executor/context';
import { Args } from './executor/types';

/** What Studio answers to a call of the agent's `Studio` tool. */
export type StudioOutcome = { ok: true; result: unknown } | { ok: false; error: string };

export interface StudioExecutor {
  run(command: string, args: unknown): Promise<StudioOutcome>;
  /**
   * Dry run of a write command, without touching the model. `summary` is what is shown
   * to the user on the approval card, or null if the command has no summary of its own.
   */
  preview(
    command: string,
    args: unknown,
  ): Promise<{ ok: true; summary: unknown | null } | { ok: false; error: string }>;
}

export function createExecutor(host: StudioHost): StudioExecutor {
  const ctx = { host } as unknown as ExecutorContext;
  installHelpers(ctx);
  installQuery(ctx);
  installView(ctx);
  installMaterials(ctx);
  installBuilding(ctx);
  installStairs(ctx);
  installReview(ctx);
  installEdit(ctx);
  installRegistry(ctx);

  return {
    async run(command, args) {
      const cmd = ctx.registry.get(command);
      if (!cmd) return { ok: false, error: `Unknown command '${command}'. Run 'help' to list commands.` };
      const a = args === undefined || args === null ? {} : args;
      if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: `${command}: args must be an object` };
      try {
        return { ok: true, result: await cmd.run(a as Args) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    async preview(command, args) {
      const cmd = ctx.registry.get(command);
      if (!cmd) return { ok: false, error: `Unknown command '${command}'. Run 'help' to list commands.` };
      const a = args === undefined || args === null ? {} : args;
      if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: `${command}: args must be an object` };
      try {
        return { ok: true, summary: cmd.preview ? await cmd.preview(a as Args) : null };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
