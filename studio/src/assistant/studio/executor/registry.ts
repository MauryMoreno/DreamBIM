import { Command } from './types';
import type { ExecutorContext } from './context';

export function installRegistry(ctx: ExecutorContext): void {
  const commands: Command[] = [...ctx.queryCommands, ...ctx.viewCommands, ...ctx.materialsCommands, ...ctx.buildingCommands, ...ctx.stairsCommands, ...ctx.reviewCommands, ...ctx.editCommands];
  ctx.commands = commands;

  const registry = new Map(commands.map((c) => [c.name, c]));
  ctx.registry = registry;
}
