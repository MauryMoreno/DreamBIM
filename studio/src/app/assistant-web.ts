// El Asistente en la demo web: sin Tauri ni agente de Python. BuiltBot habla con el puente del navegador
// (assistant/web/bridge.ts) through the relay of this window, and the agent runs here with the user's key.
import { installRelay } from '../assistant/builtbot/relay';
import type { StudioExecutor } from '../assistant/studio/executor';
import { createWebBridge } from '../assistant/web/bridge';
import { createBus, type EventBus } from '../assistant/web/bus';
import { idbConversations, type ConversationStore } from '../assistant/web/conversations';

export interface WebAssistantWiring {
  /** La herramienta Studio sobre la app real (ver `buildExecutor` en assistant.ts). */
  executor: StudioExecutor;
  /** Blocks or unblocks the user's editing while the agent works. */
  setLock(on: boolean): void;
  win: Window;
  // for the tests
  bus?: EventBus;
  store?: ConversationStore;
  storage?: Storage | null;
  fetchImpl?: typeof fetch;
}

export function connectWebAssistant(w: WebAssistantWiring): void {
  const bus = w.bus ?? createBus();
  const bridge = createWebBridge({
    bus,
    store: w.store ?? idbConversations(),
    executor: w.executor,
    storage: w.storage,
    fetchImpl: w.fetchImpl,
  });
  installRelay(w.win, bus.listen, (cmd, args) => bridge.invoke(cmd, args as { payload?: Record<string, unknown> }), true);

  // Turnos abiertos: el bloqueo se quita cuando no queda ninguno (el fin de otro id no cuenta).
  const open = new Set<string>();
  const idOf = (e: { payload?: unknown }) => String((e.payload as { id?: string } | undefined)?.id ?? '');
  void bus.listen('studio://turn-start', (e) => {
    open.add(idOf(e));
    w.setLock(true);
  });
  void bus.listen('studio://turn-end', (e) => {
    if (!open.delete(idOf(e))) return;
    if (open.size === 0) w.setLock(false);
  });
}
