import { getCurrentWindow } from '@tauri-apps/api/window';
import { isWeb } from '../platform/env';
import { svgIcon, type StudioIcon } from './icons';
import { createThemeRadios } from './theme-menu';

export interface QuickAccess {
  onOpen(): void;
  onHome(): void;
  on3D(): void;
  onAssistant?(): void;
  onHelp?(): void;
  onUndo?(): void;
  onRedo?(): void;
}

/** What the rest of the application changes in the title bar. */
export interface Titlebar {
  /** Slot of the mode tabs (after the title); workspace.ts fills it. */
  readonly modeHost: HTMLElement;
  /** What the next step undoes and redoes (null: the button is disabled). */
  setHistory(h: { undo: string | null; redo: string | null }): void;
}

type TauriWindow = ReturnType<typeof getCurrentWindow>;

/** Ventana de Tauri, o null si no existe (navegador o pruebas sin Tauri). */
function appWindow(): TauriWindow | null {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function button(cls: string, title: string, icon: StudioIcon, size: number, onClick?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(svgIcon(icon, size));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/**
 * Theme button of the quick access bar: a menu with the three radio options (Light, Dark, System).
 * Se cierra con Esc, con un clic fuera o al elegir una.
 */
function themeButton(): HTMLButtonElement {
  const btn = button('tb-btn', 'Theme', 'theme', 16);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'theme-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Theme');
  const radios = createThemeRadios(() => close());
  menu.append(...radios);
  document.body.appendChild(menu);

  const onDocClick = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (menu.contains(t) || btn.contains(t))) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    close();
    btn.focus();
  };
  menu.addEventListener('keydown', (e) => {
    const i = radios.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step || i < 0) return;
    e.preventDefault();
    radios[(i + step + radios.length) % radios.length].focus();
  });

  function open(): void {
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom)}px`;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    (radios.find((b) => b.getAttribute('aria-checked') === 'true') ?? radios[0]).focus();
  }
  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  }
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  return btn;
}

/**
 * Own title bar (a window without decorations). Dragging and the double click
 * to maximize are handled by Tauri through data-tauri-drag-region.
 */
export function mountTitlebar(el: HTMLElement, qat: QuickAccess): Titlebar {
  el.textContent = '';
  el.setAttribute('data-tauri-drag-region', '');

  const brand = document.createElement('span');
  brand.className = 'tb-brand';
  brand.setAttribute('data-tauri-drag-region', '');
  const logo = document.createElement('img');
  logo.className = 'tb-logo';
  logo.src = `${import.meta.env.BASE_URL}logo.svg`;
  logo.alt = '';
  logo.draggable = false;
  brand.appendChild(logo);

  const quick = document.createElement('div');
  quick.className = 'tb-qat';
  quick.setAttribute('data-tauri-drag-region', ''); // los botones siguen sin arrastrar
  const undo = button('tb-btn', 'Undo', 'undo', 16, () => qat.onUndo?.());
  const redo = button('tb-btn', 'Redo', 'redo', 16, () => qat.onRedo?.());
  undo.disabled = true;
  redo.disabled = true;
  /** The tooltip says what the step does, as in Revit: "Undo Move (Ctrl+Z)". */
  const setStep = (b: HTMLButtonElement, verb: string, label: string | null, keys: string) => {
    b.disabled = label === null;
    b.title = label === null ? verb : `${verb} ${label} (${keys})`;
  };
  quick.append(
    button('tb-btn', 'Open', 'open', 16, () => qat.onOpen()),
    button('tb-btn', 'Home', 'home', 16, () => qat.onHome()),
    undo,
    redo,
    themeButton(),
    button('tb-btn', '3D View', 'cube3d', 16, () => qat.on3D()),
  );
  // sin onAssistant (ventanas de modelo secundarias) no hay Asistente
  if (qat.onAssistant) quick.append(button('tb-btn', 'Assistant', 'assistant', 16, () => qat.onAssistant?.()));
  quick.append(button('tb-btn', 'Help (F1)', 'help', 16, () => qat.onHelp?.()));

  const title = document.createElement('span');
  title.className = 'tb-title';
  title.setAttribute('data-tauri-drag-region', '');
  title.textContent = 'Dream BIM';

  const modeHost = document.createElement('div');
  modeHost.className = 'tb-modes'; // sin data-tauri-drag-region: sus botones reciben clics

  const controls = document.createElement('div');
  controls.className = 'tb-window';
  const maxBtn = button('tb-win', 'Maximize', 'maximize', 14, () => void appWindow()?.toggleMaximize());
  controls.append(
    button('tb-win', 'Minimize', 'minimize', 14, () => void appWindow()?.minimize()),
    maxBtn,
    button('tb-win tb-close', 'Close', 'close', 14, () => void appWindow()?.close()),
  );

  // in the browser there is no own window to minimize, maximize or close
  el.append(brand, quick, title, modeHost, ...(isWeb() ? [] : [controls]));

  // Keeps the icon and the title of the maximize button according to the real state.
  const win = appWindow();
  if (win) {
    const sync = async () => {
      try {
        const maximized = await win.isMaximized();
        const label = maximized ? 'Restore' : 'Maximize';
        maxBtn.title = label;
        maxBtn.setAttribute('aria-label', label);
        maxBtn.replaceChildren(svgIcon(maximized ? 'restore' : 'maximize', 14));
      } catch {
        /* sin API de ventana */
      }
    };
    void sync();
    try {
      void Promise.resolve(win.onResized(() => void sync())).catch(() => {});
    } catch {
      /* sin API de ventana */
    }
  }

  return {
    modeHost,
    setHistory(h) {
      setStep(undo, 'Undo', h.undo, 'Ctrl+Z');
      setStep(redo, 'Redo', h.redo, 'Ctrl+Y');
    },
  };
}
