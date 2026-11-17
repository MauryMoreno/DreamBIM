// "Save" on the web: what is written is downloaded to the visitor's computer. The writes of one same save
// (the model, its schedule and cost files and the library documents) arrive one after another; they are grouped
// y bajan como un archivo o, si son varios, como un solo .zip con sus rutas relativas.
import { strToU8, zipSync } from 'fflate';

/** Tiempo sin escrituras nuevas tras el cual el guardado se da por completo. */
export const SAVE_SETTLE_MS = 400;

export type Saver = (name: string, blob: Blob) => void;

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

const MIME: Record<string, string> = { xml: 'application/xml', ifcx: 'application/json', json: 'application/json' };

/** Descarga con un <a download> temporal. */
export const browserSave: Saver = (name, blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export function downloadQueue(save: Saver = browserSave, settleMs: number = SAVE_SETTLE_MS): { add(path: string, text: string): void } {
  let pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    const batch = pending;
    pending = new Map();
    timer = undefined;
    if (batch.size === 1) {
      const [[path, text]] = [...batch];
      const name = baseName(path);
      save(name, new Blob([text], { type: MIME[name.split('.').pop()!.toLowerCase()] ?? 'text/plain' }));
      return;
    }
    const entries: Record<string, Uint8Array> = {};
    for (const [path, text] of batch) entries[path.replace(/^\//, '')] = strToU8(text);
    const model = [...batch.keys()].find((p) => /\.ifcx$/i.test(p)) ?? [...batch.keys()][0];
    save(`${baseName(model).replace(/\.[^.]*$/, '')}.zip`, new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }));
  }

  return {
    add(path, text) {
      pending.set(path, text);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, settleMs);
    },
  };
}
