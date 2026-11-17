import { describe, expect, it, vi } from 'vitest';
import { parseSse } from '../src/assistant/web/agent/sse';
import { sseCall } from '../src/assistant/web/agent/backends/http';
import { backendFor } from '../src/assistant/web/agent/backends';
import { ProviderError, type BackendEvent, type BackendRequest, type Msg } from '../src/assistant/web/agent/backends/types';

const enc = new TextEncoder();

/** A response body with the given chunks; with `hang` it is not closed until cancelled. */
function body(chunks: string[], hang = false): ReadableStream<Uint8Array> {
  let i = 0;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i++]));
        return;
      }
      if (!hang) {
        controller.close();
        return;
      }
      return new Promise<void>((resolve) => {
        const t = setInterval(() => {
          if (cancelled) {
            clearInterval(t);
            resolve();
          }
        }, 5);
      });
    },
    cancel() {
      cancelled = true;
    },
  });
}

const frame = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

function respond(chunks: string[], status = 200, hang = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body(chunks, hang),
    text: async () => chunks.join(''),
  } as unknown as Response;
}

function fakeFetch(...responses: Response[]) {
  const calls: { url: string; init: RequestInit; json: any }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, json: init?.body ? JSON.parse(String(init.body)) : null });
    const r = responses.shift();
    if (!r) throw new Error('sin más respuestas guionizadas');
    return r;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

async function collect(it: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const out: BackendEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const TOOLS = [{ name: 'Studio', description: 'd', input_schema: { type: 'object', properties: {} } }];
const req = (messages: Msg[], extra: Partial<BackendRequest> = {}): BackendRequest => ({
  model: 'm',
  system: 'SYS',
  messages,
  tools: TOOLS,
  reasoning: {},
  ...extra,
});
const ac = () => new AbortController();

describe('parser SSE', () => {
  const run = async (chunks: string[]) => {
    const out = [];
    for await (const m of parseSse(body(chunks))) out.push(m);
    return out;
  };

  it('une un mensaje partido entre trozos y entiende CRLF', async () => {
    expect(await run(['event: a\r\nda', 'ta: {"x":1}\r\n\r\ndata: segundo\n\n'])).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: null, data: 'segundo' },
    ]);
  });

  it('joins several data lines with a line break and ignores comments', async () => {
    expect(await run([': latido\n\ndata: uno\ndata: dos\n\n'])).toEqual([{ event: null, data: 'uno\ndos' }]);
  });

  it('delivers the last message even if the body ends without a blank line', async () => {
    expect(await run(['data: [DONE]'])).toEqual([{ event: null, data: '[DONE]' }]);
  });
});

