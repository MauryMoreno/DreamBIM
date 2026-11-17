// Modal loading notice over #app: it blocks interaction and shows what is being done.
let overlay: HTMLElement | null = null;
let label: HTMLElement | null = null;

/** Shows the notice (or only updates its text if it is already visible). */
export function showLoading(text: string): void {
  if (overlay?.isConnected) {
    setLoadingText(text);
    return;
  }
  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  label = document.createElement('span');
  label.className = 'loading-text';
  label.textContent = text; // siempre texto: el nombre del archivo es dato externo
  const box = document.createElement('div');
  box.className = 'loading-box';
  box.append(spinner, label);
  overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-busy', 'true');
  overlay.append(box);
  (document.getElementById('app') ?? document.body).append(overlay);
}

/** Cambia el texto del aviso visible; sin aviso no hace nada. */
export function setLoadingText(text: string): void {
  if (overlay?.isConnected && label) label.textContent = text;
}

/** Retira el aviso. Seguro si no hay ninguno. */
export function hideLoading(): void {
  overlay?.remove();
  overlay = null;
  label = null;
}

/**
 * Waits for the browser to paint (two frames) so that the notice is seen before the
 * heavy synchronous work. With the window hidden requestAnimationFrame does not advance, so
 * un temporizador evita quedarse esperando para siempre.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    const timer = setTimeout(done, 250);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        done();
      }),
    );
  });
}
