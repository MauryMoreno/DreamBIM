// Bucle de turno del agente web: habla con el proveedor, ejecuta la herramienta Studio sobre el modelo abierto y
// emits the same events as the desktop agent (chatbot-revit/AI_Manage/src/bridge/stdio/chat_handlers.py and
// services/agent_service_claude.py), so that BuiltBot paints them the same way.
import type { StudioExecutor } from '../../studio/executor';
import type { Backend, BackendEvent, Msg } from './backends/types';
import { modelSeesImages, reasoningCaps, reasoningParams, type Dialect } from './catalog';
import { FREE_COMMANDS, STUDIO_TOOL, systemPrompt } from './prompt';

export type Decision = 'deny' | 'once' | 'always';

export interface TurnDeps {
  backend: Backend;
  model: string;
  dialect: Dialect;
  /** What has already been said in this conversation, without the new message. */
  history: Msg[];
  text: string;
  /** Images the user attached to this message, as a data URL. The caller already checked that the model sees them. */
  images?: string[];
  executor: StudioExecutor;
  /** Emite un evento `chat://<evento>`; el nombre va sin el prefijo. */
  emit(event: string, payload: Record<string, unknown>): void;
  /** Waits for the user's decision on a write command (the Approve/Deny/Always card). */
  confirm(toolUseId: string, args: unknown): Promise<Decision>;
  prefs: { planMode: boolean; autoApprove: boolean; instructions: string; thinkingMode: string; effort: string | null };
  signal: AbortSignal;
  /** Commands approved with "Always"; the caller keeps it so that it is valid for the whole session. */
  alwaysApproved?: Set<string>;
  /** The commands Studio has (those of `help`). With them, a nonexistent one fails before asking for confirmation. */
  commands?: ReadonlySet<string>;
  /** Reason why a command cannot run now (it is returned to the model as a 'SkillGate' error), or null. */
  gate?(command: string, args: unknown): string | null;
  /** Called after each command that finished well; if it returns text, it is added to the result the model reads. */
  onResult?(command: string, args: unknown, result: unknown): string | null | void;
  /** Texto de la skill activa, para el prompt. */
  skill?: string;
}

export interface TurnResult {
  /** El historial neutro para el siguiente turno: siempre coherente (toda llamada con su resultado). */
  history: Msg[];
  /** The assistant message in the shape AI_Manage stores, for `conv_load`. */
  saved: SavedAssistantMessage;
}

export interface SavedAssistantMessage {
  role: 'assistant';
  content: string;
  tools?: { server: string; tool: string; args: unknown; result: unknown; error: { message: string; type: string } | null }[];
  parts_order?: ({ type: 'text'; content: string } | { type: 'tool'; tool_use_id: string })[];
  incomplete?: true;
}

/** Context window shown on the meter: without data per model, a prudent value. */
const CONTEXT_WINDOW = 200_000;
/** Size (characters of the JSON) from which the history that is sent is trimmed. */
const HISTORY_LIMIT = 100_000;
const NO_IMAGE_NOTE = 'This model cannot see images; the screenshot was not sent.';
const TRUNCATED_NOTICE = '[The answer was cut off by the output limit. Ask me to continue.]';
const MUTE_NOTICE = '[The model used up its output space reasoning and wrote nothing. Ask again, in smaller parts if you can.]';
/**
 * What the model is told so that it continues an answer the provider cut because of the output limit. The same
 * text as the desktop agent (chatbot-revit/core/builtbot_core/agent_loop.py, CONTINUATION_NUDGE); it goes as
 * mensaje del usuario porque rellenar el turno del asistente no es compatible con el razonamiento.
 */
/**
 * What the model is told when the cut fell entirely in the reasoning: it is given back what it already reasoned so
 * que no lo repita ni se pierda, y se le pide la respuesta.
 */
const REASONING_NUDGE =
  'Your previous attempt hit the output token limit while you were still reasoning, before you wrote anything. ' +
  'Your reasoning so far is below. Do not redo it: build on it and write your answer (or make your tool calls) now.';
const CONTINUATION_NUDGE =
  'Your previous message was cut off because it hit the output token limit. Continue from exactly where you stopped, ' +
  'mid-sentence if that is where the cut landed. Do not repeat anything you already wrote, do not apologise, and do ' +
  'not summarise what you were saying.';
