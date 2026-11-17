// Messages de Anthropic: sirve a Anthropic y a DeepSeek (su endpoint compatible, que solo cambia la base).
// Referencia: chatbot-revit/core/builtbot_core/anthropic_backend.py
import { parseArgs, sseCall } from './http';
import { ProviderError, type Backend, type BackendEvent, type BackendRequest, type Msg } from './types';

/**
 * Output ceiling per request; it is a ceiling, not a reservation, and reasoning counts too. Claude 5 models
 * admit up to 128k and the request streams, so they are given room to reason and answer without cuts.
 * DeepSeek se queda en el valor medido en el escritorio (chatbot-revit, MAX_OUTPUT_TOKENS).
 */
const MAX_TOKENS = 64000;
const MAX_TOKENS_DEEPSEEK = 16000;

function imageBlock(dataUrl: string): unknown | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

function toMessages(history: Msg[]): unknown[] {
  const out: unknown[] = [];
  let results: unknown[] | null = null; // los resultados seguidos van en un solo mensaje de usuario
  for (const m of history) {
    if (m.role === 'tool') {
      const image = m.image ? imageBlock(m.image) : null;
      results ??= [];
      results.push({
        type: 'tool_result',
        tool_use_id: m.id,
        content: image ? [{ type: 'text', text: m.content }, image] : m.content,
      });
      if (results.length === 1) out.push({ role: 'user', content: results });
      continue;
    }
    results = null;
    if (m.role === 'user') {
      const images = (m.images ?? []).map(imageBlock).filter((b): b is object => b !== null);
      // the provider rejects an empty text block: an image without text goes alone
      const text = m.content ? [{ type: 'text', text: m.content }] : [];
      out.push({ role: 'user', content: images.length ? [...images, ...text] : m.content });
      continue;
    }
    // el pensamiento firmado va primero, luego el texto y luego las herramientas; de lo opaco de otra ronda solo
    // thinking blocks are resent (what comes from another provider, e.g. OpenAI encrypted reasoning, is not valid here)
    const content: unknown[] = (Array.isArray(m.opaque) ? m.opaque : []).filter(
      (b): boolean => typeof b === 'object' && b !== null && ['thinking', 'redacted_thinking'].includes((b as { type?: string }).type ?? ''),
    );
    if (m.text) content.push({ type: 'text', text: m.text });
    for (const t of m.toolCalls) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args });
    const hasBody = m.text !== '' || m.toolCalls.length > 0;
    if (hasBody) out.push({ role: 'assistant', content });
  }
  return out;
}

interface Block {
  type: string;
  id?: string;
  name?: string;
  json: string;
  thinking: string;
  signature: string;
  data?: string;
}

/** `keepUnsigned` (DeepSeek): no firma su pensamiento y Python lo devuelve tal cual dentro del turno. */
export function anthropicBackend(apiKey: string, baseUrl: string, fetchImpl: typeof fetch, keepUnsigned = false): Backend {
  return {
    async *stream(req: BackendRequest, signal: AbortSignal): AsyncGenerator<BackendEvent> {
      const payload = {
        model: req.model,
        max_tokens: keepUnsigned ? MAX_TOKENS_DEEPSEEK : MAX_TOKENS,
        system: req.system,
        tools: req.tools,
        messages: toMessages(req.messages),
        stream: true,
        ...req.reasoning,
      };
      const headers = {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      const blocks = new Map<number, Block>();
      const opaque: unknown[] = [];
      let input = 0;
      let output = 0;
      let sawUsage = false;
      let truncated = false;

      for await (const m of sseCall(fetchImpl, `${baseUrl}/v1/messages`, headers, payload, signal)) {
        let ev: any;
        try {
          ev = JSON.parse(m.data);
        } catch {
          continue;
        }
        switch (ev.type) {
          case 'message_start': {
            const u = ev.message?.usage ?? {};
            input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
            output = u.output_tokens ?? 0;
            sawUsage = true;
            break;
          }
          case 'content_block_start': {
            const b = ev.content_block ?? {};
            blocks.set(ev.index, { type: b.type, id: b.id, name: b.name, json: '', thinking: '', signature: '', data: b.data });
            break;
          }
          case 'content_block_delta': {
            const d = ev.delta ?? {};
            const b = blocks.get(ev.index);
            if (d.type === 'text_delta' && d.text) yield { kind: 'text', text: d.text };
            else if (d.type === 'thinking_delta' && d.thinking) {
              if (b) b.thinking += d.thinking;
              yield { kind: 'thinking', text: d.thinking };
            } else if (d.type === 'signature_delta' && b) b.signature += d.signature ?? '';
            else if (d.type === 'input_json_delta' && b) b.json += d.partial_json ?? '';
            break;
          }
          case 'content_block_stop': {
            const b = blocks.get(ev.index);
            if (!b) break;
            if (b.type === 'tool_use') yield { kind: 'tool_call', id: b.id ?? '', name: b.name ?? '', args: parseArgs(b.json) };
            else if (b.type === 'thinking' && (b.signature || (keepUnsigned && b.thinking))) {
              opaque.push({ type: 'thinking', thinking: b.thinking, signature: b.signature });
            }
            else if (b.type === 'redacted_thinking' && b.data) opaque.push({ type: 'redacted_thinking', data: b.data });
            blocks.delete(ev.index);
            break;
          }
          case 'message_delta':
            if (ev.usage?.output_tokens != null) output = ev.usage.output_tokens;
            if (ev.delta?.stop_reason === 'max_tokens') truncated = true;
            sawUsage = true;
            break;
          case 'error':
            throw new ProviderError(ev.error?.type === 'overloaded_error' ? 529 : 500, ev.error?.message ?? 'Provider error');
        }
      }
      if (signal.aborted) return;
      if (sawUsage) yield { kind: 'usage', input, output };
      yield { kind: 'done', ...(opaque.length ? { opaque } : {}), ...(truncated ? { truncated } : {}) };
    },
  };
}