describe('Anthropic y DeepSeek (Messages)', () => {
  const stream = () => [
    frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 25, output_tokens: 1 } } }),
    frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pienso' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    frame('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hola ' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'mundo' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 1 }),
    frame('content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu_1', name: 'Studio', input: {} } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":"sel' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'ect","args":{"path":"/a"}}' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 2 }),
    frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('emite texto, pensamiento, la llamada a la herramienta con los argumentos juntos, el uso y done', async () => {
    const f = fakeFetch(respond(stream()));
    const events = await collect(
      backendFor('anthropic', 'sk-ant', f.impl).stream(req([{ role: 'user', content: 'hola' }]), ac().signal),
    );
    expect(events).toEqual([
      { kind: 'thinking', text: 'pienso' },
      { kind: 'text', text: 'Hola ' },
      { kind: 'text', text: 'mundo' },
      { kind: 'tool_call', id: 'tu_1', name: 'Studio', args: { command: 'select', args: { path: '/a' } } },
      { kind: 'usage', input: 25, output: 42 },
      { kind: 'done', opaque: [{ type: 'thinking', thinking: 'pienso', signature: 'SIG' }] },
    ]);
  });

  it('pide a api.anthropic.com con la clave y la cabecera de acceso desde el navegador', async () => {
    const f = fakeFetch(respond(stream()));
    await collect(
      backendFor('anthropic', 'sk-ant', f.impl).stream(
        req([{ role: 'user', content: 'hola' }], { reasoning: { thinking: { type: 'adaptive' } } }),
        ac().signal,
      ),
    );
    const c = f.calls[0];
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    const h = c.init.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-ant');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(c.json).toMatchObject({
      model: 'm',
      system: 'SYS',
      stream: true,
      tools: TOOLS,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: 'hola' }],
    });
    expect(c.json.max_tokens).toBeGreaterThan(0);
  });

  it('DeepSeek usa su endpoint compatible con Anthropic', async () => {
    const f = fakeFetch(respond(stream()));
    await collect(backendFor('deepseek', 'sk-ds', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal));
    expect(f.calls[0].url).toBe('https://api.deepseek.com/anthropic/v1/messages');
  });

  it('the history: the signed thinking goes before the text and the tool, and the results are grouped', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        text: 'voy',
        toolCalls: [
          { id: 'a', name: 'Studio', args: { command: 'x' } },
          { id: 'b', name: 'Studio', args: { command: 'y' } },
        ],
        opaque: [{ type: 'thinking', thinking: 'p', signature: 'S' }],
      },
      { role: 'tool', id: 'a', content: '{"ok":1}' },
      { role: 'tool', id: 'b', content: 'img', image: 'data:image/png;base64,QUJD' },
    ];
    await collect(backendFor('anthropic', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'p', signature: 'S' },
          { type: 'text', text: 'voy' },
          { type: 'tool_use', id: 'a', name: 'Studio', input: { command: 'x' } },
          { type: 'tool_use', id: 'b', name: 'Studio', input: { command: 'y' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'a', content: '{"ok":1}' },
          {
            type: 'tool_result',
            tool_use_id: 'b',
            content: [
              { type: 'text', text: 'img' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
            ],
          },
        ],
      },
    ]);
  });

  it('a user message with images sends them as blocks, before the text', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [{ role: 'user', content: 'mira', images: ['data:image/jpeg;base64,QUJD'] }];
    await collect(backendFor('anthropic', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
          { type: 'text', text: 'mira' },
        ],
      },
    ]);
  });

  it('an image without text does not send an empty text block (the provider rejects it)', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [{ role: 'user', content: '', images: ['data:image/png;base64,QUJD'] }];
    await collect(backendFor('anthropic', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.messages).toEqual([
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }] },
    ]);
  });

  it('un evento error dentro del stream es un ProviderError con su mensaje', async () => {
    const f = fakeFetch(respond([frame('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })]));
    await expect(
      collect(backendFor('anthropic', 'k', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal)),
    ).rejects.toMatchObject({ name: 'ProviderError', message: 'Overloaded' });
  });
});

describe('OpenAI (Responses)', () => {
  const reasoningItem = {
    type: 'reasoning',
    id: 'rs_1',
    summary: [{ type: 'summary_text', text: 'razono' }],
    encrypted_content: 'ENC',
    status: 'completed',
  };
  const stream = () => [
    frame('response.reasoning_summary_text.delta', { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', summary_index: 0, delta: 'razono' }),
    frame('response.output_item.done', { type: 'response.output_item.done', item: reasoningItem }),
    frame('response.output_text.delta', { type: 'response.output_text.delta', delta: 'Voy' }),
    frame('response.output_item.done', { type: 'response.output_item.done', item: { type: 'message', id: 'm1' } }),
    frame('response.output_item.done', {
      type: 'response.output_item.done',
      item: { type: 'function_call', call_id: 'c1', name: 'Studio', arguments: '{"command":"fit"}' },
    }),
    frame('response.completed', {
      type: 'response.completed',
      response: { usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 } } },
    }),
  ];

  it('emite pensamiento, texto, la llamada, el uso con lo cacheado dentro (ocupa contexto), y el razonamiento cifrado en done.opaque', async () => {
    const f = fakeFetch(respond(stream()));
    const events = await collect(backendFor('openai', 'sk-o', f.impl).stream(req([{ role: 'user', content: 'hola' }]), ac().signal));
    expect(events).toEqual([
      { kind: 'thinking', text: 'razono' },
      { kind: 'text', text: 'Voy' },
      { kind: 'tool_call', id: 'c1', name: 'Studio', args: { command: 'fit' } },
      { kind: 'usage', input: 100, output: 20 },
      { kind: 'done', opaque: [reasoningItem] },
    ]);
  });

  it('pide a /v1/responses sin guardar nada en OpenAI y con las herramientas planas', async () => {
    const f = fakeFetch(respond(stream()));
    await collect(
      backendFor('openai', 'sk-o', f.impl).stream(
        req([{ role: 'user', content: 'hola' }], {
          reasoning: { reasoning: { summary: 'auto' }, include: ['reasoning.encrypted_content'] },
        }),
        ac().signal,
      ),
    );
    const c = f.calls[0];
    expect(c.url).toBe('https://api.openai.com/v1/responses');
    expect((c.init.headers as Record<string, string>).authorization ?? (c.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-o');
    expect(c.json).toMatchObject({
      model: 'm',
      instructions: 'SYS',
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { summary: 'auto' },
      input: [{ role: 'user', content: 'hola' }],
      tools: [{ type: 'function', name: 'Studio', description: 'd', parameters: { type: 'object', properties: {} }, strict: false }],
    });
  });

  it('in the next round it resends the reasoning before the call and the result as function_call_output', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', text: 'Voy', toolCalls: [{ id: 'c1', name: 'Studio', args: { command: 'fit' } }], opaque: [reasoningItem] },
      { role: 'tool', id: 'c1', content: '{"ok":true}' },
    ];
    await collect(backendFor('openai', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.input).toEqual([
      { role: 'user', content: 'q' },
      { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'razono' }], encrypted_content: 'ENC' },
      { role: 'assistant', content: 'Voy' },
      { type: 'function_call', call_id: 'c1', name: 'Studio', arguments: '{"command":"fit"}' },
      { type: 'function_call_output', call_id: 'c1', output: '{"ok":true}' },
    ]);
  });

  it('a reasoning with nothing after it is not resent (OpenAI would reject it)', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', text: '', toolCalls: [], opaque: [reasoningItem] },
      { role: 'user', content: 'otra' },
    ];
    await collect(backendFor('openai', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.input).toEqual([
      { role: 'user', content: 'q' },
      { role: 'user', content: 'otra' },
    ]);
  });

  it('response.failed is a ProviderError with the message and the code', async () => {
    const f = fakeFetch(
      respond([frame('response.failed', { type: 'response.failed', response: { error: { message: 'Too fast', code: 'rate_limit_exceeded' } } })]),
    );
    await expect(
      collect(backendFor('openai', 'k', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal)),
    ).rejects.toMatchObject({ name: 'ProviderError', status: 429 });
  });
});

