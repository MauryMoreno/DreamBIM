// Lo que Studio hace por su cuenta mientras BuiltBot conversa: contestar las llamadas de la herramienta
// `Studio` del agente y bloquear la edición del usuario durante cada turno. BuiltBot no sabe nada de esto.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { StudioExecutor, StudioOutcome } from '../studio/executor';

export interface StudioLinkDeps {
  executor: StudioExecutor;
  setLock(on: boolean): void;
  listen?: typeof listen;
  invoke?: typeof invoke;
}

interface StudioCall {
  call_id?: string;
  command?: string;
  args?: unknown;
}

export async function connectStudio(d: StudioLinkDeps): Promise<() => void> {
  const on = d.listen ?? listen;
  const call = d.invoke ?? invoke;
  /** Turnos abiertos: el bloqueo se quita cuando no queda ninguno (el fin de otro id no cuenta). */
  const open = new Set<string>();

  const answer = async (c: StudioCall) => {
    let outcome: StudioOutcome;
    try {
      outcome = await d.executor.run(String(c.command ?? ''), c.args);
    } catch (e) {
      outcome = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const payload = outcome.ok
      ? { call_id: c.call_id, ok: true, result: outcome.result }
      : { call_id: c.call_id, ok: false, error: outcome.error };
    try {
      await call('studio_result', { payload });
    } catch {
      /* el puente cayó: el agente deja de esperar solo */
    }
  };

  const offs = await Promise.all([
    on<StudioCall>('chat://studio_call', (e) => void answer(e.payload)),
    on<{ id?: string }>('studio://turn-start', (e) => {
      open.add(String(e.payload?.id ?? ''));
      d.setLock(true);
    }),
    on<{ id?: string }>('studio://turn-end', (e) => {
      if (!open.delete(String(e.payload?.id ?? ''))) return;
      if (open.size === 0) d.setLock(false);
    }),
    on('bridge://error', () => {
      open.clear();
      d.setLock(false);
    }),
  ]);
  return () => {
    for (const off of offs) off();
  };
}
