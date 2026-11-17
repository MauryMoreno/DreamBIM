import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODES } from '../src/modes/definition';
import { mountModeTabs } from '../src/modes/modetabs';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

describe('mode tabs', () => {
  it('it paints one tab per mode and only setActive marks the selected one', () => {
    const onSelect = vi.fn();
    const t = mountModeTabs(host, MODES, onSelect);
    expect(tabs().map((b) => b.textContent)).toEqual(['Model', 'Materials', 'Costs', 'Schedule']);
    expect(tabs()[2].title).toBe('Costs (Ctrl+3)');
    tabs()[2].click();
    expect(onSelect).toHaveBeenCalledWith('costs');
    expect(tabs()[2].getAttribute('aria-selected')).not.toBe('true');
    t.setActive('costs');
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(tabs()[2].tabIndex).toBe(0);
    expect(tabs()[0].tabIndex).toBe(-1);
  });

  it('la flecha izquierda desde Model elige Schedule', () => {
    const onSelect = vi.fn();
    const t = mountModeTabs(host, MODES, onSelect);
    t.setActive('model');
    tabs()[0].focus();
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('schedule');
  });
});
