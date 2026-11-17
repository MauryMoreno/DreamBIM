import { CONFIRM_TIMEOUT_MS } from './helpers-static';
import { reasoningCaps } from '../agent/catalog';
import { type Decision } from '../agent/loop';
import type { WebBridgeContext } from './context';

export function installHelpers(ctx: WebBridgeContext): void {
  ctx.reasoningState = reasoningState;
  ctx.conversationsList = conversationsList;
  ctx.knownCommands = knownCommands;
  /** What the interface needs to draw the switch and the effort dropdown of the active model. */
  function reasoningState() {
    const model = ctx.activeModel();
    const caps = reasoningCaps(model, ctx.prefs.provider);
    let mode = ctx.prefs.thinkingMode === 'off' ? 'off' : 'on';
    if (caps.alwaysOn) mode = 'on';
    else if (!caps.canDisable) mode = 'off';
    const effort = caps.efforts.length
      ? ctx.prefs.effort && caps.efforts.includes(ctx.prefs.effort)
        ? ctx.prefs.effort
        : caps.defaultEffort
      : null;
    return { event: 'thinking_mode', mode, can_disable: caps.canDisable, always_on: caps.alwaysOn, efforts: [...caps.efforts], effort };
  }

  async function conversationsList() {
    const rows = await ctx.d.store.list();
    const items = [];
    for (const r of rows) {
      const c = await ctx.d.store.load(r.id);
      const turnsCount = (c?.messages ?? []).filter((m) => (m as { role?: string }).role === 'user').length;
      items.push({ ...r, turns: turnsCount, model: '' });
    }
    return { event: 'conversations', items, current: ctx.convId };
  }

  /** The commands Studio declares in `help`; if they cannot be read, the loop does not validate and the executor will say so. */
  let commandNames: ReadonlySet<string> | undefined;

  async function knownCommands(): Promise<ReadonlySet<string> | undefined> {
    if (commandNames) return commandNames;
    try {
      const r = await ctx.d.executor.run('help', {});
      const list = r.ok ? (r.result as { commands?: { name?: unknown }[] } | null)?.commands : undefined;
      const found = Array.isArray(list) ? list.map((c) => c?.name).filter((n): n is string => typeof n === 'string') : [];
      if (found.length) commandNames = new Set(found);
    } catch {
      /* sin lista: no se valida */
    }
    return commandNames;
  }

  const waitDecision =(toolUseId: string): Promise<Decision> =>
    new Promise((resolve) => {
      const finish = (decision: Decision) => {
        clearTimeout(timer);
        ctx.pending.delete(toolUseId);
        resolve(decision);
      };
      const timer = setTimeout(() => finish('deny'), CONFIRM_TIMEOUT_MS);
      ctx.pending.set(toolUseId, finish);
    });
  ctx.waitDecision = waitDecision;
}