describe('DeepSeek por OpenAI (Chat Completions)', () => {
  const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) =>
    frame(null, { choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) });
  const stream = () => [
    chunk({ reasoning_content: 'pienso' }),
    chunk({ content: 'Hola' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Studio', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"fit"}' } }] }),
    chunk({}, 'tool_calls'),
    frame(null, { choices: [], usage: { prompt_tokens: 50, completion_tokens: 9 } }),
    frame(null, '[DONE]'),
  ];

  it('joins the arguments spread over several deltas into a single call', async () => {
    const f = fakeFetch(respond(stream()));
    const events = await collect(backendFor('deepseek_openai', 'sk-ds', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal));
    expect(events).toEqual([
      { kind: 'thinking', text: 'pienso' },
      { kind: 'text', text: 'Hola' },
      { kind: 'tool_call', id: 'call_1', name: 'Studio', args: { command: 'fit' } },
      { kind: 'usage', input: 50, output: 9 },
      { kind: 'done' },
    ]);
  });

  it('pide a /v1/chat/completions con el uso en el stream y extra_body aplanado', async () => {
    const f = fakeFetch(respond(stream()));
    await collect(
      backendFor('deepseek_openai', 'sk-ds', f.impl).stream(
        req([{ role: 'user', content: 'x' }], { reasoning: { extra_body: { thinking: { type: 'disabled' } } } }),
        ac().signal,
      ),
    );
    const c = f.calls[0];
    expect(c.url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(c.json).toMatchObject({
      model: 'm',
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'x' },
      ],
      tools: [{ type: 'function', function: { name: 'Studio', description: 'd', parameters: { type: 'object', properties: {} } } }],
    });
    expect(c.json.extra_body).toBeUndefined();
  });

  it('el historial usa tool_calls y mensajes role tool', async () => {
    const f = fakeFetch(respond(stream()));
    const history: Msg[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c', name: 'Studio', args: { command: 'fit' } }] },
      { role: 'tool', id: 'c', content: 'hecho' },
    ];
    await collect(backendFor('deepseek_openai', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.messages.slice(1)).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'Studio', arguments: '{"command":"fit"}' } }] },
      { role: 'tool', tool_call_id: 'c', content: 'hecho' },
    ]);
  });
});

