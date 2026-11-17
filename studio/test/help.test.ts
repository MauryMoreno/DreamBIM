import { beforeEach, describe, expect, it } from 'vitest';
import { openHelp } from '../src/help/help';

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === label)!;
const key = (k: string) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const stepTitle = () => dialog()!.querySelector('.help-step-title')!.textContent;

beforeEach(() => {
  document.body.innerHTML = '<button id="before">before</button>';
});

describe('openHelp', () => {
  it('it opens the guide at the first step, with its drawing and Back disabled', () => {
    void openHelp();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.textContent).toContain('How the model is composed');
    expect(stepTitle()).toBe('Layers');
    expect(d.querySelector('svg')).not.toBeNull();
    expect(button('Back').disabled).toBe(true);
    key('Escape');
  });

  it('Next and Back go through the three steps; on the last one Next becomes Done and closes', async () => {
    const p = openHelp();
    button('Next').click();
    expect(stepTitle()).toBe('Who wins');
    button('Next').click();
    expect(stepTitle()).toBe('In Dream BIM');
    button('Back').click();
    expect(stepTitle()).toBe('Who wins');
    button('Next').click();
    button('Done').click();
    await p;
    expect(dialog()).toBeNull();
  });

  it('the step tabs jump to any of them', () => {
    void openHelp();
    button('3 · In Dream BIM').click();
    expect(stepTitle()).toBe('In Dream BIM');
    key('Escape');
  });

  it('Esc cierra, no llega a window y devuelve el foco', async () => {
    const before = document.getElementById('before')!;
    before.focus();
    let reached = false;
    const spy = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reached = true;
    };
    window.addEventListener('keydown', spy);
    const p = openHelp();
    key('Escape');
    await p;
    window.removeEventListener('keydown', spy);
    expect(reached).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('Take the tour closes the guide and calls the tour; without a callback there is no button', async () => {
    void openHelp();
    expect(button('Take the tour')).toBeUndefined();
    key('Escape');

    let tours = 0;
    const p = openHelp({ onTour: () => (tours += 1) });
    button('Take the tour').click();
    await p;
    expect(dialog()).toBeNull();
    expect(tours).toBe(1);
  });

  it('a click on the scrim closes; with the guide open another one is not opened', async () => {
    const p = openHelp();
    await openHelp();
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    const scrim = document.querySelector<HTMLElement>('.modal-scrim')!;
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await p;
    expect(dialog()).toBeNull();
  });
});
