// Common transport: a POST request with JSON that answers over SSE, with the provider errors translated.
import { IdleTimeoutError, parseSse, type SseMessage } from '../sse';
import { ProviderError } from './types';

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** El texto de error de un cuerpo no exitoso: el del proveedor si es JSON, o el estado HTTP. */
async function httpError(res: Response): Promise<ProviderError> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* sin cuerpo */
  }
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const m = typeof j.error === 'string' ? j.error : (j.error?.message ?? j.message);
    if (typeof m === 'string' && m) return new ProviderError(res.status, m);
  } catch {
    /* no es JSON */
  }
  return new ProviderError(res.status, `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
}

/** Tiempo sin recibir nada del proveedor (ni la respuesta ni datos del stream) antes de rendirse. */
export const IDLE_MS = 120_000;
const silentMessage = (idleMs: number): string => `The provider stopped responding (no data for ${Math.round(idleMs / 1000)} s). Try again.`;

export async function* sseCall(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  signal: AbortSignal,
  idleMs: number = IDLE_MS,
): AsyncGenerator<SseMessage> {
  if (signal.aborted) return;
  // an own controller: it aborts with the user's signal or when the provider goes silent
  const ctl = new AbortController();
  const link = () => ctl.abort();
  signal.addEventListener('abort', link, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let res: Response;
  try {
    const silent = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new ProviderError(0, silentMessage(idleMs)));
      }, idleMs);
    });
    silent.catch(() => {});
    res = await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      }),
      silent,
    ]);
  } catch (e) {
    if (signal.aborted) return;
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(0, `Network error: ${reason(e)}`);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', link);
  }
  if (!res.ok) throw await httpError(res);
  if (!res.body) throw new ProviderError(res.status, 'The provider sent no response body');
  try {
    yield* parseSse(res.body, signal, idleMs);
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (signal.aborted) return;
    if (e instanceof IdleTimeoutError) throw new ProviderError(0, silentMessage(idleMs));
    throw new ProviderError(0, `Network error: ${reason(e)}`);
  }
}

/** Permissive JSON for the arguments of a tool: empty or broken gives `{}` and the executor will say so. */
export function parseArgs(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
