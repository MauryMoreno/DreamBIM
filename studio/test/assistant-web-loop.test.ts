import { describe, expect, it, vi } from 'vitest';
import { runTurn, type Decision, type TurnDeps } from '../src/assistant/web/agent/loop';
import { ProviderError, type Backend, type BackendEvent, type BackendRequest, type Msg } from '../src/assistant/web/agent/backends/types';
import type { StudioExecutor, StudioOutcome } from '../src/assistant/studio/executor';

type Round = BackendEvent[] | { throw: Error };

function scripted(...rounds: Round[]) {
  const requests: BackendRequest[] = [];
  const backend: Backend = {
    async *stream(req) {
      requests.push({ ...req, messages: [...req.messages] });
      const r = rounds.shift();
      if (!r) throw new Error('sin más rondas guionizadas');
      if ('throw' in r) throw r.throw;
      yield* r;
    },
  };
  return { backend, requests };
}

const text = (t: string): BackendEvent => ({ kind: 'text', text: t });
const call = (id: string, command: string, args: unknown = {}): BackendEvent => ({
  kind: 'tool_call',
  id,
  name: 'Studio',
  args: { command, args },
});
const done: BackendEvent = { kind: 'done' };

function fakeExecutor(outcome: (cmd: string, args: unknown) => StudioOutcome | Promise<StudioOutcome> = () => ({ ok: true, result: { ok: 1 } })) {
  const run = vi.fn(async (cmd: string, args: unknown) => outcome(cmd, args));
  const preview = vi.fn(
    async (): Promise<{ ok: true; summary: unknown | null } | { ok: false; error: string }> => ({ ok: true, summary: null }),
  );
  return { executor: { run, preview } as unknown as StudioExecutor, run, preview };
}

function setup(rounds: Round[], over: Partial<TurnDeps> = {}) {
  const s = scripted(...rounds);
  const ex = fakeExecutor();
  const events: [string, any][] = [];
  const ctl = new AbortController();
  const deps: TurnDeps = {
    backend: s.backend,
    model: 'claude-haiku-5-5',
    dialect: 'anthropic',
    history: [],
    text: 'hola',
    executor: ex.executor,
    emit: (e, p) => void events.push([e, p]),
    confirm: vi.fn(async (): Promise<Decision> => 'once'),
    prefs: { planMode: false, autoApprove: false, instructions: '', thinkingMode: 'on', effort: null },
    signal: ctl.signal,
    ...over,
  };
  return { ...s, ...ex, events, ctl, deps };
}

const names = (events: [string, any][]) => events.map((e) => e[0]);
const toolEvents = (events: [string, any][]) => events.filter((e) => e[0] === 'tool').map((e) => e[1]);

