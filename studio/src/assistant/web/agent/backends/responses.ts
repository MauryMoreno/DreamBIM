// Responses de OpenAI: el turno con herramientas de OpenAI, sin estado en su servidor (`store: false`).
// Encrypted reasoning travels between rounds inside the turn as `opaque`. Reference:
// chatbot-revit/core/builtbot_core/openai_responses_backend.py
import { parseArgs, sseCall } from './http';
import { ProviderError, type Backend, type BackendEvent, type BackendRequest, type Msg } from './types';

const CODE_STATUS: Record<string, number> = { server_error: 500, rate_limit_exceeded: 429 };

function failure(message: unknown, code: unknown, fallback: string): ProviderError {
  let text = typeof message === 'string' && message ? message : fallback;
  const c = typeof code === 'string' && code ? code : null;
  if (c && !text.toLowerCase().includes(c.toLowerCase())) text = `${text} (${c})`;
  return new ProviderError((c && CODE_STATUS[c]) || 500, text);
}

interface ReasoningItem {
  type: 'reasoning';
  id?: string;
  summary?: { type: string; text: string }[];
  encrypted_content?: string;
  status?: string;
}

/** A reasoning item is only resent if it is reproducible (it has an id and encrypted content). */
const replayable = (i: ReasoningItem): boolean => !!i.id && !!i.encrypted_content && i.status !== 'incomplete';

function toInput(history: Msg[]): unknown[] {
  const out: unknown[] = [];
  for (const m of history) {
    if (m.role === 'user') {
      if (m.content) out.push({ role: 'user', content: m.content });
    } else if (m.role === 'tool') {
      out.push({ type: 'function_call_output', call_id: m.id, output: m.content });
    } else {
      const parts: unknown[] = [];
      if (m.text) parts.push({ role: 'assistant', content: m.text });
      for (const t of m.toolCalls) {
        parts.push({ type: 'function_call', call_id: t.id, name: t.name, arguments: JSON.stringify(t.args ?? {}) });
      }
      // a reasoning needs something after it in its message ("reasoning item provided without its required following item")
      if (!parts.length) continue;
      for (const r of Array.isArray(m.opaque) ? (m.opaque as ReasoningItem[]) : []) {
        if (r.type !== 'reasoning' || !replayable(r)) continue;
        out.push({ type: 'reasoning', id: r.id, summary: r.summary ?? [], encrypted_content: r.encrypted_content });
      }
      out.push(...parts);
    }
  }
  return out;
}

export function responsesBackend(apiKey: string, baseUrl: string, fetchImpl: typeof fetch): Backend {
  return {
    async *stream(req: BackendRequest, signal: AbortSignal): AsyncGenerator<BackendEvent> {
      const payload = {
        model: req.model,
        instructions: req.system,
        input: toInput(req.messages),
        tools: req.tools.map((t) => {
          const tool = t as { name: string; description?: string; input_schema?: unknown };
          return {
            type: 'function',
            name: tool.name,
            description: tool.description ?? '',
            parameters: tool.input_schema ?? { type: 'object', properties: {} },
            strict: false,
          };
        }),
        stream: true,
        ...req.reasoning,
        store: false,
      };
      const opaque: ReasoningItem[] = [];
      const summaryPart = new Map<string, number>();
      let usage: { input: number; output: number } | null = null;
      let truncated = false;

      for await (const m of sseCall(fetchImpl, `${baseUrl}/v1/responses`, { authorization: `Bearer ${apiKey}` }, payload, signal)) {
        let ev: any;
        try {
          ev = JSON.parse(m.data);
        } catch {
          continue;
        }
        switch (ev.type) {
          case 'response.output_text.delta':
            if (ev.delta) yield { kind: 'text', text: ev.delta };
            break;
          case 'response.reasoning_summary_text.delta': {
            if (!ev.delta) break;
            const last = summaryPart.get(ev.item_id);
            const index = ev.summary_index ?? 0;
            // a new summary of the same reasoning starts in another paragraph
            if (last !== undefined && index > last) yield { kind: 'thinking', text: '\n\n' };
            summaryPart.set(ev.item_id, index);
            yield { kind: 'thinking', text: ev.delta };
            break;
          }
          case 'response.output_item.done': {
            const item = ev.item ?? {};
            if (item.type === 'reasoning' && replayable(item)) opaque.push(item);
            else if (item.type === 'function_call') {
              yield { kind: 'tool_call', id: item.call_id ?? '', name: item.name ?? '', args: parseArgs(item.arguments ?? '') };
            }
            break;
          }
          case 'response.completed':
          case 'response.incomplete': {
            if (ev.type === 'response.incomplete' && ev.response?.incomplete_details?.reason === 'max_output_tokens') truncated = true;
            const u = ev.response?.usage;
            // `input_tokens` already includes what is cached, which also takes up context. The Python subtracts it because its
            // meter adds it again; here `input` goes straight to the meter, so it is left whole.
            if (u) usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 };
            break;
          }
          case 'response.failed':
            throw failure(ev.response?.error?.message, ev.response?.error?.code, 'OpenAI response failed');
          case 'error':
            throw failure(ev.message, ev.code, 'OpenAI stream error');
        }
      }
      if (signal.aborted) return;
      if (usage) yield { kind: 'usage', ...usage };
      yield { kind: 'done', ...(opaque.length ? { opaque } : {}), ...(truncated ? { truncated } : {}) };
    },
  };
}
