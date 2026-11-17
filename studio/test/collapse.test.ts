import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLAPSE_MS, mountCollapsible, mountSectionFold, RAIL_SIZE, RAIL_SIZE_H, type CollapsibleOptions } from '../src/workspace/collapse';

function setup(side: CollapsibleOptions['side'] = 'left') {
  document.body.innerHTML = '<div class="row"><div class="pane"><div>Contents</div></div><div class="split"></div></div>';
  const pane = document.querySelector<HTMLElement>('.pane')!;
  const splitter = document.querySelector<HTMLElement>('.split')!;
  const onSelect = vi.fn();
  const options: CollapsibleOptions = {
    side,
    pane,
    splitter,
    label: 'Left panels',
    items: [{ label: 'Properties' }, { label: 'Project Browser', onSelect }],
  };
  return { pane, splitter, onSelect, options };
}

describe('mountCollapsible', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the rail has a button per item and the click expands and calls onSelect', () => {
    expect(RAIL_SIZE).toBe(28);
    expect(RAIL_SIZE_H).toBe(24);
    expect(COLLAPSE_MS).toBe(160);
  });

  it.each(['left', 'right', 'bottom'] as const)('inserta el riel junto al hueco: %s', (side) => {
    const { pane, options } = setup(side);
    const c = mountCollapsible(options);
    if (side === 'left') expect(c.rail.nextElementSibling).toBe(pane);
    else expect(pane.nextElementSibling).toBe(c.rail);
  });

  it('arranca desplegado: riel oculto, sin clase', () => {
    const { pane, options } = setup();
    const c = mountCollapsible(options);
    expect(c.collapsed).toBe(false);
    expect(c.rail.hidden).toBe(true);
    expect(pane.classList.contains('is-collapsed')).toBe(false);
  });

  it('the rail is a region with aria-label and the buttons say Expand <label>', () => {
    const { pane, splitter, options } = setup();
    pane.style.flex = '0 0 280px';
    const c = mountCollapsible(options);
    c.setCollapsed(true);
    expect(pane.classList.contains('is-collapsed')).toBe(true);
    expect(pane.inert).toBe(true);
    expect(pane.getAttribute('aria-hidden')).toBe('true');
    expect(splitter.hidden).toBe(true);
    expect(c.rail.hidden).toBe(false);
    expect(pane.style.flex).toBe('0 0 280px');
  });

  it('desplegar lo deja como estaba', () => {
    const { pane, splitter, options } = setup();
    pane.style.flex = '0 0 280px';
    const c = mountCollapsible(options);
    c.setCollapsed(true);
    c.setCollapsed(false);
    expect(pane.classList.contains('is-collapsed')).toBe(false);
    expect(pane.inert).toBe(false);
    expect(pane.hasAttribute('aria-hidden')).toBe(false);
    expect(splitter.hidden).toBe(false);
    expect(c.rail.hidden).toBe(true);
    expect(pane.style.flex).toBe('0 0 280px');
  });

  it('Enter/Space on the header also work and onChange only notifies when it changes', () => {
    const { options, onSelect } = setup();
    const c = mountCollapsible(options);
    c.setCollapsed(true);
    const buttons = c.rail.querySelectorAll<HTMLButtonElement>('button.ws-rail-item');
    expect(buttons).toHaveLength(2);
    buttons[1].click();
    expect(c.collapsed).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('onChange solo cuando cambia', () => {
    const { options } = setup();
    const c = mountCollapsible(options);
    const changed = vi.fn();
    c.onChange(changed);
    c.setCollapsed(true);
    c.setCollapsed(true);
    c.toggle();
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });

  it('setRailItems reemplaza las etiquetas', () => {
    const { options } = setup();
    const c = mountCollapsible(options);
    c.setRailItems([{ label: 'Cost System' }]);
    expect([...c.rail.querySelectorAll('.ws-rail-item')].map((b) => b.textContent)).toEqual(['Cost System']);
  });

  it('the big one paints the parameters', () => {
    const { options } = setup();
    const c = mountCollapsible(options);
    expect(c.rail.getAttribute('role')).toBe('toolbar');
    expect(c.rail.getAttribute('aria-label')).toBe(options.label);
    expect(c.rail.querySelector<HTMLButtonElement>('button')!.title).toBe('Expand Properties');
  });
});

describe('mountSectionFold', () => {
  it('clic en la cabecera pliega, pone is-folded y aria-expanded=false', () => {
    document.body.innerHTML = '<section><header><span>Properties</span></header><div class="ws-panel-body"></div></section>';
    const section = document.querySelector('section')!;
    const header = document.querySelector('header')!;
    const fold = mountSectionFold(section, header);
    const button = header.querySelector<HTMLButtonElement>('button.ws-panel-fold')!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click();
    expect(fold.folded).toBe(true);
    expect(section.classList.contains('is-folded')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(fold.folded).toBe(false);
  });

  it('the small one carries the basics and not the description or the extras', () => {
    document.body.innerHTML = '<section><header>Properties</header><div class="ws-panel-body"></div></section>';
    const fold = mountSectionFold(document.querySelector('section')!, document.querySelector('header')!);
    const changed = vi.fn();
    fold.onChange(changed);
    const button = document.querySelector<HTMLButtonElement>('.ws-panel-fold')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fold.setFolded(false);
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });
});
