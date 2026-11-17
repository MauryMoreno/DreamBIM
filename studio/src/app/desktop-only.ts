// The web demo is a desktop experience: the 3D view, the ribbon and the panels do not fit on a phone.
// The desktop app is not affected (this only runs in the web build: see platform/env.ts).
import { isWeb } from '../platform/env';

/** Below this width (or height, for landscape phones) the web demo is replaced by a notice. */
const DESKTOP_ONLY_QUERY = '(max-width: 900px), (max-height: 500px)';

/** true on the web demo when the viewport is too small for the app (a phone). */
export function isDesktopOnlyBlocked(): boolean {
  return isWeb() && window.matchMedia(DESKTOP_ONLY_QUERY).matches;
}

/** Replaces the app with a notice: the demo is only available on a bigger screen. */
export function showDesktopOnly(root: HTMLElement): void {
  root.replaceChildren();
  root.classList.add('desktop-only-screen');

  const logo = document.createElement('img');
  logo.src = './logo.svg';
  logo.alt = '';
  logo.width = 72;
  logo.height = 72;

  const title = document.createElement('h1');
  title.textContent = 'Dream BIM needs a bigger screen';

  const text = document.createElement('p');
  text.textContent =
    'The web demo is designed for desktop. Open it on a computer or laptop: the 3D view, the ribbon and the panels do not fit on a phone.';

  const hint = document.createElement('p');
  hint.className = 'desktop-only-hint';
  hint.textContent = 'Already on a computer? Widen the window to at least 900 px.';

  const box = document.createElement('div');
  box.className = 'desktop-only-box';
  box.append(logo, title, text, hint);
  root.append(box);
  document.title = 'Dream BIM — desktop only';
}
