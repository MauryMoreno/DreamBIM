import { svgIcon } from '../shell/icons';
import type { ModeDef, ModeId } from './definition';

export interface ModeTabs {
  /** Marks the active tab. It is the only thing that moves aria-selected: onSelect marks nothing, the switcher may refuse. */
  setActive(id: ModeId): void;
}

/** Mode tabs of the title bar (tablist with roving tabindex, like Stage | Layer). */
export function mountModeTabs(host: HTMLElement, modes: ModeDef[], onSelect: (id: ModeId) => void): ModeTabs {
  const list = document.createElement('div');
  list.className = 'tb-mode-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Modes');
  const buttons = modes.map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-mode';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', 'false');
    b.tabIndex = i === 0 ? 0 : -1;
    b.title = `${m.label} (Ctrl+${i + 1})`;
    b.append(svgIcon(m.icon, 16), document.createTextNode(m.label));
    b.addEventListener('click', () => onSelect(m.id));
    return b;
  });
  list.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const n = buttons.length;
    const next =
      e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (i < 0 || next < 0) return;
    e.preventDefault();
    buttons[next].focus();
    onSelect(modes[next].id);
  });
  list.append(...buttons);
  host.replaceChildren(list);
  return {
    setActive(id) {
      modes.forEach((m, i) => {
        const on = m.id === id;
        buttons[i].setAttribute('aria-selected', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
        buttons[i].classList.toggle('active', on);
      });
    },
  };
}
