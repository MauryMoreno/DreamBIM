import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RIBBON } from '../src/ribbon/definition';
import { MODES } from '../src/modes/definition';
import { Slot } from '../src/modes/slot';
import { ModeSwitcher } from '../src/modes/switcher';

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="h"></div>';
  host = document.getElementById('h')!;
});

describe('Slot', () => {
  it('oculta el contenido de Model sin tocar el hidden de sus hijos y lo devuelve igual', () => {
    host.innerHTML = '<div id="a"></div><div id="b" hidden></div>';
    const s = new Slot(host);
    s.show('costs', () => Object.assign(document.createElement('div'), { id: 'c' }));
    expect(host.querySelector('#a')!.classList.contains('ws-mode-off')).toBe(true);
    expect(host.querySelector<HTMLElement>('#b')!.hidden).toBe(true);
    s.show('model', () => {
      throw new Error('model no se crea');
    });
    expect(host.querySelector('#a')!.classList.contains('ws-mode-off')).toBe(false);
    expect(host.querySelector<HTMLElement>('#b')!.hidden).toBe(true);
    expect(host.querySelector('#c')!.classList.contains('ws-mode-off')).toBe(true);
  });

  it('a mode enters with its initial size the first time and then with the one the user left', () => {
    host.style.flex = '0 0 230px';
    const s = new Slot(host);
    s.show('costs', () => document.createElement('div'), 360);
    expect(host.style.flex).toBe('0 0 360px');
    host.style.flex = '0 0 400px';
    s.show('model', () => document.createElement('div'), 360);
    expect(host.style.flex).toBe('0 0 230px'); // Model recupera el suyo
    s.show('costs', () => document.createElement('div'), 360);
    expect(host.style.flex).toBe('0 0 400px');
  });

  it('it creates the content of a mode only once and remembers its size', () => {
    host.style.flex = '0 0 280px';
    const s = new Slot(host);
    const make = vi.fn(() => document.createElement('div'));
    s.show('costs', make);
    host.style.flex = '0 0 400px';
    s.show('model', make);
    expect(host.style.flex).toBe('0 0 280px');
    s.show('costs', make);
    expect(host.style.flex).toBe('0 0 400px');
    expect(make).toHaveBeenCalledTimes(1);
  });
});

describe('ModeSwitcher', () => {
  const ribbon = { showTabs: vi.fn(), activeTab: vi.fn(() => 'vista') };
  const tabs = { setActive: vi.fn() };
  const canLeave = vi.fn<() => string | null>(() => null);
  const onLeave = vi.fn();
  const onChange = vi.fn();
  let sw: ModeSwitcher;
  beforeEach(() => {
    vi.clearAllMocks();
    canLeave.mockReturnValue(null);
    document.getElementById('toasts')?.remove();
    sw = new ModeSwitcher({ modes: MODES, slots: [new Slot(host)], ribbon, tabs, canLeave, onLeave, onChange });
  });

  it('it changes ribbon, tabs and slots and notifies', () => {
    expect(sw.set('costs')).toBe(true);
    expect(ribbon.showTabs).toHaveBeenLastCalledWith(['costos'], 'costos');
    expect(tabs.setActive).toHaveBeenLastCalledWith('costs');
    expect(onChange).toHaveBeenLastCalledWith('costs');
    expect(host.querySelector('.mode-empty h2')!.textContent).toBe('Costs mode is coming soon');
    sw.set('model');
    expect(ribbon.showTabs).toHaveBeenLastCalledWith(RIBBON.map((t) => t.id), 'vista');
  });

  it('it refuses if canLeave gives a reason: toast and nothing changes', () => {
    canLeave.mockReturnValue('Finish or cancel the floor sketch first');
    expect(sw.set('costs')).toBe(false);
    expect(sw.current).toBe('model');
    expect(onLeave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('.toast')?.textContent).toContain('Finish or cancel the floor sketch first');
    expect(tabs.setActive).toHaveBeenLastCalledWith('model');
  });

  it('switching to the mode it is already in does nothing', () => {
    expect(sw.set('model')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ModeSwitcher: contenido propio de un modo', () => {
  it('panels replaces the marker and onEnter notifies after onChange', () => {
    const order: string[] = [];
    const own = document.createElement('div');
    own.id = 'own';
    const sw = new ModeSwitcher({
      modes: MODES,
      slots: [new Slot(host)],
      ribbon: { showTabs: vi.fn(), activeTab: () => 'vista' },
      canLeave: () => null,
      onLeave: vi.fn(),
      onChange: () => order.push('change'),
      onEnter: (id) => order.push(`enter:${id}`),
      panels: (id, slot) => (id === 'materials' && slot === 0 ? own : null),
    });
    sw.set('materials');
    expect(host.querySelector('#own')).toBe(own);
    expect(host.querySelector('.mode-empty')).toBeNull();
    expect(order).toEqual(['change', 'enter:materials']);
    sw.set('costs'); // sin panels propios: vuelve el marcador
    expect(host.querySelector('.mode-empty h2')!.textContent).toBe('Costs mode is coming soon');
  });
});
