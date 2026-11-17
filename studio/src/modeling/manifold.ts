import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let promesa: Promise<ManifoldToplevel> | null = null;

// In vitest `window` exists (happy-dom), so node is detected through `process.versions.node`,
// que no existe en el webview de Tauri ni en el navegador.
const esNode = typeof process !== 'undefined' && !!process.versions?.node;

/** Carga Manifold (WASM) una sola vez. En el navegador el .wasm lo empaqueta Vite. */
export function loadManifold(): Promise<ManifoldToplevel> {
  if (!promesa) {
    promesa = (esNode ? Module() : Module({ locateFile: () => wasmUrl })).then((m) => {
      m.setup();
      return m;
    }).catch((e) => {
      promesa = null; // un fallo no se memoriza: la siguiente llamada reintenta
      throw e;
    });
  }
  return promesa;
}
