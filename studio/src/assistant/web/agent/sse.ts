// Parser de Server-Sent Events sobre el cuerpo de un `fetch`.

export interface SseMessage {
  event: string | null;
  data: string;
}

/** The provider stopped sending data for more than `idleMs`. */
export class IdleTimeoutError extends Error {
  constructor() {
    super('stream idle');
    this.name = 'IdleTimeoutError';
  }
}

/** Entrega cada mensaje SSE. Si `signal` se aborta, cancela la lectura y termina sin error. */
export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  idleMs?: number,
): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  if (signal) {
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  }
  const decoder = new TextDecoder();
  let buf = '';
  let event: string | null = null;
  let data: string[] = [];

  const flush = (): SseMessage | null => {
    const message = data.length ? { event, data: data.join('\n') } : null;
    event = null;
    data = [];
    return message;
  };
  const line = (l: string): SseMessage | null => {
    if (l === '') return flush();
    if (l.startsWith(':')) return null;
    const i = l.indexOf(':');
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? '' : l.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    return null;
  };

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readWithin(reader, idleMs, cancel);
      } catch (e) {
        if (signal?.aborted) return;
        throw e;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        const l = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        const m = line(l);
        if (m) yield m;
      }
    }
    buf += decoder.decode();
    if (buf) {
      const m = line(buf.replace(/\r$/, ''));
      if (m) yield m;
    }
    const last = flush();
    if (last) yield last;
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
  }
}

/** `reader.read()` que se rinde con IdleTimeoutError si no llega nada en `idleMs`. */
function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number | undefined,
  cancel: () => void,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!idleMs) return reader.read();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cancel();
      reject(new IdleTimeoutError());
    }, idleMs);
    reader.read().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
