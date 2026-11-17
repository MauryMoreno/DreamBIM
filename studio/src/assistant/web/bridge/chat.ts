import { Payload } from './types';
import { NO_KEY_MESSAGE, str, newConvId, readImages, titleOf } from './helpers-static';
import { stableKey } from '../../../modeling/planreview';
import { backendFor } from '../agent/backends';
import { modelSeesImages } from '../agent/catalog';
import { runTurn } from '../agent/loop';
import { nowStamp, type SavedConversation } from '../conversations';
import { keyFor } from '../prefs';
import { parseSkillCommand, skillByName, SKILLS } from '../skills';
import type { WebBridgeContext } from './context';

export function installChat(ctx: WebBridgeContext): void {
  ctx.chatStream = chatStream;
  async function chatStream(payload: Payload): Promise<void> {
    const id = str(payload.id) || 'unknown';
    let text = str(payload.text);
    const chat = (ev: string, p: Payload) => ctx.d.bus.emit(`chat://${ev}`, p);
    const mine = new Set<string>();
    ctx.d.bus.emit('studio://turn-start', { id });
    try {
      const skillCmd = parseSkillCommand(text);
      if (skillCmd) {
        const chosen = skillCmd.name === null ? null : skillByName(skillCmd.name);
        if (skillCmd.name !== null && !chosen) {
          chat('start', { id });
          chat('delta', {
            id,
            text: `Unknown skill '${skillCmd.name}'. Available: ${SKILLS.map((s) => s.name).join(', ')}.`,
          });
          chat('end', { id });
          return;
        }
        if (chosen) {
          ctx.skill = chosen.name;
          ctx.approvedBuild = null;
          ctx.needsModelReview = false;
          text = `Start the "${chosen.name}" skill now.`;
        } else {
          ctx.skill = null;
          ctx.needsModelReview = false;
          text = 'The skill was turned off.';
        }
      }
      const dialect = ctx.prefs.provider;
      const key = keyFor(ctx.prefs, dialect);
      if (!key) {
        chat('error', { id, message: NO_KEY_MESSAGE });
        chat('end', { id });
        return;
      }
      const images = readImages(payload.images);
      if (!text.trim() && !images.urls.length) {
        chat('end', { id }); // the automatic turns of sub-agents do not exist on the web
        return;
      }
      if (images.urls.length && !modelSeesImages(ctx.activeModel(), dialect)) {
        // sending it would not give an error: the model would answer without having seen it
        chat('error', { id, message: `${ctx.activeModel()} cannot see images. Remove the image or switch to a model that can.` });
        chat('end', { id });
        return;
      }
      const ctl = new AbortController();
      ctx.turns.set(id, ctl);
      const turnConv = (ctx.convId ??= newConvId());
      const before = ctx.rich;
      let endPayload: Payload = { id };
      const active = ctx.skill ? skillByName(ctx.skill) : undefined;
      const result = await runTurn(id, {
        backend: backendFor(dialect, key, ctx.d.fetchImpl),
        model: ctx.activeModel(),
        dialect,
        history: ctx.history,
        text,
        images: images.urls,
        executor: ctx.d.executor,
        emit: (ev, p) => {
          if (ev === 'end') endPayload = p; // the end comes after saving: the list of conversations will already see it
          else chat(ev, p);
        },
        confirm: (toolUseId) => {
          mine.add(toolUseId);
          return ctx.waitDecision(toolUseId);
        },
        // auto-approval is read live, as on desktop (`_auto_approve` of chat_handlers.py): turning it off in
        // the middle of the turn makes the next write ask. The rest is fixed when the turn starts.
        prefs: {
          ...ctx.prefs,
          get autoApprove() {
            return ctx.prefs.autoApprove;
          },
        },
        signal: ctl.signal,
        alwaysApproved: ctx.always,
        commands: await ctx.knownCommands(),
        ...(active
          ? {
              skill: active.prompt,
              gate: (command: string, args: unknown): string | null =>
                command === 'build_model' && stableKey(args) !== ctx.approvedBuild ? ctx.SKILL_GATE : null,
              onResult: (command: string, _args: unknown, outcome: unknown): string | null => {
                if (command === 'review_plan') {
                  const r = outcome as { ok?: unknown; build_key?: unknown } | null;
                  ctx.approvedBuild = r && r.ok === true && typeof r.build_key === 'string' ? r.build_key : null;
                }
                if (ctx.WRITES.has(command)) ctx.needsModelReview = true;
                if (command === 'review_model' && (outcome as { ok?: unknown } | null)?.ok === true) {
                  ctx.needsModelReview = false;
                }
                return ctx.needsModelReview && ctx.WRITES.has(command) ? ctx.REVIEW_NOTE : null;
              },
            }
          : {}),
      });
      const userMessage = { role: 'user', content: text, ...(images.records.length ? { images: images.records } : {}) };
      const messages = [...before, userMessage, result.saved];
      if (ctx.convId === turnConv) {
        ctx.rich = messages;
        ctx.history = result.history;
      }
      const saved: SavedConversation = {
        id: turnConv,
        title: titleOf(messages),
        updated_at: nowStamp(),
        messages,
        ...(ctx.skill ? { skill: ctx.skill } : {}),
        ...(ctx.approvedBuild ? { approved_build: ctx.approvedBuild } : {}),
        ...(ctx.needsModelReview ? { needs_model_review: true } : {}),
      };
      try {
        await ctx.d.store.save(saved);
      } catch (e) {
        console.error('could not save the conversation', e);
      }
      chat('end', endPayload);
    } catch (e) {
      chat('error', { id, message: e instanceof Error ? e.message : String(e) });
      chat('end', { id });
    } finally {
      ctx.turns.delete(id);
      for (const toolUseId of mine) ctx.pending.get(toolUseId)?.('deny'); // a card that was left waiting
      ctx.d.bus.emit('studio://turn-end', { id });
    }
  }
}