describe('bucle de turno del agente web', () => {
  it('una respuesta de solo texto emite start, delta, usage y end, en ese orden', async () => {
    const t = setup([[text('Hola '), text('mundo'), { kind: 'usage', input: 1000, output: 20 }, done]]);
    const r = await runTurn('t1', t.deps);
    expect(names(t.events)).toEqual(['start', 'delta', 'delta', 'usage', 'end']);
    expect(t.events[1][1]).toEqual({ id: 't1', text: 'Hola ' });
    expect(t.events[3][1]).toMatchObject({ id: 't1', used: 1000, source: 'api', last_turn: null, cache_breaks: 0 });
    expect(t.events[3][1].window).toBeGreaterThan(1000);
    expect(r.history).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', text: 'Hola mundo', toolCalls: [] },
    ]);
  });

  it('el pensamiento sale como evento thinking', async () => {
    const t = setup([[{ kind: 'thinking', text: 'mmm' }, text('x'), done]]);
    await runTurn('t1', t.deps);
    expect(t.events).toContainEqual(['thinking', { id: 't1', text: 'mmm' }]);
  });

  it('una llamada libre se ejecuta sin preguntar y su resultado vuelve al modelo en la segunda ronda', async () => {
    const t = setup([[text('Miro. '), call('c1', 'select', { path: '/a' }), done], [text('Hecho'), done]]);
    await runTurn('t1', t.deps);
    expect(t.run).toHaveBeenCalledWith('select', { path: '/a' });
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(toolEvents(t.events)).toEqual([
      { id: 't1', server: 'builtin', tool: 'Studio', tool_use_id: 'c1', phase: 'input', args: { command: 'select', args: { path: '/a' } } },
      { id: 't1', server: 'builtin', tool: 'Studio', tool_use_id: 'c1', phase: 'output', result: { ok: 1 } },
    ]);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].messages.slice(-2)).toEqual([
      { role: 'assistant', text: 'Miro. ', toolCalls: [{ id: 'c1', name: 'Studio', args: { command: 'select', args: { path: '/a' } } }] },
      { role: 'tool', id: 'c1', content: '{"ok":1}' },
    ]);
  });

  it('what is opaque in a round (reasoning) travels with its assistant message to the next round', async () => {
    const t = setup([[call('c1', 'fit'), { kind: 'done', opaque: ['R'] }], [text('ok'), done]]);
    await runTurn('t1', t.deps);
    expect(t.requests[1].messages[1]).toMatchObject({ role: 'assistant', opaque: ['R'] });
  });

  it('un comando de escritura pregunta y, si se deniega, no se ejecuta y el modelo lo sabe', async () => {
    const confirm = vi.fn(async (): Promise<Decision> => 'deny');
    const t = setup([[call('c1', 'set_color', { paths: ['/a'] }), done], [text('No se pudo'), done]], { confirm });
    await runTurn('t1', t.deps);
    expect(confirm).toHaveBeenCalledWith('c1', { command: 'set_color', args: { paths: ['/a'] } });
    expect(t.run).not.toHaveBeenCalled();
    expect(toolEvents(t.events).map((e) => e.phase)).toEqual(['input', 'confirm', 'error']);
    expect(toolEvents(t.events)[2].error).toEqual({ message: 'Action denied by user', type: 'PermissionDenied' });
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', id: 'c1', content: expect.stringContaining('[denied]') });
  });

  it('aprobar una vez ejecuta; «siempre» no vuelve a preguntar ese comando', async () => {
    const answers: Decision[] = ['always'];
    const confirm = vi.fn(async (): Promise<Decision> => answers.shift() ?? 'deny');
    const t = setup([[call('c1', 'set_color'), done], [call('c2', 'set_color'), done], [text('fin'), done]], { confirm });
    await runTurn('t1', t.deps);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(t.run).toHaveBeenCalledTimes(2);
  });

  it('auto-approval skips the question', async () => {
    const t = setup([[call('c1', 'assign_material'), done], [text('fin'), done]]);
    t.deps.prefs.autoApprove = true;
    await runTurn('t1', t.deps);
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(t.run).toHaveBeenCalledWith('assign_material', {});
    expect(toolEvents(t.events).map((e) => e.phase)).toEqual(['input', 'output']);
  });

  it('an executor error comes out as phase error with its text and the turn goes on', async () => {
    const t = setup([[call('c1', 'select'), done], [text('Explico el error'), done]]);
    t.run.mockResolvedValueOnce({ ok: false, error: 'No model is open' });
    await runTurn('t1', t.deps);
    expect(toolEvents(t.events)[1]).toMatchObject({ phase: 'error', error: { message: 'No model is open', type: 'StudioError' } });
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', id: 'c1', content: 'No model is open' });
    expect(names(t.events).at(-1)).toBe('end');
  });

  it('si el ejecutor lanza, el modelo lee el motivo y el turno sigue', async () => {
    const t = setup([[call('c1', 'select'), done], [text('ok'), done]]);
    t.run.mockRejectedValueOnce(new Error('boom'));
    await runTurn('t1', t.deps);
    expect(toolEvents(t.events)[1]).toMatchObject({ phase: 'error', error: { message: 'boom' } });
  });

  it('en modo plan los comandos de escritura no se ejecutan ni preguntan', async () => {
    const t = setup([[call('c1', 'set_color'), done], [text('Este sería el plan'), done]]);
    t.deps.prefs.planMode = true;
    await runTurn('t1', t.deps);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(t.requests[1].messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'Plan mode is on: describe the change instead of making it.',
    });
    expect(t.requests[0].system).toContain('PLAN MODE');
  });

  it('a tool that is not Studio returns an error to the model', async () => {
    const t = setup([[{ kind: 'tool_call', id: 'c1', name: 'Bash', args: {} }, done], [text('vale'), done]]);
    await runTurn('t1', t.deps);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', id: 'c1', content: expect.stringContaining("Unknown tool 'Bash'") });
  });

  it('a capture goes as an image only if the model sees images; the event carries the size, not the image', async () => {
    const shot = { ok: true as const, result: { image: 'data:image/png;base64,QUJD', width: 10, height: 5 } };
    const ve = setup([[call('c1', 'screenshot'), done], [text('vista'), done]]);
    ve.run.mockResolvedValueOnce(shot);
    await runTurn('t1', ve.deps);
    expect(ve.requests[1].messages.at(-1)).toEqual({
      role: 'tool',
      id: 'c1',
      content: '{"width":10,"height":5}',
      image: 'data:image/png;base64,QUJD',
    });
    expect(toolEvents(ve.events)[1].result).toEqual({ width: 10, height: 5, image: '[image 10x5]' });

    const ciego = setup([[call('c1', 'screenshot'), done], [text('no la veo'), done]], { model: 'gpt-6-sol', dialect: 'openai' });
    ciego.run.mockResolvedValueOnce(shot);
    await runTurn('t1', ciego.deps);
    const last = ciego.requests[1].messages.at(-1) as Extract<Msg, { role: 'tool' }>;
    expect(last.image).toBeUndefined();
    expect(last.content).toContain('This model cannot see images');
  });

  it('a provider error comes out as error and then end, with a coherent history', async () => {
    const t = setup([[call('c1', 'fit'), done], { throw: new ProviderError(401, 'invalid x-api-key') }]);
    const r = await runTurn('t1', t.deps);
    expect(names(t.events).slice(-2)).toEqual(['error', 'end']);
    expect(t.events.at(-2)![1]).toEqual({ id: 't1', message: 'invalid x-api-key' });
    // la llamada ya ejecutada se recuerda, y el turno cortado termina en el asistente (nunca en un resultado suelto)
    expect(r.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect((r.saved as any).incomplete).toBe(true);
  });

  it('un error de la primera ronda deja solo el mensaje del usuario en el historial', async () => {
    const t = setup([{ throw: new ProviderError(429, 'rate limited') }]);
    const r = await runTurn('t1', t.deps);
    // without an answer there is nothing to remember: the loose message does not stay in the history (two user ones in a row are not valid)
    expect(r.history).toEqual([]);
    expect(names(t.events)).toEqual(['start', 'error', 'end']);
  });

  it('aborting while waiting for the confirmation ends with end and runs nothing', async () => {
    const confirm = vi.fn(() => new Promise<Decision>(() => {}));
    const t = setup([[call('c1', 'set_color'), done]], { confirm });
    const p = runTurn('t1', t.deps);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    t.ctl.abort();
    const r = await p;
    expect(t.run).not.toHaveBeenCalled();
    expect(names(t.events).at(-1)).toBe('end');
    expect(names(t.events)).not.toContain('error');
    expect((r.saved as any).incomplete).toBe(true);
    expect(r.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(r.history[2]).toMatchObject({ role: 'tool', id: 'c1', content: expect.stringContaining('[cancelled]') });
  });

  it('stopping at the card of the second call does not forget the first one, which was already executed', async () => {
    const confirm = vi.fn(() => new Promise<Decision>(() => {}));
    const t = setup([[call('c1', 'select', { path: '/a' }), call('c2', 'set_color'), done]], { confirm });
    const p = runTurn('t1', t.deps);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    t.ctl.abort();
    const r = await p;
    expect(t.run).toHaveBeenCalledTimes(1);
    expect(r.history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    expect((r.history[1] as any).toolCalls.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(r.history[2]).toMatchObject({ id: 'c1', content: '{"ok":1}' });
    expect(r.history[3]).toMatchObject({ id: 'c2', content: expect.stringContaining('[cancelled]') });
  });

  it('el historial de un turno cortado nunca termina en un mensaje del usuario ni en un resultado suelto', async () => {
    const t = setup([[call('c1', 'fit'), done], { throw: new ProviderError(500, 'caído') }]);
    const r = await runTurn('t1', t.deps);
    expect(r.history.at(-1)!.role).toBe('assistant');
    const again = setup([[text('ok'), done]], { history: r.history, text: 'otra' });
    await runTurn('t2', again.deps);
    const roles = again.requests[0].messages.map((m) => m.role);
    for (let i = 1; i < roles.length; i++) expect(roles[i] === 'user' && roles[i - 1] === 'user').toBe(false);
  });

  it('there is no cap on rounds: it keeps calling tools until the model finishes', async () => {
    const rounds: Round[] = Array.from({ length: 40 }, (_, i) => [call(`c${i}`, 'fit'), done]);
    const t = setup([...rounds, [text('Listo.'), done]]);
    const r = await runTurn('t1', t.deps);
    expect(t.requests).toHaveLength(41);
    expect(t.events.filter((e) => e[0] === 'delta').map((e) => e[1].text).join('')).not.toMatch(/stopped after/i);
    expect(r.history.at(-1)).toMatchObject({ role: 'assistant', text: 'Listo.' });
  });

  it('an answer cut by the output limit continues on its own where it stopped', async () => {
    const t = setup([[text('Mitad de la fra'), { kind: 'done', truncated: true }], [text('se.'), done]]);
    const r = await runTurn('t1', t.deps);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].messages.slice(-2)).toMatchObject([
      { role: 'assistant', text: 'Mitad de la fra' },
      { role: 'user', content: expect.stringContaining('Continue from exactly where you stopped') },
    ]);
    const deltas = t.events.filter((e) => e[0] === 'delta').map((e) => e[1].text).join('');
    expect(deltas).toBe('Mitad de la frase.');
    expect((r.saved as any).content).toBe('Mitad de la frase.');
    expect((r.saved as any).incomplete).toBeUndefined();
    expect(r.history.at(-1)).toMatchObject({ role: 'assistant', text: 'se.' });
  });

  it('it continues as many times as needed as long as each cut writes something', async () => {
    const cuts: Round[] = Array.from({ length: 6 }, (_, i): Round => [text(`p${i} `), { kind: 'done', truncated: true }]);
    const t = setup([...cuts, [text('fin'), done]]);
    const r = await runTurn('t1', t.deps);
    expect(t.requests).toHaveLength(7);
    expect((r.saved as any).content).toBe('p0 p1 p2 p3 p4 p5 fin');
  });

  it('a continuation that adds nothing ends the turn without leaving the request to continue in the history', async () => {
    const t = setup([[text('Todo dicho.'), { kind: 'done', truncated: true }], [done]]);
    const r = await runTurn('t1', t.deps);
    expect((r.saved as any).content).toBe('Todo dicho.');
    expect(r.history.at(-1)).toMatchObject({ role: 'assistant', text: 'Todo dicho.' });
  });

  it('un corte razonando, sin texto, se reintenta una vez con el razonamiento al minimo', async () => {
    const mute: Round = [{ kind: 'thinking', text: 'pienso' }, { kind: 'done', truncated: true }];
    const t = setup([mute, [text('Ahora si.'), done]], { model: 'claude-sonnet-5-5' });
    const r = await runTurn('t1', t.deps);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[0].reasoning).toMatchObject({ output_config: { effort: 'high' } });
    expect(t.requests[1].reasoning).toMatchObject({ output_config: { effort: 'low' } });
    // lo ya razonado vuelve en la peticion del reintento, y no se queda en el historial
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('pienso') });
    expect(r.history.some((m) => m.role === 'user' && m.content.includes('reasoning_so_far'))).toBe(false);
    expect((r.saved as any).content).toBe('Ahora si.');
  });

  it('si ni asi escribe nada, lo avisa en vez de terminar en silencio', async () => {
    const mute: Round = [{ kind: 'thinking', text: 'pienso' }, { kind: 'done', truncated: true }];
    const t = setup([mute, mute]);
    const r = await runTurn('t1', t.deps);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1].reasoning).toMatchObject({ thinking: { type: 'disabled' } });
    expect((r.saved as any).content).toMatch(/wrote nothing/i);
    expect(r.history.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('parar durante una continuacion conserva lo ya escrito y no deja dos mensajes de usuario seguidos', async () => {
    const ctl = new AbortController();
    let n = 0;
    const backend: Backend = {
      async *stream() {
        if (n++ === 0) {
          yield text('Primera parte ');
          yield { kind: 'done', truncated: true };
        } else {
          yield text('y algo');
          ctl.abort();
        }
      },
    };
    const t = setup([], { backend, signal: ctl.signal });
    const r = await runTurn('t1', t.deps);
    expect((r.saved as any).content).toBe('Primera parte y algo');
    expect((r.saved as any).incomplete).toBe(true);
    expect(r.history.at(-1)!.role).toBe('assistant');
  });

  it('an empty answer is reported instead of ending in silence', async () => {
    const t = setup([[{ kind: 'thinking', text: 'pienso' }, { kind: 'done' }]]);
    const r = await runTurn('t1', t.deps);
    const deltas = t.events.filter((e) => e[0] === 'delta').map((e) => e[1].text).join('');
    expect(deltas).toMatch(/empty answer/i);
    expect(r.history.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('abortar durante el streaming conserva el texto ya recibido', async () => {
    const ctl = new AbortController();
    const backend: Backend = {
      async *stream() {
        yield text('Parcial');
        ctl.abort();
      },
    };
    const t = setup([], { backend, signal: ctl.signal });
    const r = await runTurn('t1', t.deps);
    expect(names(t.events).at(-1)).toBe('end');
    expect((r.saved as any).content).toBe('Parcial');
    expect((r.saved as any).incomplete).toBe(true);
  });

  it('el mensaje guardado tiene la forma de AI_Manage: texto unido, herramientas y orden de partes', async () => {
    const t = setup([[text('Miro.'), call('c1', 'select', { path: '/a' }), done], [text('Listo.'), done]]);
    const r = await runTurn('t1', t.deps);
    expect(r.saved).toEqual({
      role: 'assistant',
      content: 'Miro.\n\nListo.',
      tools: [
        { server: 'builtin', tool: 'Studio', args: { command: 'select', args: { path: '/a' } }, result: { ok: 1 }, error: null },
      ],
      parts_order: [
        { type: 'text', content: 'Miro.' },
        { type: 'tool', tool_use_id: 'c1' },
        { type: 'text', content: 'Listo.' },
      ],
    });
  });

  it('a huge history is trimmed from the beginning, starting at a user message and keeping the last turn', async () => {
    const big = 'x'.repeat(10_000);
    const history: Msg[] = [];
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `${i}${big}` });
      history.push({ role: 'assistant', text: big, toolCalls: [{ id: `c${i}`, name: 'Studio', args: {} }] });
      history.push({ role: 'tool', id: `c${i}`, content: big });
    }
    const t = setup([[text('ok'), done]], { history });
    await runTurn('t1', t.deps);
    const sent = t.requests[0].messages;
    expect(sent[0].role).toBe('user');
    expect(sent.length).toBeLessThan(history.length);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'hola' });
    const size = JSON.stringify(sent).length;
    expect(size).toBeLessThanOrEqual(110_000);
  });

  it('a capture does not count by its bytes: the previous conversation stays in the request', async () => {
    const history: Msg[] = [
      { role: 'user', content: 'primera pregunta' },
      { role: 'assistant', text: '', toolCalls: [{ id: 'c0', name: 'Studio', args: { command: 'screenshot' } }] },
      { role: 'tool', id: 'c0', content: '{"width":1024,"height":768}', image: `data:image/png;base64,${'A'.repeat(400_000)}` },
      { role: 'assistant', text: 'la vista', toolCalls: [] },
    ];
    const t = setup([[text('ok'), done]], { history });
    await runTurn('t1', t.deps);
    expect(t.requests[0].messages).toHaveLength(5);
    expect(t.requests[0].messages[0]).toEqual({ role: 'user', content: 'primera pregunta' });
  });

  it('turning off auto-approval in the middle of the turn asks again on the next write', async () => {
    const t = setup([[call('c1', 'set_color'), done], [call('c2', 'set_color'), done], [text('listo'), done]]);
    let auto = true;
    t.deps.prefs = { ...t.deps.prefs, get autoApprove() { return auto; } };
    t.run.mockImplementationOnce(async () => {
      auto = false;
      return { ok: true, result: {} };
    });
    await runTurn('t1', t.deps);
    expect(t.deps.confirm).toHaveBeenCalledTimes(1);
    expect((t.deps.confirm as any).mock.calls[0][0]).toBe('c2');
  });

  it('a command Studio does not have does not ask for confirmation: the model receives the error', async () => {
    const t = setup([[call('c1', ''), call('c2', 'borra_todo'), done], [text('vale'), done]], { commands: new Set(['help', 'set_color']) });
    await runTurn('t1', t.deps);
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(t.run).not.toHaveBeenCalled();
    expect(toolEvents(t.events).some((e) => e.phase === 'confirm')).toBe(false);
    const results = t.requests[1].messages.filter((m) => m.role === 'tool') as Extract<Msg, { role: 'tool' }>[];
    expect(results.map((r) => r.content)).toEqual([
      "Unknown command ''. Run 'help' to list commands.",
      "Unknown command 'borra_todo'. Run 'help' to list commands.",
    ]);
  });

  it('en modo plan un comando inexistente dice que no existe, no que el modo plan lo bloquea', async () => {
    const t = setup([[call('c1', 'borra_todo'), done], [text('vale'), done]], { commands: new Set(['help']) });
    t.deps.prefs.planMode = true;
    await runTurn('t1', t.deps);
    expect(toolEvents(t.events).at(-1).error).toMatchObject({ type: 'StudioError', message: expect.stringContaining('Unknown command') });
  });

  it('si el proveedor falla a media respuesta, el texto ya mostrado queda guardado y en el historial', async () => {
    const backend: Backend = {
      async *stream() {
        yield text('Empiezo a ');
        yield text('contestar');
        throw new ProviderError(529, 'overloaded');
      },
    };
    const t = setup([], { backend });
    const r = await runTurn('t1', t.deps);
    expect(names(t.events).slice(-2)).toEqual(['error', 'end']);
    expect(r.saved).toMatchObject({ content: 'Empiezo a contestar', incomplete: true });
    expect(r.saved.parts_order).toEqual([{ type: 'text', content: 'Empiezo a contestar' }]);
    expect(r.history).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', text: 'Empiezo a contestar', toolCalls: [] },
    ]);
  });

  it('un turno corto no recorta nada', async () => {
    const history: Msg[] = [{ role: 'user', content: 'a' }, { role: 'assistant', text: 'b', toolCalls: [] }];
    const t = setup([[text('ok'), done]], { history });
    await runTurn('t1', t.deps);
    expect(t.requests[0].messages).toHaveLength(3);
  });

  it('passes to the request the Studio tool, the prompt with the instructions and the reasoning parameters', async () => {
    const t = setup([[text('x'), done]]);
    t.deps.prefs.instructions = 'Responde en español.';
    t.deps.prefs.effort = 'high';
    await runTurn('t1', t.deps);
    const req = t.requests[0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect((req.tools as any[])[0].name).toBe('Studio');
    expect(req.system).toContain('Responde en español.');
    expect(req.reasoning).toEqual({ thinking: { type: 'adaptive', display: 'summarized' }, output_config: { effort: 'high' } });
  });

  it('an invalid write goes back to the model without asking for confirmation', async () => {
    const t = setup([[call('c1', 'build_model', { levels: [] }), done], [text('Lo corrijo'), done]]);
    t.preview.mockResolvedValueOnce({ ok: false, error: 'build_model: bad' });
    await runTurn('t1', t.deps);
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(toolEvents(t.events).some((e) => e.phase === 'confirm')).toBe(false);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', id: 'c1', content: 'build_model: bad' });
  });

  it('the confirmation card carries the summary and not the arguments', async () => {
    const args = { levels: [{ name: 'L1', elevation: 0, layout: 'a' }], layouts: { a: {} } };
    const t = setup([[call('c1', 'build_model', args), done], [text('Listo'), done]]);
    t.preview.mockResolvedValueOnce({ ok: true, summary: { totals: { walls: 8 } } });
    await runTurn('t1', t.deps);
    const input = toolEvents(t.events).find((e) => e.phase === 'input');
    const confirm = toolEvents(t.events).find((e) => e.phase === 'confirm');
    expect(input.args).toEqual({ command: 'build_model', args });
    expect(confirm.args).toEqual({ command: 'build_model', args: { totals: { walls: 8 } } });
    expect(t.deps.confirm).toHaveBeenCalledWith('c1', { command: 'build_model', args: { totals: { walls: 8 } } });
    expect(t.run).toHaveBeenCalledWith('build_model', args);
  });

  it('without a summary, the card carries the arguments as before', async () => {
    const args = { paths: ['/a'], color: '#ff0000' };
    const t = setup([[call('c1', 'set_color', args), done], [text('ok'), done]]);
    await runTurn('t1', t.deps);
    expect(toolEvents(t.events).find((e) => e.phase === 'confirm').args).toEqual({ command: 'set_color', args });
  });

  it('with auto-approval it also validates before running', async () => {
    const t = setup([[call('c1', 'build_model', { levels: [] }), done], [text('Lo corrijo'), done]]);
    t.deps.prefs.autoApprove = true;
    t.preview.mockResolvedValueOnce({ ok: false, error: 'build_model: bad' });
    await runTurn('t1', t.deps);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'build_model: bad' });
  });

  it('denying does not run and approving runs once with the complete arguments', async () => {
    const args = { paths: ['/a'] };
    const deny = setup([[call('c1', 'set_color', args), done], [text('vale'), done]], {
      confirm: vi.fn(async (): Promise<Decision> => 'deny'),
    });
    await runTurn('t1', deny.deps);
    expect(deny.run).not.toHaveBeenCalled();

    const once = setup([[call('c1', 'set_color', args), done], [text('vale'), done]], {
      confirm: vi.fn(async (): Promise<Decision> => 'once'),
    });
    await runTurn('t1', once.deps);
    expect(once.run).toHaveBeenCalledTimes(1);
    expect(once.run).toHaveBeenCalledWith('set_color', args);
  });

  it('un comando libre no pasa por preview', async () => {
    const t = setup([[call('c1', 'model_info'), done], [text('ok'), done]]);
    await runTurn('t1', t.deps);
    expect(t.preview).not.toHaveBeenCalled();
  });

  it('attached images travel in the user message and stay in the history', async () => {
    const images = ['data:image/png;base64,QUJD'];
    const t = setup([[text('la veo'), done]], { images });
    const r = await runTurn('t1', t.deps);
    expect(t.requests[0].messages.at(-1)).toEqual({ role: 'user', content: 'hola', images });
    expect(r.history[0]).toEqual({ role: 'user', content: 'hola', images });
  });

  it('an attached image does not count by its bytes: the previous conversation stays in the request', async () => {
    const history: Msg[] = [
      { role: 'user', content: 'mira el plano', images: [`data:image/png;base64,${'A'.repeat(400_000)}`] },
      { role: 'assistant', text: 'lo veo', toolCalls: [] },
    ];
    const t = setup([[text('ok'), done]], { history });
    await runTurn('t1', t.deps);
    expect(t.requests[0].messages).toHaveLength(3);
    expect(t.requests[0].messages[0]).toMatchObject({ role: 'user', content: 'mira el plano' });
  });
});

