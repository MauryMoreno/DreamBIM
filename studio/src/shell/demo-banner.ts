// Web demo notice: nothing the visitor does is saved.

export const DEMO_NOTICE = 'Demo: your changes are not saved';

/** Puts the notice (discreet, in a corner) inside `host`. */
export function mountDemoBanner(host: HTMLElement): HTMLElement {
  const el = document.createElement('div');
  el.className = 'demo-banner';
  el.setAttribute('role', 'status');
  el.textContent = DEMO_NOTICE;
  host.appendChild(el);
  return el;
}
