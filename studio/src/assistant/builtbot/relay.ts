// Relevo de eventos en la ventana de Studio. Tauri solo entrega los eventos a la ventana principal, y el
// puente del iframe de BuiltBot está fijado y congelado (no se puede redirigir): BuiltBot escucha a través
// de este relevo (chatbot-revit/frontend/src/lib/tauri-events.ts). En la demo web no hay Tauri: el relevo
// también lleva `invoke` hacia el puente del navegador y se marca `web` (chatbot-revit/frontend/src/lib/tauri-invoke.ts).
import { listen } from '@tauri-apps/api/event';

export type RelayInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
/** Lo que el relevo necesita de un `listen`: el de Tauri, o el del bus de la demo web. */
export type ListenFn = (event: string, cb: (e: any) => void) => Promise<() => void>;

export interface EventRelay {
  listen(event: string, cb: (e: unknown) => void): Promise<() => void>;
  /** Solo en la demo web: sustituye a los comandos de Tauri. */
  invoke?: RelayInvoke;
  /** true en la demo web: BuiltBot lo lee para saber que su anfitrión es el navegador. */
  web?: boolean;
}

export function installRelay(
  win: Window,
  listenImpl: ListenFn = listen,
  invokeImpl?: RelayInvoke,
  web = false,
): EventRelay {
  const relay: EventRelay = {
    async listen(event, cb) {
      const off = await listenImpl(event, cb);
      return () => off();
    },
  };
  if (invokeImpl) relay.invoke = (cmd, args) => invokeImpl(cmd, args);
  if (web) relay.web = true;
  (win as unknown as { __ifcxRelay: EventRelay }).__ifcxRelay = relay;
  return relay;
}
