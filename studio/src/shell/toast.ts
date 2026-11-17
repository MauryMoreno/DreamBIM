export type ToastKind = 'info' | 'error';

const DURATION_MS = 4000;

function host(): HTMLElement {
  let el = document.getElementById('toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toasts';
    document.body.appendChild(el);
  }
  return el;
}

/** Mensaje flotante que se descarta solo. Nunca usa alert(). */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const item = document.createElement('div');
  item.className = kind === 'error' ? 'toast toast-error' : 'toast';
  item.setAttribute('role', 'status');
  item.textContent = message;
  host().appendChild(item);
  setTimeout(() => item.remove(), DURATION_MS);
}