describe('compuerta y resultado de la skill', () => {
  it('a storage that throws an error breaks nothing: default values and nothing saved', async () => {
    const gate = vi.fn((command: string) => (command === 'build_model' ? 'review first' : null));
    const t = setup([[call('c1', 'build_model', { levels: [] }), done], [text('vale'), done]], { gate });
    await runTurn('t1', t.deps);
    expect(t.run).not.toHaveBeenCalled();
    expect(t.deps.confirm).not.toHaveBeenCalled();
    expect(toolEvents(t.events).some((e) => e.phase === 'confirm')).toBe(false);
    expect(toolEvents(t.events).at(-1)).toMatchObject({ phase: 'error', error: { type: 'SkillGate', message: 'review first' } });
    expect(t.requests[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'review first' });
  });

  it('onResult se llama con el resultado de un comando correcto y no con uno fallido', async () => {
    const onResult = vi.fn(() => null);
    const t = setup([[call('c1', 'select', { path: '/a' }), call('c2', 'select'), done], [text('fin'), done]], { onResult });
    t.run.mockResolvedValueOnce({ ok: true, result: { a: 1 } });
    t.run.mockResolvedValueOnce({ ok: false, error: 'boom' });
    await runTurn('t1', t.deps);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith('select', { path: '/a' }, { a: 1 });
  });

  it('corrupt JSON counts as empty', async () => {
    const onResult = vi.fn(() => '[skill] run review_model');
    const t = setup([[call('c1', 'select', { path: '/a' }), done], [text('ok'), done]], { onResult });
    await runTurn('t1', t.deps);
    expect((t.requests[1].messages.at(-1) as { content: string }).content).toBe('{"ok":1}\n[skill] run review_model');
  });

  it('sin compuerta todo funciona como hoy', async () => {
    const t = setup([[call('c1', 'build_model', { levels: [] }), done], [text('ok'), done]]);
    await runTurn('t1', t.deps);
    expect(t.run).toHaveBeenCalledWith('build_model', { levels: [] });
  });
});