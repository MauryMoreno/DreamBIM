// Global keyboard shortcuts of the app (those of the workspace live in workspace/).

export interface ShortcutActions {
  hasDocument(): boolean;
  save(): void;
  saveAs(): void;
  undo(): void;
  redo(): void;
  help(): void;
}

/** true if the focus is in a text field (there the undo of the field rules). */
function inTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
}

export function installShortcuts(a: ShortcutActions, target: Window = window): void {
  target.addEventListener('keydown', (e) => {
    // F1 opens the help guide, on any screen.
    if (e.key === 'F1') {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      a.help();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();

    // Ctrl+S saves and Ctrl+Shift+S saves as (the listener of the workspace ignores Ctrl).
    if (k === 's') {
      e.preventDefault();
      if (!a.hasDocument()) return;
      if (e.shiftKey) a.saveAs();
      else a.save();
      return;
    }

    // Ctrl+Z deshace; Ctrl+Y y Ctrl+Shift+Z rehacen, solo en el espacio de trabajo.
    const redo = k === 'y' || (k === 'z' && e.shiftKey);
    if (k !== 'z' && !redo) return;
    if (inTextField(e.target)) return;
    if (document.body.dataset.screen !== 'workspace') return;
    e.preventDefault();
    if (redo) a.redo();
    else a.undo();
  });
}
