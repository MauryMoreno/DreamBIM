import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../src/assistant/web/bus';
import { createWebBridge } from '../src/assistant/web/bridge';
import { memoryConversations } from '../src/assistant/web/conversations';
import { stableKey } from '../src/modeling/planreview';
import type { StudioExecutor } from '../src/assistant/studio/executor';

const enc = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function sse(chunks: string[], hang = false): Response {
  let i = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i < chunks.length) return void c.enqueue(enc.encode(chunks[i++]));
      if (!hang) return void c.close();
      return new Promise<void>((resolve) => {
        const t = setInterval(() => cancelled && (clearInterval(t), resolve()), 5);
      });
    },
    cancel() {
      cancelled = true;
    },
  });
  return { ok: true, status: 200, body: stream, text: async () => '' } as unknown as Response;
}

/** Una respuesta de Anthropic con texto, y opcionalmente una llamada a Studio. */
function answer(textOut: string, tool?: { id: string; command: string; args?: unknown }, hang = false): Response {
  const chunks = [
    frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }),
    frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: textOut } }),
    frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
  ];
  if (tool) {
    chunks.push(
      frame('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: tool.id, name: 'Studio', input: {} } }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: tool.command, args: tool.args ?? {} }) },
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 1 }),
    );
  }
  if (!hang) {
    chunks.push(
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } }),
      frame('message_stop', { type: 'message_stop' }),
    );
  }
  return sse(chunks, hang);
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function setup(responses: Response[] = [], storage: Storage = memoryStorage()) {
  const bus = createBus();
  const store = memoryConversations();
  const log: [string, any][] = [];
  const run = vi.fn(async (cmd: string, args: any) => {
    if (cmd === 'review_plan') {
      return {
        ok: true,
        result: {
          ok: true,
          checks: [],
          exits: 1,
          levels: [],
          stairs: [],
          build_key: stableKey(args.build),
        },
      };
    }
    if (cmd === 'review_model') return { ok: true, result: { ok: true, checks: [], exits: 1, levels: [] } };
    if (cmd === 'build_model') return { ok: true, result: { new: true } };
    return { ok: true, result: { done: true } };
  });
  const queue = [...responses];
  const requests: any[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const r = queue.shift();
    if (!r) throw new Error('sin más respuestas');
    return r;
  }) as unknown as typeof fetch;
  // `help` is requested by the bridge to know which commands exist; `run` counts only the commands of the model
  const executor = {
    run: async (cmd: string, args: unknown) =>
      cmd === 'help'
        ? {
            ok: true as const,
            result: {
              commands: ['help', 'fit', 'select', 'set_color', 'review_plan', 'review_model', 'build_model', 'place_in_wall'].map(
                (name) => ({ name }),
              ),
            },
          }
        : (run as unknown as (c: string, a: unknown) => Promise<unknown>)(cmd, args),
    preview: async () => ({ ok: true as const, summary: null }),
  } as unknown as StudioExecutor;
  const bridge = createWebBridge({ bus, store, executor, storage, fetchImpl });
  for (const ev of ['studio://turn-start', 'studio://turn-end', 'chat://start', 'chat://delta', 'chat://tool', 'chat://thinking', 'chat://usage', 'chat://error', 'chat://end']) {
    void bus.listen(ev, (e) => void log.push([e.event, e.payload]));
  }
  const conv = (payload: Record<string, unknown>) => bridge.invoke('conv_request', { payload }) as Promise<any>;
  const chat = (text: string, id = 'r1') => bridge.invoke('chat_stream', { payload: { type: 'chat', text, id } });
  const withKey = async (provider = 'anthropic') => {
    await conv({ type: 'settings_save', provider, api_key: 'sk-test' });
  };
  return { bridge, bus, store, log, run, conv, chat, withKey, requests, storage, fetchImpl };
}

const names = (log: [string, any][]) => log.map((l) => l[0]);

