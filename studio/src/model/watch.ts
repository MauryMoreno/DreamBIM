// Watches the file of the open document: if it changes on disk (for example, because the Assistant or a
// script rewrites it), it notifies so it can be reloaded and the change seen live. It checks the modification date every
// `every` ms; calling `watch` again with the same path takes the current date as the reference (so a
// save by Studio itself does not count as a change).

export interface FileWatcherDeps {
  /** Modification date in ms, or null if the file does not exist. */
  mtime(path: string): Promise<number | null>;
  /** The file changed. If it rejects (e.g. it is half written), it is retried on the next round. */
  onChange(path: string): Promise<void>;
  every?: number;
}

export interface FileWatcher {
  watch(path: string | null): void;
  stop(): void;
}

export function createFileWatcher(d: FileWatcherDeps): FileWatcher {
  let path: string | null = null;
  let seen: number | null = null;
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** Goes up with every `watch`: a late read of a previous file does not count. */
  let generation = 0;

  const tick = async () => {
    if (!path || busy) return;
    const gen = generation;
    const p = path;
    busy = true;
    try {
      const m = await d.mtime(p);
      if (gen !== generation || m === null) return;
      if (seen === null) {
        seen = m;
        return;
      }
      if (m === seen) return;
      const before = seen;
      seen = m;
      try {
        await d.onChange(p);
      } catch {
        if (gen === generation) seen = before; // se reintenta en la siguiente vuelta
      }
    } catch {
      /* no se pudo leer la fecha: se prueba en la siguiente vuelta */
    } finally {
      busy = false;
    }
  };

  return {
    watch(next) {
      generation += 1;
      path = next;
      seen = null;
      if (!next) return;
      const gen = generation;
      void d.mtime(next).then((m) => {
        if (gen === generation && seen === null) seen = m;
      }).catch(() => {});
      timer ??= setInterval(() => void tick(), d.every ?? 1000);
    },
    stop() {
      generation += 1;
      path = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
