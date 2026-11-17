import { beforeEach, describe, expect, it } from 'vitest';
import { askConfirm, askSaveChanges } from '../src/shell/dialog';

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === label)!;
const key = (k: string, extra: KeyboardEventInit = {}) =>
  (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

beforeEach(() => {
  document.body.innerHTML = '<button id="before">before</button>';
});

describe('askSaveChanges', () => {
  it('it shows the title, the text and the three buttons with the focus on Save', () => {
    void askSaveChanges('casa.ifcx');
    const d = dialog()!;
    expect(d).toBeTruthy();
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.textContent).toContain('Dream BIM');
    expect(d.querySelector('.modal-text')!.textContent).toBe('Save changes to casa.ifcx?');
    expect([...d.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Save', "Don't Save", 'Cancel']);
    expect(document.activeElement).toBe(button('Save'));
    key('Escape');
  });

  it.each([
    ['Save', 'save'],
    ["Don't Save", 'discard'],
    ['Cancel', 'cancel'],
  ] as const)('%s resuelve %s y quita el diálogo del DOM', async (label, value) => {
    const p = askSaveChanges('casa.ifcx');
    button(label).click();
    await expect(p).resolves.toBe(value);
    expect(dialog()).toBeNull();
    expect(document.querySelector('.modal-scrim')).toBeNull();
  });

  it('Esc resuelve cancel, no llega a window y devuelve el foco', async () => {
    const before = document.getElementById('before')!;
    before.focus();
    let reached = false;
    const spy = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reached = true;
    };
    window.addEventListener('keydown', spy);
    const p = askSaveChanges('casa.ifcx');
    key('Escape');
    await expect(p).resolves.toBe('cancel');
    window.removeEventListener('keydown', spy);
    expect(reached).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('Tab and Shift+Tab do not leave the dialog', () => {
    void askSaveChanges('casa.ifcx');
    button('Cancel').focus();
    key('Tab');
    expect(document.activeElement).toBe(button('Save'));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(button('Cancel'));
    key('Escape');
  });

  it('a second request with the dialog open is cancelled without opening another', async () => {
    const first = askSaveChanges('casa.ifcx');
    await expect(askSaveChanges('casa.ifcx')).resolves.toBe('cancel');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    button('Save').click();
    await expect(first).resolves.toBe('save');
  });
});

describe('askConfirm', () => {
  it('it shows the text with the given button and Cancel; the focus starts on the given button', async () => {
    const p = askConfirm('Remove a.ifcx and its 2 edits?', 'Remove');
    const d = dialog()!;
    expect(d.querySelector('.modal-text')!.textContent).toBe('Remove a.ifcx and its 2 edits?');
    expect([...d.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Remove', 'Cancel']);
    expect(document.activeElement).toBe(button('Remove'));
    button('Remove').click();
    await expect(p).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('Cancel y Esc resuelven false', async () => {
    const a = askConfirm('¿Seguro?', 'OK');
    button('Cancel').click();
    await expect(a).resolves.toBe(false);
    const b = askConfirm('¿Seguro?', 'OK');
    key('Escape');
    await expect(b).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });
});
