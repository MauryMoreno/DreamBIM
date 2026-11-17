// Pantalla Docs (explorador de la carpeta del proyecto): se abre desde Inicio, sin necesitar un modelo. Barra con
// Back, the chosen folder and the commands; below, folders | files. All the work is done by createDocsMode.
import { scanProject } from '../docs/scan';
import { createDocsMode, type DocsActions, type DocsMode } from '../docs/mode';
import { isWeb } from '../platform/env';
import { files } from '../platform/files';
import { showScreen } from '../shell/screens';
import { toast } from '../shell/toast';
import { pickFolderOrWarn } from './pickers';

const FOLDER_KEY = 'studio.docs.folder';

export interface DocsScreen {
  /** Shows the screen and reads the remembered folder. */
  show(): Promise<void>;
}

export interface DocsScreenDeps {
  host: HTMLElement;
  /** Vuelve a Inicio. */
  onBack(): void;
  /** Abre un `.ifcx` (ruta absoluta) como modelo en Studio. */
  onOpenModel(path: string): void | Promise<void>;
  /** For tests: replaces the folder dialog. */
  pickFolder?: () => Promise<string | null>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'col-btn docs-btn', label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Carpeta recordada en el equipo. En web nada persiste: siempre se empieza por el proyecto de ejemplo. */
function remembered(): string | null {
  if (isWeb()) return files().defaultLibraryFolder();
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

function remember(dir: string | null): void {
  if (isWeb()) return;
  try {
    if (dir) localStorage.setItem(FOLDER_KEY, dir);
    else localStorage.removeItem(FOLDER_KEY);
  } catch {
    /* no storage: it will be asked for again */
  }
}

export function mountDocsScreen(d: DocsScreenDeps): DocsScreen {
  let dir = remembered();
  const chooseFolder = d.pickFolder ?? pickFolderOrWarn;
  /** Ruta absoluta de una ruta relativa al proyecto. */
  const abs = (rel: string): string => `${dir!.replace(/[\\/]+$/, '')}/${rel}`;

  const actions: DocsActions = {
    folder: () => dir,
    scan: () => scanProject(dir!, (p) => files().listAll(p)),
    pickFile: () => files().pickOpen([{ name: 'All files', extensions: ['*'] }]),
    addFile: (src, rel) => files().copyFile(src, abs(rel), dir!),
    makeFolder: (rel) => files().makeDir(abs(rel), dir!),
    openFile: (rel) => files().openExternal(abs(rel)),
    openModel: async (rel) => {
      await d.onOpenModel(abs(rel));
    },
  };
  const mode: DocsMode = createDocsMode({ actions, toast });

  // --- Layout -------------------------------------------------------------------
  d.host.replaceChildren();
  d.host.classList.add('docs-screen');
  const back = button('Back', 'Back (Esc)', () => d.onBack());
  back.classList.add('col-back');
  const folder = el('span', 'docs-folder');
  const pick = button('Folder…', 'Choose the project folder', () => void changeFolder());
  const tools = el('div', 'docs-tools');
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'Documents');
  const tool = (label: string, title: string, run: () => Promise<void>): HTMLButtonElement => {
    const b = button(label, title, () => void run());
    tools.append(b);
    return b;
  };
  const buttons = [
    tool('New Folder', 'Create a folder', () => mode.newFolder()),
    tool('Upload', 'Upload a file', () => mode.upload()),
    tool('Open', 'Open the selected file', () => mode.open()),
  ];
  const bar = el('div', 'col-bar docs-bar');
  bar.append(back, el('h1', 'col-title', 'Documents'), folder, pick, tools);

  const body = el('div', 'docs-body');
  const left = el('div', 'docs-col docs-left');
  const center = el('div', 'docs-col docs-center-col');
  const empty = el('div', 'docs-empty');
  const choose = el('button', 'col-choose', 'Choose folder…');
  choose.type = 'button';
  choose.addEventListener('click', () => void changeFolder());
  empty.append(el('span', undefined, 'Choose the folder that holds the project files.'), choose);
  left.append(mode.panel(0)!);
  center.append(mode.panel(3)!);
  body.append(left, center, empty);
  d.host.append(bar, body);

  function sync(): void {
    folder.textContent = dir ?? '';
    folder.title = dir ?? '';
    body.classList.toggle('is-empty', dir === null);
    empty.hidden = dir !== null;
    for (const b of buttons) b.disabled = dir === null;
  }

  async function changeFolder(): Promise<void> {
    const next = await chooseFolder();
    if (!next) return;
    dir = next;
    remember(dir);
    sync();
    mode.refresh();
  }

  d.host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !(e.target instanceof HTMLInputElement)) d.onBack();
  });

  sync();
  return {
    async show() {
      showScreen('docs');
      sync();
      mode.refresh();
    },
  };
}