describe('puente web del Asistente', () => {
  it('a turn emits turn-start, start, delta, usage, end and turn-end, and the conversation is saved', async () => {
    const t = setup([answer('Hola')]);
    await t.withKey();
    await t.chat('hola');
    expect(names(t.log)).toEqual(['studio://turn-start', 'chat://start', 'chat://delta', 'chat://usage', 'chat://end', 'studio://turn-end']);
    expect(t.log[2][1]).toEqual({ id: 'r1', text: 'Hola' });
    const list = await t.conv({ type: 'conv_list' });
    expect(list.event).toBe('conversations');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ title: 'hola', turns: 1 });
    expect(list.current).toBe(list.items[0].id);
  });

  it('the saved conversation can be opened with conv_load as BuiltBot expects it', async () => {
    const t = setup([answer('Hola')]);
    await t.withKey();
    await t.chat('hola');
    const { items } = await t.conv({ type: 'conv_list' });
    const loaded = await t.conv({ type: 'conv_load', id_conv: items[0].id });
    expect(loaded).toMatchObject({ event: 'conversation', conv_id: items[0].id, title: 'hola' });
    expect(loaded.messages).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola', parts_order: [{ type: 'text', content: 'Hola' }] },
    ]);
  });

  it('el mensaje guardado se guarda solo al terminar el turno: mientras corre no hay nada a medias', async () => {
    const t = setup([answer('Parcial', undefined, true)]);
    await t.withKey();
    const p = t.chat('hola');
    await vi.waitFor(() => expect(names(t.log)).toContain('chat://delta'));
    expect(await t.store.list()).toEqual([]);
    await t.bridge.invoke('cancel_stream', { payload: { type: 'cancel', id: 'r1' } });
    await p;
    expect(names(t.log).slice(-2)).toEqual(['chat://end', 'studio://turn-end']);
    const { items } = await t.conv({ type: 'conv_list' });
    const loaded = await t.conv({ type: 'conv_load', id_conv: items[0].id });
    expect(loaded.messages).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Parcial', parts_order: [{ type: 'text', content: 'Parcial' }], incomplete: true },
    ]);
  });

  it('sin clave para el proveedor activo: error con el aviso, luego end y turn-end', async () => {
    const t = setup();
    await t.chat('hola');
    expect(names(t.log)).toEqual(['studio://turn-start', 'chat://error', 'chat://end', 'studio://turn-end']);
    expect(t.log[1][1]).toEqual({ id: 'r1', message: 'Add your API key in Settings to start.' });
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(await t.store.list()).toEqual([]);
  });

  it('a write command shows the confirmation card and runs when approved', async () => {
    const t = setup([answer('Coloreo', { id: 'tu1', command: 'set_color', args: { paths: ['/a'] } }), answer('Hecho')]);
    await t.withKey();
    const p = t.chat('pinta de rojo');
    await vi.waitFor(() => expect(t.log.some((l) => l[0] === 'chat://tool' && l[1].phase === 'confirm')).toBe(true));
    expect(t.run).not.toHaveBeenCalled();
    await t.bridge.invoke('tool_confirm', { payload: { type: 'tool_confirm', tool_use_id: 'tu1', decision: 'once' } });
    await p;
    expect(t.run).toHaveBeenCalledWith('set_color', { paths: ['/a'] });
    expect(t.log.filter((l) => l[0] === 'chat://tool').map((l) => l[1].phase)).toEqual(['input', 'confirm', 'output']);
  });

  it('denegar la tarjeta no ejecuta el comando', async () => {
    const t = setup([answer('Coloreo', { id: 'tu1', command: 'set_color' }), answer('Vale')]);
    await t.withKey();
    const p = t.chat('pinta');
    await vi.waitFor(() => expect(t.log.some((l) => l[1]?.phase === 'confirm')).toBe(true));
    await t.bridge.invoke('tool_confirm', { payload: { type: 'tool_confirm', tool_use_id: 'tu1', decision: 'deny' } });
    await p;
    expect(t.run).not.toHaveBeenCalled();
  });

  it('un comando libre se ejecuta sin tarjeta', async () => {
    const t = setup([answer('Miro', { id: 'tu1', command: 'select', args: { path: '/a' } }), answer('Listo')]);
    await t.withKey();
    await t.chat('selecciona');
    expect(t.run).toHaveBeenCalledWith('select', { path: '/a' });
    expect(t.log.some((l) => l[1]?.phase === 'confirm')).toBe(false);
  });

  it('the second turn of the same conversation remembers the first', async () => {
    const t = setup([answer('Uno'), answer('Dos')]);
    await t.withKey();
    await t.chat('a', 'r1');
    await t.chat('b', 'r2');
    expect(t.requests[1].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    const { items } = await t.conv({ type: 'conv_list' });
    expect(items).toHaveLength(1);
    expect(items[0].turns).toBe(2);
  });

  it('conv_new starts a separate conversation without remembering the previous one', async () => {
    const t = setup([answer('Uno'), answer('Dos')]);
    await t.withKey();
    await t.chat('a', 'r1');
    const fresh = await t.conv({ type: 'conv_new' });
    expect(fresh).toMatchObject({ event: 'conversation', title: '', messages: [] });
    await t.chat('b', 'r2');
    expect(t.requests[1].messages).toHaveLength(1);
    expect((await t.conv({ type: 'conv_list' })).items).toHaveLength(2);
  });

  it('conv_delete removes the conversation and returns the list; opening one that does not exist gives an error', async () => {
    const t = setup([answer('Uno')]);
    await t.withKey();
    await t.chat('a');
    const { items } = await t.conv({ type: 'conv_list' });
    const after = await t.conv({ type: 'conv_delete', id_conv: items[0].id });
    expect(after).toMatchObject({ event: 'conversations', items: [], current: null });
    await expect(t.conv({ type: 'conv_load', id_conv: 'nope' })).rejects.toThrow("Conversation 'nope' does not exist");
  });

  it('settings_get sin nada pide configurar; guardar la primera clave activa ese proveedor', async () => {
    const t = setup();
    expect(await t.conv({ type: 'settings_get' })).toEqual({
      event: 'user_settings',
      provider: 'deepseek',
      model: 'deepseek-flash',
      keys: { deepseek: false, anthropic: false, openai: false },
      needs_setup: true,
    });
    const saved = await t.conv({ type: 'settings_save', provider: 'anthropic', api_key: ' sk-ant ' });
    expect(saved).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', keys: { anthropic: true }, needs_setup: false });
    // una segunda clave no mueve el proveedor activo
    const second = await t.conv({ type: 'settings_save', provider: 'openai', api_key: 'sk-o' });
    expect(second).toMatchObject({ provider: 'anthropic', keys: { anthropic: true, openai: true } });
  });

  it('removing the key of the active provider moves to the next one that has a key', async () => {
    const t = setup();
    await t.conv({ type: 'settings_save', provider: 'anthropic', api_key: 'a' });
    await t.conv({ type: 'settings_save', provider: 'openai', api_key: 'o' });
    const r = await t.conv({ type: 'settings_remove_key', provider: 'anthropic' });
    expect(r).toMatchObject({ provider: 'openai', keys: { anthropic: false, openai: true } });
  });

  it('a key with spaces or empty is rejected with the message', async () => {
    const t = setup();
    await expect(t.conv({ type: 'settings_save', provider: 'openai', api_key: 'sk a b' })).rejects.toThrow(/contains spaces/);
    await expect(t.conv({ type: 'settings_save', provider: 'openai', api_key: '  ' })).rejects.toThrow('API key is empty');
    await expect(t.conv({ type: 'settings_save', provider: 'nadie', api_key: 'k' })).rejects.toThrow(/unknown provider/);
  });

  it('la clave y las preferencias sobreviven a recrear el puente con el mismo almacenamiento', async () => {
    const storage = memoryStorage();
    const first = setup([], storage);
    await first.conv({ type: 'settings_save', provider: 'anthropic', api_key: 'sk-ant' });
    await first.conv({ type: 'set_plan_mode', enabled: true });
    const second = setup([], storage);
    expect((await second.conv({ type: 'settings_get' })).keys.anthropic).toBe(true);
    expect(await second.conv({ type: 'get_plan_mode' })).toEqual({ event: 'plan_mode', enabled: true });
  });

  it('without storage everything works during the session', async () => {
    const hostile = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
    const t = setup([answer('Hola')], hostile);
    await t.withKey();
    await t.chat('hola');
    expect(names(t.log)).toContain('chat://end');
    expect((await t.conv({ type: 'conv_list' })).items).toHaveLength(1);
  });

  it('model and provider: list of models of the provider and validation', async () => {
    const t = setup();
    expect(await t.conv({ type: 'get_model' })).toEqual({
      event: 'model',
      model: 'deepseek-flash',
      presets: ['deepseek-flash', 'deepseek-v4-pro'],
    });
    expect(await t.conv({ type: 'set_model_provider', provider: 'openai' })).toEqual({ event: 'model_provider', provider: 'openai' });
    expect((await t.conv({ type: 'get_model' })).presets).toEqual(['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol']);
    expect(await t.conv({ type: 'set_model', model: 'gpt-6-astra' })).toMatchObject({ event: 'model', model: 'gpt-6-astra' });
    await expect(t.conv({ type: 'set_model', model: 'inventado' })).rejects.toThrow(/Unsupported model/);
    await expect(t.conv({ type: 'set_model_provider', provider: 'qwen' })).rejects.toThrow(/Unsupported provider/);
  });

  it('razonamiento: estado por modelo, interruptor y esfuerzo validado', async () => {
    const t = setup();
    await t.conv({ type: 'set_model_provider', provider: 'anthropic' });
    expect(await t.conv({ type: 'get_thinking_mode' })).toEqual({
      event: 'thinking_mode',
      mode: 'on',
      can_disable: true,
      always_on: false,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      effort: 'medium',
    });
    expect(await t.conv({ type: 'set_thinking_mode', mode: 'off' })).toMatchObject({ mode: 'off' });
    expect(await t.conv({ type: 'set_effort', effort: 'HIGH' })).toMatchObject({ effort: 'high' });
    await expect(t.conv({ type: 'set_effort', effort: 'minimal' })).rejects.toThrow(/Unsupported effort/);
    await t.conv({ type: 'set_model', model: 'claude-opus-5-5' });
    expect(await t.conv({ type: 'get_thinking_mode' })).toMatchObject({ mode: 'on', can_disable: false, always_on: true });
  });

  it('auto-approval: when turned on, the cards that are waiting are approved', async () => {
    const t = setup([answer('Coloreo', { id: 'tu1', command: 'set_color' }), answer('Hecho')]);
    await t.withKey();
    const p = t.chat('pinta');
    await vi.waitFor(() => expect(t.log.some((l) => l[1]?.phase === 'confirm')).toBe(true));
    expect(await t.conv({ type: 'set_auto_approve', enabled: true })).toEqual({ event: 'auto_approve', enabled: true });
    await p;
    expect(t.run).toHaveBeenCalled();
  });

  it('auto-approval: turning it off in the middle of the turn makes the next write ask', async () => {
    const t = setup([
      answer('Uno', { id: 'tu1', command: 'set_color' }),
      answer('Dos', { id: 'tu2', command: 'set_color' }),
      answer('Hecho'),
    ]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    t.run.mockImplementationOnce(async () => {
      await t.conv({ type: 'set_auto_approve', enabled: false });
      return { ok: true as const, result: { done: true } };
    });
    const p = t.chat('pinta dos veces');
    await vi.waitFor(() => expect(t.log.some((l) => l[1]?.phase === 'confirm' && l[1]?.tool_use_id === 'tu2')).toBe(true));
    expect(t.log.some((l) => l[1]?.phase === 'confirm' && l[1]?.tool_use_id === 'tu1')).toBe(false);
    await t.bridge.invoke('tool_confirm', { payload: { tool_use_id: 'tu2', decision: 'deny' } });
    await p;
    expect(t.run).toHaveBeenCalledTimes(1);
  });

  it('instrucciones: se guardan y se leen', async () => {
    const t = setup();
    expect(await t.conv({ type: 'save_instructions', text: 'Responde en español.' })).toMatchObject({ event: 'instructions', text: 'Responde en español.' });
    expect(await t.conv({ type: 'get_instructions' })).toMatchObject({ text: 'Responde en español.' });
  });

  it('doctor informa de la clave y de Studio', async () => {
    const t = setup();
    const sin = await t.conv({ type: 'doctor' });
    expect(sin.checks[0]).toMatchObject({ name: 'LLM', ok: false });
    expect(sin.checks[0].detail).toContain('missing API key');
    await t.withKey();
    expect((await t.conv({ type: 'doctor' })).checks[0]).toMatchObject({ name: 'LLM', ok: true });
  });

  it('what does not exist on the web answers empty instead of failing', async () => {
    const t = setup();
    for (const type of ['commands_list', 'speckle_state', 'get_workspace', 'set_workspace', 'clear_workspace', 'model_cards', 'task_list', 'subagent_stop']) {
      expect(await t.conv({ type }), type).toBeNull();
    }
  });

  it('the rest of the Tauri commands: bridge status, restart, questions and graphs', async () => {
    const t = setup();
    expect(await t.bridge.invoke('bridge_status')).toEqual({ running: true, error: null, log: '' });
    await expect(t.bridge.invoke('restart_bridge')).resolves.toBeUndefined();
    await expect(t.bridge.invoke('ask_answer', { payload: { type: 'ask_answer', ask_id: 'x', answer: 'y' } })).resolves.toBeUndefined();
    await expect(t.bridge.invoke('graph_request', { payload: {} })).rejects.toThrow('Graphs are not available in the web demo');
    await t.bridge.invoke('send_request', { payload: { id: 'p1', type: 'ping' } });
    expect(t.log).toContainEqual(['chat://end', { id: 'p1' }]);
    await expect(t.bridge.invoke('comando_que_no_existe')).rejects.toThrow(/Unknown command/);
  });

  it('cancelar sin id no hace nada', async () => {
    const t = setup();
    await expect(t.bridge.invoke('cancel_stream', { payload: { type: 'cancel', id: '' } })).resolves.toBeUndefined();
  });

  it('switching provider in the middle of a conversation leaves the history as text only', async () => {
    const t = setup([answer('Miro', { id: 'tu1', command: 'select' }), answer('Listo'), answer('Otra')]);
    await t.withKey('anthropic');
    await t.conv({ type: 'settings_save', provider: 'deepseek', api_key: 'sk-ds' });
    await t.chat('a', 'r1');
    expect(t.requests[1].messages.some((m: any) => JSON.stringify(m).includes('tool_use'))).toBe(true);
    await t.conv({ type: 'set_model_provider', provider: 'deepseek' });
    await t.chat('b', 'r2');
    const sent = t.requests[2].messages;
    expect(JSON.stringify(sent)).not.toContain('tool_use');
    expect(sent.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(t.requests[2].model).toBe('deepseek-flash');
  });

  it('without storage, the newly saved key is still there after the restart BuiltBot always asks for', async () => {
    const hostile = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
    const t = setup([answer('Hola')], hostile);
    await t.conv({ type: 'settings_save', provider: 'anthropic', api_key: 'sk-ant' });
    await t.bridge.invoke('restart_bridge');
    expect((await t.conv({ type: 'settings_get' })).keys.anthropic).toBe(true);
    await t.chat('hola');
    expect(names(t.log)).not.toContain('chat://error');
    expect(t.requests).toHaveLength(1);
  });

  it('a turn that fails in the first round does not leave two user messages in a row in the next one', async () => {
    const fail = { ok: false, status: 401, body: null, text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }) } as unknown as Response;
    const t = setup([fail, answer('Ya')]);
    await t.withKey();
    await t.chat('primera', 'r1');
    expect(t.log.some((l) => l[0] === 'chat://error' && l[1].message === 'invalid x-api-key')).toBe(true);
    await t.chat('segunda', 'r2');
    expect(t.requests[1].messages).toEqual([{ role: 'user', content: 'segunda' }]);
  });

  it('opening a conversation whose last turn failed also does not leave two user messages in a row', async () => {
    const fail = { ok: false, status: 429, body: null, text: async () => JSON.stringify({ error: { message: 'slow down' } }) } as unknown as Response;
    const t = setup([fail, answer('Ya')]);
    await t.withKey();
    await t.chat('primera', 'r1');
    const { items } = await t.conv({ type: 'conv_list' });
    await t.conv({ type: 'conv_load', id_conv: items[0].id });
    await t.chat('segunda', 'r2');
    expect(t.requests[1].messages).toEqual([{ role: 'user', content: 'segunda' }]);
  });

  it('removing the key of the active provider, which moves to another, leaves the history as text only', async () => {
    const t = setup([answer('Miro', { id: 'tu1', command: 'select' }), answer('Listo'), answer('Otra')]);
    await t.conv({ type: 'settings_save', provider: 'anthropic', api_key: 'sk-ant' });
    await t.conv({ type: 'settings_save', provider: 'deepseek', api_key: 'sk-ds' });
    await t.chat('a', 'r1');
    const r = await t.conv({ type: 'settings_remove_key', provider: 'anthropic' });
    expect(r.provider).toBe('deepseek');
    await t.chat('b', 'r2');
    expect(JSON.stringify(t.requests[2].messages)).not.toContain('tool_use');
    expect(t.requests[2].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('attached images in the web bridge', () => {
  const shot = { data: 'QUJD', mediaType: 'image/png', name: 'plano.png' };
  const block = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } };
  const send = (t: ReturnType<typeof setup>, text: string, images: unknown[], id = 'r1') =>
    t.bridge.invoke('chat_stream', { payload: { type: 'chat', text, id, images } });

  it('an attached image reaches the model as an image block next to the text', async () => {
    const t = setup([answer('La veo')]);
    await t.withKey();
    await send(t, 'qué es esto', [shot]);
    expect(t.requests[0].messages).toEqual([{ role: 'user', content: [block, { type: 'text', text: 'qué es esto' }] }]);
  });

  it('an image without text also opens the turn', async () => {
    const t = setup([answer('La veo')]);
    await t.withKey();
    await send(t, '', [shot]);
    expect(t.requests[0].messages).toEqual([{ role: 'user', content: [block] }]);
    expect(names(t.log)).toContain('chat://delta');
  });

  it('the next turn of the same conversation still sees the image', async () => {
    const t = setup([answer('La veo'), answer('Sigo viéndola')]);
    await t.withKey();
    await send(t, 'mira', [shot], 'r1');
    await t.chat('y ahora', 'r2');
    expect(t.requests[1].messages[0]).toEqual({ role: 'user', content: [block, { type: 'text', text: 'mira' }] });
  });

  it('the conversation stores the name of the image, not its bytes', async () => {
    const t = setup([answer('La veo')]);
    await t.withKey();
    await send(t, 'mira', [shot]);
    const { items } = await t.conv({ type: 'conv_list' });
    const loaded = await t.conv({ type: 'conv_load', id_conv: items[0].id });
    expect(loaded.messages[0]).toEqual({ role: 'user', content: 'mira', images: [{ name: 'plano.png', mediaType: 'image/png' }] });
    expect(JSON.stringify(loaded.messages)).not.toContain('QUJD');
  });

  it('when reopening the conversation the model knows there was an image even though it no longer sees it', async () => {
    const t = setup([answer('La veo'), answer('Ya no')]);
    await t.withKey();
    await send(t, '', [shot], 'r1');
    const { items } = await t.conv({ type: 'conv_list' });
    await t.conv({ type: 'conv_load', id_conv: items[0].id });
    await t.chat('sigue', 'r2');
    expect(t.requests[1].messages).toEqual([
      { role: 'user', content: '[Attached image: plano.png]' },
      { role: 'assistant', content: [{ type: 'text', text: 'La veo' }] },
      { role: 'user', content: 'sigue' },
    ]);
  });

  it('with a model that does not see images the turn is not sent and the user reads why', async () => {
    const t = setup([answer('nunca')]);
    await t.conv({ type: 'settings_save', provider: 'openai', api_key: 'sk-oa' });
    await send(t, 'mira', [shot]);
    expect(t.requests).toHaveLength(0);
    const error = t.log.find((l) => l[0] === 'chat://error');
    expect(error?.[1].message).toMatch(/cannot see images/);
    expect(names(t.log).slice(-2)).toEqual(['chat://end', 'studio://turn-end']);
    expect((await t.conv({ type: 'conv_list' })).items).toHaveLength(0);
  });

  it('una imagen de un tipo no admitido o sin datos se rechaza con un error', async () => {
    const t = setup([answer('nunca')]);
    await t.withKey();
    await send(t, 'mira', [{ data: 'QUJD', mediaType: 'image/svg+xml', name: 'a.svg' }]);
    expect(t.requests).toHaveLength(0);
    expect(t.log.find((l) => l[0] === 'chat://error')?.[1].message).toMatch(/a\.svg/);
  });
});

describe('skill design-building en el puente web', () => {
  const build = { levels: [{ name: 'L1', elevation: 0, layout: 'a' }], layouts: { a: { walls: [], floors: [] } } };
  const plan = { lot: { width: 14, depth: 12 }, apartments: { L1: 1 }, build, stairs: [] };
  const callPlan = (id = 'plan1') => answer('Reviso.', { id, command: 'review_plan', args: plan });
  const callBuild = (id = 'build1', args: unknown = build) => answer('Construyo.', { id, command: 'build_model', args });
  const activate = (t: ReturnType<typeof setup>) => t.chat('/skills design-building');

  it('skills_list devuelve la skill integrada', async () => {
    const t = setup();
    expect(await t.conv({ type: 'skills_list' })).toMatchObject({
      event: 'skills',
      items: [{ name: 'design-building', scope: 'builtin' }],
    });
  });

  it('un comando de skill desconocido responde sin llamar al modelo', async () => {
    const t = setup();
    await t.chat('/skills nope');
    expect(t.fetchImpl).not.toHaveBeenCalled();
    expect(t.run).not.toHaveBeenCalled();
    const delta = t.log.find((l) => l[0] === 'chat://delta');
    expect(delta?.[1].text).toBe("Unknown skill 'nope'. Available: design-building.");
  });

  it('/skills design-building activa la skill y su texto va en el prompt', async () => {
    const t = setup([answer('Listo')]);
    await t.withKey();
    await activate(t);
    expect(t.requests[0].system).toContain('--- SKILL: DESIGN A BUILDING STEP BY STEP ---');
    expect(t.requests[0].messages.at(-1)).toEqual({ role: 'user', content: 'Start the "design-building" skill now.' });
  });

  it('build_model is blocked until an approved review_plan of the same build and passes afterwards', async () => {
    const t = setup([answer('Listo'), callPlan(), answer('Plan revisado'), callBuild(), answer('Construido')]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await activate(t);
    expect((await t.run.mock.calls).find((c) => c[0] === 'build_model')).toBeUndefined();
    await t.chat('haz el plan');
    expect(t.run).toHaveBeenCalledWith('review_plan', plan);
    const blocked = setup([answer('Listo'), callBuild(), answer('No puedo')]);
    await blocked.withKey();
    await blocked.conv({ type: 'set_auto_approve', enabled: true });
    await activate(blocked);
    await blocked.chat('construye');
    expect(blocked.run).not.toHaveBeenCalledWith('build_model', build);
    const tool = blocked.log.filter((l) => l[0] === 'chat://tool' && l[1].phase === 'error').at(-1);
    expect(tool?.[1].error).toMatchObject({ type: 'SkillGate' });
    await t.chat('construye');
    expect(t.run).toHaveBeenCalledWith('build_model', build);
  });

  it('si el build cambia una coordenada vuelve a bloquearse', async () => {
    const moved = JSON.parse(JSON.stringify(build));
    moved.levels[0].name = 'L1';
    moved.layouts.a.walls = [{ from: [0, 0], to: [4, 0] }];
    const t = setup([answer('Listo'), callPlan(), answer('Plan revisado'), callBuild('b1', moved), answer('No')]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await activate(t);
    await t.chat('haz el plan');
    await t.chat('construye');
    expect(t.run).not.toHaveBeenCalledWith('build_model', moved);
  });

  it('una review_plan fallida posterior borra la aprobaci�n', async () => {
    const t = setup([
      answer('Listo'),
      callPlan(),
      answer('Plan revisado'),
      callPlan('plan2'),
      answer('No pasa'),
      callBuild(),
      answer('No puedo'),
    ]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await activate(t);
    await t.chat('haz el plan');
    t.run.mockResolvedValueOnce({ ok: true, result: { ok: false, checks: [], exits: 0, levels: [], stairs: [], build_key: 'K' } });
    await t.chat('revisa otra vez');
    await t.chat('construye');
    expect(t.run).not.toHaveBeenCalledWith('build_model', build);
  });

  it('/skills off quita la compuerta', async () => {
    const t = setup([answer('Listo'), answer('Apagada'), callBuild(), answer('Construido')]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await activate(t);
    await t.chat('/skills off');
    await t.chat('construye');
    expect(t.run).toHaveBeenCalledWith('build_model', build);
  });

  it('conv_load restaura la skill y la aprobaci�n guardadas', async () => {
    const t = setup([answer('Listo'), callPlan(), answer('Plan revisado'), callBuild(), answer('Construido')]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await activate(t);
    await t.chat('haz el plan');
    const { items } = await t.conv({ type: 'conv_list' });
    await t.conv({ type: 'conv_new' });
    await t.conv({ type: 'conv_load', id_conv: items[0].id });
    await t.chat('construye');
    expect(t.run).toHaveBeenCalledWith('build_model', build);
    expect(t.requests.at(-2).system).toContain('--- SKILL: DESIGN A BUILDING STEP BY STEP ---');
  });

  it('sin skill, build_model corre sin revisi�n', async () => {
    const t = setup([callBuild(), answer('Construido')]);
    await t.withKey();
    await t.conv({ type: 'set_auto_approve', enabled: true });
    await t.chat('construye');
    expect(t.run).toHaveBeenCalledWith('build_model', build);
  });
});