export type Screen = 'home' | 'workspace' | 'collection' | 'docs';

const SCREENS: Screen[] = ['home', 'workspace', 'collection', 'docs'];
const PRODUCT = 'Dream BIM';

/** Muestra una sola pantalla; la otra queda oculta. */
export function showScreen(s: Screen): void {
  for (const id of SCREENS) {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== s;
  }
  document.body.dataset.screen = s;
}

/** "Dream BIM — <nombre> — <vista>" omitiendo las partes ausentes. */
export function setDocumentTitle(name: string | null, view: string | null): void {
  const text = [PRODUCT, name, view].filter((p): p is string => !!p).join(' — ');
  document.title = text;
  const t = document.querySelector('#titlebar .tb-title');
  if (t) t.textContent = text;
}

/** Creates the containers of the shell inside `root` and starts on Home. */
export function mountShell(root: HTMLElement): { titlebar: HTMLElement; home: HTMLElement; workspace: HTMLElement; collection: HTMLElement; docs: HTMLElement } {
  root.textContent = '';
  const make = (id: string) => {
    const el = document.createElement('div');
    el.id = id;
    root.appendChild(el);
    return el;
  };
  const titlebar = make('titlebar');
  const home = make('home');
  const workspace = make('workspace');
  const collection = make('collection');
  const docs = make('docs');

  // No browser context menu, except in text fields.
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
  });

  showScreen('home');
  return { titlebar, home, workspace, collection, docs };
}