const EMPTY_NOTICE = '[The model returned an empty answer. Try again, or lower the reasoning effort.]';
const CANCELLED_RESULT = '[cancelled] The turn was stopped before this call ran.';
const INTERRUPTED_NOTE = '[This turn was interrupted before it finished.]';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What a capture weighs in the trimming: its approximate cost in context (~1500 tokens), not its bytes in base64. */
const IMAGE_SIZE = 6_000;

/** Size of a message for the trimming. An image (capture or attachment) does not count by its bytes. */
function sizeOf(m: Msg): number {
  if (m.role === 'tool' && m.image) return JSON.stringify({ ...m, image: '' }).length + IMAGE_SIZE;
  if (m.role === 'user' && m.images?.length) {
    return JSON.stringify({ ...m, images: [] }).length + IMAGE_SIZE * m.images.length;
  }
  return JSON.stringify(m).length;
}

/** Trims from the beginning, always at a user message (it never leaves a result without its call). */
function trimHistory(msgs: Msg[]): Msg[] {
  const sizes = msgs.map(sizeOf);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= HISTORY_LIMIT) return msgs;
  let lastUser = msgs.length - 1;
  while (lastUser > 0 && msgs[lastUser].role !== 'user') lastUser--;
  let suffix = total;
  for (let s = 0; s < lastUser; s++) {
    if (msgs[s].role === 'user' && suffix <= HISTORY_LIMIT) return msgs.slice(s);
    suffix -= sizes[s];
  }
  return msgs.slice(lastUser);
}

