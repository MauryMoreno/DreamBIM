import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installShortcuts, type ShortcutActions } from '../src/app/shortcuts';

type KeyMods = Partial<Pick<KeyboardEventInit, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>>;

function setup(hasDocument = true) {
  const target = new EventTarget() as unknown as Window;
  const a: ShortcutActions = {
    hasDocument: () => hasDocument,
    save: vi.fn(),
    saveAs: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    help: vi.fn(),
  };
  installShortcuts(a, target);
  const press = (key: string, mods: KeyMods = {}, el: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key, cancelable: true, ...mods });
    Object.defineProperty(e, 'target', { value: el });
    target.dispatchEvent(e);
    return e;
  };
  return { a, press };
}

describe('atajos globales', () => {
  beforeEach(() => {
    document.body.dataset.screen = 'workspace';
  });

  it('F1 abre la ayuda; con modificadores no', () => {
    const { a, press } = setup();
    expect(press('F1').defaultPrevented).toBe(true);
    press('F1', { ctrlKey: true });
    expect(a.help).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+S guarda y Ctrl+Shift+S guarda como; sin documento no hace nada', () => {
    const { a, press } = setup();
    press('s', { ctrlKey: true });
    press('S', { ctrlKey: true, shiftKey: true });
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(a.saveAs).toHaveBeenCalledTimes(1);
    const empty = setup(false);
    expect(empty.press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(empty.a.save).not.toHaveBeenCalled();
  });

  it('Ctrl+Z deshace; Ctrl+Y y Ctrl+Shift+Z rehacen', () => {
    const { a, press } = setup();
    press('z', { ctrlKey: true });
    press('y', { ctrlKey: true });
    press('Z', { ctrlKey: true, shiftKey: true });
    expect(a.undo).toHaveBeenCalledTimes(1);
    expect(a.redo).toHaveBeenCalledTimes(2);
  });

  it('undo respects text fields and only acts in the workspace', () => {
    const { a, press } = setup();
    press('z', { ctrlKey: true }, document.createElement('input'));
    document.body.dataset.screen = 'home';
    press('z', { ctrlKey: true });
    press('z', { ctrlKey: true, altKey: true });
    expect(a.undo).not.toHaveBeenCalled();
  });
});
