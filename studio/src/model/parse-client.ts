// Cliente del worker de parseo de capas enlazadas (ver parse.worker.ts).
import type { IfcxFile } from '../ifcx/types';
import { handleParse, type ParseReply, type ParseRequest } from './parse.worker';

export type WorkerLike = {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  addEventListener(t: 'message', f: (e: MessageEvent) => void): void;
};

// The `new Worker(new URL(...))` is literal so that Vite emits the worker chunk.
function defaultMake(): WorkerLike {
  return new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

type Pending = { resolve(f: IfcxFile): void; reject(e: Error): void };

/**
 * Parser of linked layers. By default it creates the worker only once and matches the answers by
 * `id`. Con `make` null o sin `Worker` parsea en el hilo principal, con la misma forma de resultado
 * (mallas empaquetadas). Rechaza con `Error('Not a valid IFCX file: …')`.
 */
export function createLinkedParser(make: (() => WorkerLike) | null = defaultMake): (text: string) => Promise<IfcxFile> {
  if (!make || (make === defaultMake && typeof Worker === 'undefined')) {
    return (text) => settle(handleParse({ id: 0, text }).reply);
  }
  let worker: WorkerLike | null = null;
  let next = 1;
  const pending = new Map<number, Pending>();
  const failAll = (msg: string) => {
    for (const p of pending.values()) p.reject(new Error(msg));
    pending.clear();
  };
  const start = (): WorkerLike => {
    const w = make();
    w.addEventListener('message', (e) => {
      const reply = e.data as ParseReply;
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      if ('error' in reply) p.reject(new Error(reply.error));
      else p.resolve(reply.file);
    });
    // a worker that fails (does not load, uncaught exception) rejects what is pending and is recreated on the next one
    const onFail = (e: unknown) => {
      worker = null;
      failAll('Linked file parser failed: ' + ((e as { message?: string })?.message ?? 'unknown error'));
    };
    (w as unknown as EventTarget).addEventListener?.('error', onFail);
    (w as unknown as EventTarget).addEventListener?.('messageerror', onFail);
    return w;
  };
  return (text) =>
    new Promise<IfcxFile>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      try {
        (worker ??= start()).postMessage({ id, text } satisfies ParseRequest);
      } catch (e) {
        pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
}

const settle = (r: ParseReply): Promise<IfcxFile> =>
  'error' in r ? Promise.reject(new Error(r.error)) : Promise.resolve(r.file);
