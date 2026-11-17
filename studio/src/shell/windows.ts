// Ventanas de modelo: Open de una referencia abre el archivo en otra ventana de Studio y deja la actual
// as it was. Each window is a complete Studio that starts with the path of ?open= in the URL.
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isWeb } from '../platform/env';
import { SAMPLE_ROOT } from '../platform/web-files';

/** Event received by an already open model window: it opens this path if it is not the one it has. */
export const OPEN_MODEL_EVENT = 'studio://open-model';

/** What is needed from Tauri (the tests replace it). */
export interface WindowApi {
  exists(label: string): Promise<boolean>;
  /** La saca de minimizada y la trae al frente. */
  focus(label: string): Promise<void>;
  /** Le pide a la ventana que muestre esta ruta. */
  send(label: string, path: string): Promise<void>;
  create(label: string, url: string, title: string): Promise<void>;
}

/** Label of a model window: the same path (regardless of slashes or case) gives the same one. */
export function modelWindowLabel(path: string): string {
  const key = path.replace(/\\/g, '/').toLowerCase();
  // 32-bit FNV-1a: Tauri labels only accept letters, numbers, - and _
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `model-${h.toString(36)}`;
}

/** Ruta con la que arranca esta ventana (?open=), o null en la ventana principal. */
export function startupPath(search: string): string | null {
  return new URLSearchParams(search).get('open') || null;
}

/** Abre el modelo en su propia ventana; si ya tiene una, la trae al frente. */
export async function openModelWindow(path: string, api: WindowApi = tauriWindows()): Promise<void> {
  if (isWeb()) {
    // a new tab only sees the example project: what the visitor opened lives in the memory of this one
    if (!path.startsWith(`${SAMPLE_ROOT}/`)) throw new Error('Files you opened from your computer can only be opened in this tab');
    window.open(`?open=${encodeURIComponent(path)}`, '_blank');
    return;
  }
  const label = modelWindowLabel(path);
  if (await api.exists(label)) {
    await api.focus(label);
    await api.send(label, path); // in case that window moved to another model with File › Open
    return;
  }
  const name = (path.split(/[\\/]/).filter(Boolean).pop() ?? path).replace(/\.ifcx$/i, '');
  await api.create(label, `index.html?open=${encodeURIComponent(path)}`, `Dream BIM — ${name}`);
}

/** Offset of the new window with respect to the current one, so that it is seen to be another one. */
const CASCADE = 32;

function tauriWindows(): WindowApi {
  return {
    exists: async (label) => (await WebviewWindow.getByLabel(label)) !== null,
    async focus(label) {
      const w = await WebviewWindow.getByLabel(label);
      if (!w) return;
      await w.unminimize();
      await w.setFocus();
    },
    send: (label, path) => emitTo(label, OPEN_MODEL_EVENT, path),
    async create(label, url, title) {
      // same size as the main one (tauri.conf.json), offset with respect to the current window
      const cur = getCurrentWindow();
      const scale = await cur.scaleFactor();
      const pos = (await cur.outerPosition()).toLogical(scale);
      const w = new WebviewWindow(label, {
        url,
        title,
        width: 1600,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        x: pos.x + CASCADE,
        y: pos.y + CASCADE,
        decorations: false,
        dragDropEnabled: false,
      });
      await new Promise<void>((resolve, reject) => {
        void w.once('tauri://created', () => resolve());
        void w.once('tauri://error', (e) => reject(new Error(String(e.payload))));
      });
    },
  };
}
