import type { ModeDef } from './definition';

/** Panel of a mode that does not exist yet (phases 2–4). */
export function placeholderPane(mode: ModeDef): HTMLElement {
  const root = document.createElement('section');
  root.className = 'mode-empty';
  root.setAttribute('aria-label', mode.label);
  const h = document.createElement('h2');
  h.textContent = `${mode.label} mode is coming soon`;
  const p = document.createElement('p');
  p.textContent = mode.blurb ?? '';
  root.append(h, p);
  return root;
}