describe('errors and cancellation', () => {
  it('un 401 con cuerpo JSON del proveedor es un ProviderError con su estado y su mensaje', async () => {
    const f = fakeFetch(respond([JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })], 401));
    const p = collect(backendFor('anthropic', 'mala', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal));
    await expect(p).rejects.toBeInstanceOf(ProviderError);
    await expect(
      collect(
        backendFor('anthropic', 'mala', fakeFetch(respond([JSON.stringify({ error: { message: 'invalid x-api-key' } })], 401)).impl).stream(
          req([{ role: 'user', content: 'x' }]),
          ac().signal,
        ),
      ),
    ).rejects.toMatchObject({ status: 401, message: 'invalid x-api-key' });
  });

  it('un error que no es JSON se muestra con el estado HTTP', async () => {
    const f = fakeFetch(respond(['<html>bad gateway</html>'], 502));
    await expect(
      collect(backendFor('openai', 'k', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal)),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining('502') });
  });

  it('un fallo de red sale como ProviderError legible, no como TypeError suelto', async () => {
    const impl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(
      collect(backendFor('anthropic', 'k', impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal)),
    ).rejects.toMatchObject({ name: 'ProviderError', status: 0, message: expect.stringContaining('Failed to fetch') });
  });

  it('abortar a mitad termina el iterador sin done y sin error', async () => {
    const ctl = ac();
    const f = fakeFetch(
      respond(
        [frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } })],
        200,
        true,
      ),
    );
    const seen: BackendEvent[] = [];
    for await (const e of backendFor('anthropic', 'k', f.impl).stream(req([{ role: 'user', content: 'x' }]), ctl.signal)) {
      seen.push(e);
      ctl.abort();
    }
    expect(seen).toEqual([{ kind: 'text', text: 'a' }]);
  });
});

