import { Payload } from './types';
import { str, newConvId, textHistory } from './helpers-static';
import { DIALECTS, MODEL_PRESETS, reasoningCaps, type Dialect } from '../agent/catalog';
import { keyFor, settingsView } from '../prefs';
import { SKILLS } from '../skills';
import type { WebBridgeContext } from './context';

export function installConversations(ctx: WebBridgeContext): void {
  ctx.convRequest = convRequest;
  async function convRequest(p: Payload): Promise<unknown> {
    const type = str(p.type);
    switch (type) {
      case 'conv_list':
        return ctx.conversationsList();
      case 'conv_new':
        ctx.convId = newConvId();
        ctx.rich = [];
        ctx.history = [];
        ctx.skill = null;
        ctx.approvedBuild = null;
        ctx.needsModelReview = false;
        return { event: 'conversation', conv_id: ctx.convId, title: '', messages: [] };
      case 'conv_load': {
        const id = str(p.id_conv);
        const c = await ctx.d.store.load(id);
        if (!c) throw new Error(`Conversation '${id}' does not exist`);
        ctx.convId = c.id;
        ctx.rich = c.messages;
        ctx.history = textHistory(ctx.rich);
        ctx.skill = c.skill ?? null;
        ctx.approvedBuild = c.approved_build ?? null;
        ctx.needsModelReview = c.needs_model_review === true;
        return { event: 'conversation', conv_id: c.id, title: c.title, messages: c.messages };
      }
      case 'conv_delete': {
        await ctx.d.store.remove(str(p.id_conv));
        if (ctx.convId === str(p.id_conv)) {
          ctx.convId = null;
          ctx.rich = [];
          ctx.history = [];
          ctx.skill = null;
          ctx.approvedBuild = null;
          ctx.needsModelReview = false;
        }
        return ctx.conversationsList();
      }
      case 'settings_get':
        return { event: 'user_settings', ...settingsView(ctx.prefs) };
      case 'settings_save':
        ctx.saveKey(p);
        return { event: 'user_settings', ...settingsView(ctx.prefs) };
      case 'settings_remove_key':
        ctx.removeKey(p);
        return { event: 'user_settings', ...settingsView(ctx.prefs) };
      case 'get_model':
      case 'set_model': {
        if (type === 'set_model') {
          const model = str(p.model);
          if (!MODEL_PRESETS[ctx.prefs.provider].includes(model)) throw new Error(`Unsupported model: ${model}`);
          ctx.prefs.models[ctx.prefs.provider] = model;
          ctx.persist();
          ctx.resetSession();
        }
        return { event: 'model', model: ctx.activeModel(), presets: [...MODEL_PRESETS[ctx.prefs.provider]] };
      }
      case 'get_model_provider':
        return { event: 'model_provider', provider: ctx.prefs.provider };
      case 'set_model_provider': {
        const provider = str(p.provider).trim().toLowerCase();
        if (!DIALECTS.includes(provider as Dialect)) throw new Error(`Unsupported provider: ${provider}`);
        ctx.prefs.provider = provider as Dialect;
        ctx.persist();
        ctx.resetSession();
        return { event: 'model_provider', provider: ctx.prefs.provider };
      }
      case 'get_thinking_mode':
        return ctx.reasoningState();
      case 'set_thinking_mode': {
        const mode = str(p.mode);
        if (mode !== 'on' && mode !== 'off') throw new Error(`Unsupported thinking mode: ${mode}`);
        ctx.prefs.thinkingMode = mode;
        ctx.persist();
        return ctx.reasoningState();
      }
      case 'set_effort': {
        const effort = str(p.effort).toLowerCase().trim();
        const model = ctx.activeModel();
        if (!reasoningCaps(model, ctx.prefs.provider).efforts.includes(effort)) {
          throw new Error(`Unsupported effort for ${model}: '${effort}'`);
        }
        ctx.prefs.effort = effort;
        ctx.persist();
        return ctx.reasoningState();
      }
      case 'get_plan_mode':
      case 'set_plan_mode':
        if (type === 'set_plan_mode') {
          ctx.prefs.planMode = p.enabled === true;
          ctx.persist();
        }
        return { event: 'plan_mode', enabled: ctx.prefs.planMode };
      case 'get_auto_approve':
      case 'set_auto_approve':
        if (type === 'set_auto_approve') {
          ctx.prefs.autoApprove = p.enabled === true;
          ctx.persist();
          // when it is turned on, the cards that were waiting are approved
          if (ctx.prefs.autoApprove) for (const decide of [...ctx.pending.values()]) decide('once');
        }
        return { event: 'auto_approve', enabled: ctx.prefs.autoApprove };
      case 'get_instructions':
      case 'save_instructions':
        if (type === 'save_instructions') {
          ctx.prefs.instructions = str(p.text);
          ctx.persist();
        }
        return { event: 'instructions', text: ctx.prefs.instructions, workspace: null };
      case 'doctor': {
        const ok = keyFor(ctx.prefs, ctx.prefs.provider) !== null;
        return {
          event: 'doctor',
          checks: [
            { name: 'LLM', ok, detail: `${ctx.prefs.provider} · ${ctx.activeModel()}${ok ? '' : ' · missing API key'}` },
            { name: 'Studio', ok: true, detail: 'Web demo: the assistant runs in this browser' },
          ],
        };
      }
      case 'skills_list':
        return {
          event: 'skills',
          items: SKILLS.map(({ name, description, scope }) => ({ name, description, scope })),
        };
      default:
        // comandos, Speckle, carpeta de trabajo, fichas de modelos, tareas y sub-agentes no existen en la web:
        // as when Tauri did not capture any data
        return null;
    }
  }
}
