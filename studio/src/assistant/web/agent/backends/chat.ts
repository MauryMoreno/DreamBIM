// Chat Completions: DeepSeek through its OpenAI-compatible endpoint. Previous reasoning has nowhere to travel
// in this dialect: it is not resent (on purpose). Reference: chatbot-revit/core/builtbot_core/openai_backend.py
import { parseArgs, sseCall } from './http';
import { ProviderError, type Backend, type BackendEvent, type BackendRequest, type Msg } from './types';

function toMessages(system: string, history: Msg[]): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.id, content: m.content });
    else {
      if (!m.text && !m.toolCalls.length) continue;
      const msg: Record<string, unknown> = { role: 'assistant', content: m.text || null };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) },
        }));
      }
      out.push(msg);
    }
  }
  return out;
}

export function chatBackend(apiKey: string, baseUrl: string, fetchImpl: typeof fetch): Backend {
  return {
    async *stream(req: BackendRequest, signal: AbortSignal): AsyncGenerator<BackendEvent> {
      // `extra_body` es del SDK de Python: en HTTP directo sus campos van en el nivel superior
      const { extra_body, ...reasoning } = req.reasoning as { extra_body?: Record<string, unknown> };
      const payload = {
        model: req.model,
        messages: toMessages(req.system, req.messages),
        tools: req.tools.map((t) => {
          const tool = t as { name: string; description?: string; input_schema?: unknown };
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description ?? '',
              parameters: tool.input_schema ?? { type: 'object', properties: {} },
            },
          };
        }),
        stream: true,
        stream_options: { include_usage: true },
        ...reasoning,
        ...extra_body,
      };
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let usage: { input: number; output: number } | null = null;
      let truncated = false;

      const flush = function* (): Generator<BackendEvent> {
        for (const c of [...calls.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
          yield { kind: 'tool_call', id: c.id, name: c.name, args: parseArgs(c.args) };
        }
        calls.clear();
      };

      for await (const m of sseCall(fetchImpl, `${baseUrl}/v1/chat/completions`, { authorization: `Bearer ${apiKey}` }, payload, signal)) {
        if (m.data === '[DONE]') break;
        let ev: any;
        try {
          ev = JSON.parse(m.data);
        } catch {
          continue;
        }
        if (ev.error) throw new ProviderError(500, typeof ev.error === 'string' ? ev.error : (ev.error.message ?? 'Provider error'));
        if (ev.usage) usage = { input: ev.usage.prompt_tokens ?? 0, output: ev.usage.completion_tokens ?? 0 };
        const choice = ev.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason === 'length') truncated = true;
        const d = choice.delta ?? {};
        if (d.reasoning_content) yield { kind: 'thinking', text: d.reasoning_content };
        if (d.content) yield { kind: 'text', text: d.content };
        for (const t of d.tool_calls ?? []) {
          const c = calls.get(t.index ?? 0) ?? { id: '', name: '', args: '' };
          if (t.id) c.id = t.id;
          if (t.function?.name) c.name += t.function.name;
          if (t.function?.arguments) c.args += t.function.arguments;
          calls.set(t.index ?? 0, c);
        }
      }
      if (signal.aborted) return;
      yield* flush();
      if (usage) yield { kind: 'usage', ...usage };
      yield truncated ? { kind: 'done', truncated } : { kind: 'done' };
    },
  };
}