describe('review: foreign reasoning, output limits and provider silence', () => {
  const textStream = (stopReason: string, extra: string[] = []) => [
    frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 1 } } }),
    ...extra,
    frame('content_block_start', { type: 'content_block_start', index: 5, content_block: { type: 'text', text: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 5, delta: { type: 'text_delta', text: 'x' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 5 }),
    frame('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 2 } }),
    frame('message_stop', { type: 'message_stop' }),
  ];

  it('of what is opaque from another provider, Anthropic only resends thinking blocks', async () => {
    const f = fakeFetch(respond(textStream('end_turn')));
    const history: Msg[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        text: 'a',
        toolCalls: [],
        opaque: [{ type: 'reasoning', id: 'rs', encrypted_content: 'E' }, { type: 'thinking', thinking: 'p', signature: 'S' }],
      },
      { role: 'user', content: 'otra' },
    ];
    await collect(backendFor('anthropic', 'k', f.impl).stream(req(history), ac().signal));
    expect(f.calls[0].json.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'p', signature: 'S' },
      { type: 'text', text: 'a' },
    ]);
  });

  const unsigned = [
    frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pienso' } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
  ];

  it('DeepSeek devuelve su pensamiento aunque no traiga firma; Anthropic lo descarta', async () => {
    const ds = await collect(
      backendFor('deepseek', 'k', fakeFetch(respond(textStream('end_turn', unsigned))).impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal),
    );
    expect(ds.at(-1)).toEqual({ kind: 'done', opaque: [{ type: 'thinking', thinking: 'pienso', signature: '' }] });
    const an = await collect(
      backendFor('anthropic', 'k', fakeFetch(respond(textStream('end_turn', unsigned))).impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal),
    );
    expect(an.at(-1)).toEqual({ kind: 'done' });
  });

  it('Anthropic marks as cut the answer that stopped because of max_tokens', async () => {
    const events = await collect(
      backendFor('anthropic', 'k', fakeFetch(respond(textStream('max_tokens'))).impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal),
    );
    expect(events.at(-1)).toEqual({ kind: 'done', truncated: true });
  });

  it('Responses marks response.incomplete because of max_output_tokens as cut', async () => {
    const chunks = [
      frame('response.output_text.delta', { type: 'response.output_text.delta', delta: 'x' }),
      frame('response.incomplete', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 5, output_tokens: 7 } } }),
    ];
    const events = await collect(backendFor('openai', 'k', fakeFetch(respond(chunks)).impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal));
    expect(events.at(-1)).toEqual({ kind: 'done', truncated: true });
  });

  it('Chat Completions marca como cortada finish_reason length', async () => {
    const chunks = [
      frame(null as never, { choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] }),
      frame(null as never, { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }),
      frame(null as never, '[DONE]'),
    ];
    const events = await collect(backendFor('deepseek_openai', 'k', fakeFetch(respond(chunks)).impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal));
    expect(events.at(-1)).toEqual({ kind: 'done', truncated: true });
  });

  it('un error dentro de un stream Chat Completions con estado 200 es un ProviderError', async () => {
    const f = fakeFetch(respond([frame(null as never, { error: { message: 'Insufficient Balance' } })]));
    await expect(
      collect(backendFor('deepseek_openai', 'k', f.impl).stream(req([{ role: 'user', content: 'x' }]), ac().signal)),
    ).rejects.toMatchObject({ name: 'ProviderError', message: 'Insufficient Balance' });
  });

  it('un proveedor que se queda callado tras empezar el stream da un error legible en vez de colgarse', async () => {
    const hang = respond([frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 1 } } })], 200, true);
    const p = collect(sseCall(fakeFetch(hang).impl, 'https://x.test', {}, {}, ac().signal, 60) as never);
    await expect(p).rejects.toMatchObject({ name: 'ProviderError', status: 0, message: expect.stringMatching(/stopped responding/i) });
  });

  it('a provider that never answers the request also gives the error', async () => {
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    await expect(collect(sseCall(never, 'https://x.test', {}, {}, ac().signal, 60) as never)).rejects.toMatchObject({
      name: 'ProviderError',
      message: expect.stringMatching(/not responding|stopped responding/i),
    });
  });

  it('abortar antes del tiempo no es un error', async () => {
    const ctl = ac();
    const hang = respond([], 200, true);
    const p = collect(sseCall(fakeFetch(hang).impl, 'https://x.test', {}, {}, ctl.signal, 5000) as never);
    setTimeout(() => ctl.abort(), 20);
    await expect(p).resolves.toEqual([]);
  });
});
