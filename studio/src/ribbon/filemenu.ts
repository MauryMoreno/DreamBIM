import type { RecentEntry } from '../home/recents';
import { svgIcon, type StudioIcon } from '../shell/icons';
import { createThemeRadios } from '../shell/theme-menu';
import { SOON } from './definition';

/** Tooltip de Save y Save As… en un modelo que no es de Studio. */
export const NOT_EDITABLE = 'Only models created in Dream BIM can be edited';

export interface FileMenuActions {
  onOpen(): void;
  onSave(): void;
  onSaveAs(): void;
  /** Whether Save and Save As… are active (queried when the menu opens). By default, yes. */
  canSave?(): boolean;
  onClose(): void;
  onExit(): void;
  recents(): RecentEntry[];
  onOpenRecent(e: RecentEntry): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Dropdown menu of the "File" button: commands on the left, documents on the right
 * recientes y «Salir» abajo. Se cierra con Esc, con un clic fuera o al elegir una orden.
 */
export function mountFileMenu(anchor: HTMLElement, a: FileMenuActions): void {
  anchor.classList.add('file-tab');
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'false');

  const menu = el('div', 'file-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'File');

  const commands = el('div', 'file-menu-commands');
  const recentsPane = el('div', 'file-menu-recents');
  recentsPane.appendChild(el('div', 'file-menu-heading', 'Recent Documents'));
  const recentsList = el('div', 'file-menu-recent-list');
  recentsPane.appendChild(recentsList);

  const command = (label: string, icon: StudioIcon, run?: () => void, cls = ''): HTMLButtonElement => {
    const b = el('button', `file-menu-item ${cls}`.trim());
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(svgIcon(icon, 18), el('span', undefined, label));
    if (run) {
      b.addEventListener('click', () => {
        close();
        run();
      });
    } else {
      b.disabled = true;
      b.title = SOON;
    }
    return b;
  };

  const themeSection = el('div', 'file-menu-theme');
  themeSection.setAttribute('role', 'group');
  themeSection.setAttribute('aria-label', 'Theme');
  themeSection.append(el('div', 'file-menu-subheading', 'Theme'), ...createThemeRadios(() => close()));

  const spacer = el('div', 'file-menu-spacer');
  const saveItems = [command('Save', 'file', () => a.onSave()), command('Save As…', 'file', () => a.onSaveAs())];
  commands.append(
    command('Open…', 'open', () => a.onOpen()),
    ...saveItems,
    command('Import IFC…', 'file'),
    command('Close', 'close', () => a.onClose()),
    themeSection,
    spacer,
    command('Exit', 'minimize', () => a.onExit(), 'file-menu-exit'),
  );
  menu.append(commands, recentsPane);
  document.body.appendChild(menu);

  const renderRecents = (): void => {
    const list = a.recents();
    if (list.length === 0) {
      recentsList.replaceChildren(el('div', 'file-menu-empty', 'No recent documents'));
      return;
    }
    recentsList.replaceChildren(
      ...list.map((r) => {
        const b = el('button', 'file-menu-recent', r.name);
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.title = r.path;
        b.addEventListener('click', () => {
          close();
          a.onOpenRecent(r);
        });
        return b;
      }),
    );
  };

  const onDocClick = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (menu.contains(t) || anchor.contains(t))) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    close();
    anchor.focus();
  };

  function open(): void {
    renderRecents();
    const can = a.canSave?.() ?? true;
    for (const b of saveItems) {
      b.disabled = !can;
      b.title = can ? '' : NOT_EDITABLE;
    }
    const r = anchor.getBoundingClientRect();
    menu.style.left = `${Math.round(r.left)}px`;
    menu.style.top = `${Math.round(r.bottom)}px`;
    menu.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
  }

  function close(): void {
    if (menu.hidden) return;
    menu.hidden = true;
    anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  }

  anchor.addEventListener('click', () => (menu.hidden ? open() : close()));
}
