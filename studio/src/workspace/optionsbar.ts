// Options Bar of the Wall tool (like Revit's): a bar under the ribbon that is only visible
// while walls are drawn. For now it carries the Chain checkbox, remembered between sessions.

const CHAIN_KEY = 'ifcx-studio.wall-chain';

function loadChain(): boolean {
  try {
    return localStorage.getItem(CHAIN_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveChain(on: boolean): void {
  try {
    localStorage.setItem(CHAIN_KEY, on ? 'on' : 'off');
  } catch {
    /* no storage: the option only lasts this session */
  }
}

export interface WallOptionsBar {
  readonly root: HTMLElement;
  /** Current value of Chain. */
  readonly chain: boolean;
  setVisible(on: boolean): void;
}

export function mountWallOptionsBar(onChain: (on: boolean) => void): WallOptionsBar {
  const root = document.createElement('div');
  root.className = 'ws-optionsbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Options Bar');
  root.hidden = true;

  const title = document.createElement('span');
  title.className = 'ws-optionsbar-title';
  title.textContent = 'Modify | Place Wall';

  const label = document.createElement('label');
  label.className = 'ws-optionsbar-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = loadChain();
  box.addEventListener('change', () => {
    saveChain(box.checked);
    onChain(box.checked);
  });
  label.append(box, document.createTextNode('Chain'));

  root.append(title, label);
  return {
    root,
    get chain() {
      return box.checked;
    },
    setVisible(on) {
      root.hidden = !on;
    },
  };
}
