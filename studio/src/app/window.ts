// La ventana de Tauri: cerrar con guarda de cambios y peticiones de abrir desde otras ventanas.

import { getCurrentWindow, type Window } from '@tauri-apps/api/window';
import { OPEN_MODEL_EVENT } from '../shell/windows';

/** Ventana de Tauri, o null en el navegador y en pruebas. */
export function appWindow(): Window | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** File › Exit: closes the window; the changes guard is in guardClose. */
export function exitApp(): void {
  void appWindow()?.close().catch(() => {});
}

/** X de la ventana, Exit o Alt+F4: con cambios sin guardar se pregunta antes de cerrar. */
export function guardClose(confirmDiscard: () => Promise<boolean>): void {
  const win = appWindow();
  if (!win) return;
  try {
    void win
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (await confirmDiscard()) await win.destroy();
      })
      .catch(() => {});
  } catch {
    /* sin API de ventana */
  }
}

/** Otra ventana pide que esta muestre `path` (ver shell/windows). */
export function onOpenModelRequest(handler: (path: string) => void): void {
  try {
    void appWindow()
      ?.listen<string>(OPEN_MODEL_EVENT, (e) => handler(e.payload))
      .catch(() => {});
  } catch {
    /* sin API de ventana */
  }
}
