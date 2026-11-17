// In-memory event bus of the web demo: it stands in for Tauri for BuiltBot. The listeners receive the same
// shape as Tauri's `Event` (`{ event, payload }`), and `listen` returns its `off`, like Tauri's.

export interface BusEvent {
  event: string;
  payload: unknown;
}

export interface EventBus {
  emit(event: string, payload: unknown): void;
  listen(event: string, cb: (e: BusEvent) => void): Promise<() => void>;
}

export function createBus(): EventBus {
  const listeners = new Map<string, Set<(e: BusEvent) => void>>();
  return {
    emit(event, payload) {
      for (const cb of [...(listeners.get(event) ?? [])]) {
        try {
          cb({ event, payload });
        } catch (e) {
          // a broken listener cannot leave the others without the event
          console.error(`listener of ${event} failed`, e);
        }
      }
    },
    async listen(event, cb) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },
  };
}