/** Espera `p`, o devuelve `ABORTED` si `signal` se aborta antes. */
const ABORTED = Symbol('aborted');
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export async function runTurn(id: string, d: TurnDeps): Promise<TurnResult> {
  const history: Msg[] = [...d.history, { role: 'user', content: d.text, ...(d.images?.length ? { images: d.images } : {}) }];
  const always = d.alwaysApproved ?? new Set<string>();
  const system = systemPrompt(d.prefs.instructions, d.prefs.planMode, d.skill);
  let reasoning = reasoningParams(d.model, d.dialect, d.prefs.thinkingMode, d.prefs.effort) ?? {};
  const sees = modelSeesImages(d.model, d.dialect);

  const tools: NonNullable<SavedAssistantMessage['tools']> = [];
  const parts: NonNullable<SavedAssistantMessage['parts_order']> = [];
  const segments: string[] = [];
  let incomplete = false;
  /** The text of the current round that was already shown and is not yet in `segments`. */
  let roundText = '';
  /** The text of the rounds cut by the output limit: already shown and in the history, but not in `segments`. */
  let carried = '';
  /** A round that was cut while reasoning was already retried, with reasoning at the minimum. */
  let lightened = false;
  /** What was reasoned in a round that was cut without writing anything: it goes only in the retry request, not in the history. */
  let recovered: Msg | null = null;

  const emitTool = (toolUseId: string, phase: string, extra: Record<string, unknown>) =>
    d.emit('tool', { id, server: 'builtin', tool: STUDIO_TOOL.name, tool_use_id: toolUseId, phase, ...extra });

  const saved = (): SavedAssistantMessage => {
    const out: SavedAssistantMessage = { role: 'assistant', content: segments.join('\n\n') };
    if (tools.length) out.tools = tools;
    if (parts.length) out.parts_order = parts;
    if (incomplete) out.incomplete = true;
    return out;
  };

  d.emit('start', { id });
  try {
    // no cap on rounds, like BuiltBot: the turn goes on until the model finishes or the user presses Stop
    for (;;) {
      roundText = '';
      let roundThinking = '';
      const messages = recovered ? [...trimHistory(history), recovered] : trimHistory(history);
      recovered = null;
      const calls: { id: string; name: string; args: unknown }[] = [];
      let opaque: unknown;
      let truncated = false;
      const stream = d.backend.stream(
        { model: d.model, system, messages, tools: [STUDIO_TOOL], reasoning },
        d.signal,
      );
      let finished = false;
      for await (const ev of stream as AsyncIterable<BackendEvent>) {
        if (ev.kind === 'text') {
          roundText += ev.text;
          d.emit('delta', { id, text: ev.text });
        } else if (ev.kind === 'thinking') {
          roundThinking += ev.text;
          d.emit('thinking', { id, text: ev.text });
        }
        else if (ev.kind === 'tool_call') calls.push({ id: ev.id, name: ev.name, args: ev.args });
        else if (ev.kind === 'usage') {
          d.emit('usage', {
            id,
            used: ev.input,
            window: CONTEXT_WINDOW,
            pct: Math.round((ev.input / CONTEXT_WINDOW) * 10000) / 10000,
            source: 'api',
            last_turn: null,
            cache_breaks: 0,
          });
        } else if (ev.kind === 'done') {
          finished = true;
          opaque = ev.opaque;
          truncated = ev.truncated === true;
        }
      }

      const ended = finished && !d.signal.aborted && !calls.length;
      if (ended && truncated && roundText) {
        // cut in mid-answer: it is not an ending. It is asked to continue where it left off, like the desktop agent
        history.push(
          { role: 'assistant', text: roundText, toolCalls: [], ...(opaque !== undefined ? { opaque } : {}) },
          { role: 'user', content: CONTINUATION_NUDGE },
        );
        carried += roundText;
        roundText = '';
        continue;
      }
      if (ended && truncated && !lightened) {
        // it was cut while reasoning, without writing anything: repeating the same request would give the same cut, so it is repeated
        // once with reasoning off (or at the minimum, if the model does not allow turning it off) and, so that what was
        // already reasoned is not lost, it is given back in the request
        lightened = true;
        if (roundThinking.trim()) {
          recovered = {
            role: 'user',
            content: `${REASONING_NUDGE}\n\n<reasoning_so_far>\n${roundThinking.trim()}\n</reasoning_so_far>`,
          };
        }
        const weakest = reasoningCaps(d.model, d.dialect).efforts[0] ?? null;
        reasoning = reasoningParams(d.model, d.dialect, 'off', weakest) ?? {};
        continue;
      }
      if (ended) {
        // a cut that is not saved even so or an empty answer cannot pass in silence
        const written = carried !== '' || roundText !== '';
        const notice = truncated ? (written ? TRUNCATED_NOTICE : MUTE_NOTICE) : written ? '' : EMPTY_NOTICE;
        if (notice) {
          const text = written ? `\n\n${notice}` : notice;
          d.emit('delta', { id, text });
          roundText += text;
        }
      }
      /** What is from this round (what is missing in the history) and everything shown since the last cut (what is saved). */
      const piece = roundText;
      const said = carried + piece;
      roundText = ''; // from here the text of the round is already saved
      carried = '';
      if (said) {
        segments.push(said);
        parts.push({ type: 'text', content: said });
      }
      if (d.signal.aborted || !finished) {
        incomplete = true;
        if (piece) history.push({ role: 'assistant', text: piece, toolCalls: [] });
        break;
      }

      const assistant: Msg = { role: 'assistant', text: piece, toolCalls: calls, ...(opaque !== undefined ? { opaque } : {}) };
      if (!calls.length) {
        // a continuation that adds nothing leaves the history at the request to continue: `settle` removes it
        if (piece) history.push(assistant);
        break;
      }

      // el asistente y sus resultados entran juntos: si se corta a medias, ninguno entra
      // (if it is cut in the middle, what was already executed is remembered and what was not is marked as cancelled)
      const results: Msg[] = [];
      let aborted = false;
      for (const call of calls) {
        if (aborted) {
          results.push({ role: 'tool', id: call.id, content: CANCELLED_RESULT });
          continue;
        }
        const r = await runCall(call);
        if (r === ABORTED) {
          aborted = true;
          incomplete = true;
          results.push({ role: 'tool', id: call.id, content: CANCELLED_RESULT });
        } else results.push(r);
      }
      history.push(assistant, ...results);
      if (aborted) break;
    }
  } catch (e) {
    incomplete = true;
    // the provider failed in mid-answer: what the user already read is not lost
    const shown = carried + roundText;
    if (shown) {
      segments.push(shown);
      parts.push({ type: 'text', content: shown });
    }
    if (roundText) history.push({ role: 'assistant', text: roundText, toolCalls: [] });
    if (!d.signal.aborted) d.emit('error', { id, message: message(e) });
  } finally {
    d.emit('end', { id });
  }
  settle(history);
  return { history, saved: saved() };

  /**
   * Un turno cortado (error, Stop) no puede dejar el historial acabando en un mensaje del usuario ni en un resultado
   * loose: the next user message would stick to it and the providers reject it or repeat the question.
   */
  function settle(h: Msg[]): void {
    const last = h.at(-1);
    if (!last) return;
    if (last.role === 'user') h.pop();
    else if (last.role === 'tool') h.push({ role: 'assistant', text: INTERRUPTED_NOTE, toolCalls: [] });
  }

  /** Runs a tool call; it returns its `tool` for the history, or ABORTED if the turn was cut. */
  async function runCall(call: { id: string; name: string; args: unknown }): Promise<Msg | typeof ABORTED> {
    const input = call.args;
    parts.push({ type: 'tool', tool_use_id: call.id });
    const record: NonNullable<SavedAssistantMessage['tools']>[number] = {
      server: 'builtin',
      tool: call.name,
      args: input,
      result: null,
      error: null,
    };
    tools.push(record);
    emitTool(call.id, 'input', { args: input });

    const fail = (text: string, type: string, content = text): Msg => {
      record.error = { message: text, type };
      emitTool(call.id, 'error', { error: record.error });
      return { role: 'tool', id: call.id, content };
    };

    if (call.name !== STUDIO_TOOL.name) return fail(`Unknown tool '${call.name}'. Only the Studio tool is available.`, 'UnknownTool');

    const args = (typeof input === 'object' && input !== null ? input : {}) as { command?: unknown; args?: unknown };
    const command = String(args.command ?? '');
    const cmdArgs = typeof args.args === 'object' && args.args !== null && !Array.isArray(args.args) ? args.args : {};
    const write = !FREE_COMMANDS.has(command);

    // an empty command (broken or cut arguments) or a nonexistent one is not a write to approve: it is an error
    if (!command || (d.commands && !d.commands.has(command))) {
      return fail(`Unknown command '${command}'. Run 'help' to list commands.`, 'StudioError');
    }
    if (write && d.prefs.planMode) {
      return fail('Plan mode is on: describe the change instead of making it.', 'PlanMode');
    }
    if (write && d.gate) {
      const reason = d.gate(command, cmdArgs);
      if (reason) return fail(reason, 'SkillGate');
    }
    // an invalid write is rejected here, without a card: the correction goes back to the model
    let summary: unknown | null = null;
    if (write) {
      const pre = await d.executor.preview(command, cmdArgs);
      if (!pre.ok) return fail(pre.error, 'StudioError');
      summary = pre.summary;
    }
    const card = summary === null ? input : { command, args: summary };
    if (write && !always.has(command) && !d.prefs.autoApprove) {
      emitTool(call.id, 'confirm', { args: card });
      const decision = await abortable(d.confirm(call.id, card), d.signal);
      if (decision === ABORTED) return ABORTED;
      if (decision === 'always') always.add(command);
      else if (decision !== 'once') {
        return fail('Action denied by user', 'PermissionDenied', '[denied] The user did not authorize this action; it was not executed.');
      }
    }
    if (d.signal.aborted) return ABORTED;

    let outcome;
    try {
      outcome = await d.executor.run(command, cmdArgs);
    } catch (e) {
      outcome = { ok: false as const, error: message(e) };
    }
    if (!outcome.ok) return fail(String(outcome.error || 'Studio failed'), 'StudioError');

    const result = outcome.result;
    const note = d.onResult?.(command, cmdArgs, result);
    let shown = result;
    let content: string;
    let image: string | undefined;
    const img = typeof result === 'object' && result !== null ? (result as Record<string, unknown>).image : undefined;
    if (typeof img === 'string' && img.startsWith('data:image/png;base64,')) {
      const { image: _omit, ...rest } = result as Record<string, unknown>;
      shown = { ...rest, image: `[image ${rest.width}x${rest.height}]` };
      if (sees) {
        content = JSON.stringify(rest);
        image = img;
      } else content = JSON.stringify({ ...rest, note: NO_IMAGE_NOTE });
    } else content = JSON.stringify(result);
    if (typeof note === 'string' && note) content = `${content}\n${note}`;

    record.result = shown;
    emitTool(call.id, 'output', { result: shown });
    return { role: 'tool', id: call.id, content, ...(image ? { image } : {}) };
  }
}
