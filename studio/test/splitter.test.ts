import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSplitter } from '../src/workspace/splitter';

function setup(collapsible = true) {
  document.body.innerHTML = '<div class="ws-main"><div class="pane"></div><div class="handle"></div></div>';
  const target = document.querySelector<HTMLElement>('.pane')!;
  const handle = document.querySelector<HTMLElement>('.handle')!;
  const main = document.querySelector<HTMLElement>('.ws-main')!;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ width: 280, height: 0 } as DOMRect);
  const onCollapse = vi.fn();
  mountSplitter(handle, {
    axis: 'x', target, min: 200, max: 500,
    ...(collapsible ? { onCollapse } : {}),
  });
  return { target, handle, main, onCollapse };
}

const pointer = (target: EventTarget, type: string, x = 0) =>
  target.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, bubbles: true, cancelable: true }));

describe('divisores plegables', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('doble clic llama a onCollapse', () => {
    const { handle, onCollapse } = setup();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('with onCollapse there is a pill; its click collapses and its pointerdown does not start a drag', () => {
    const { handle, onCollapse } = setup();
    const pill = handle.querySelector<HTMLButtonElement>('button.splitter-pill')!;
    expect(pill.title).toBe('Collapse');
    pointer(pill, 'pointerdown', 280);
    expect(handle.classList.contains('dragging')).toBe(false);
    pill.click();
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('without onCollapse there is no pill and the double click does nothing', () => {
    const { handle, onCollapse } = setup(false);
    expect(handle.querySelector('.splitter-pill')).toBeNull();
    handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('releasing below the threshold collapses and returns the starting size', () => {
    const { target, handle, onCollapse } = setup();
    pointer(handle, 'pointerdown', 280);
    pointer(handle, 'pointermove', 50);
    expect(target.style.flex).toBe('0 0 200px');
    pointer(handle, 'pointerup', 50);
    expect(onCollapse).toHaveBeenCalledTimes(1);
    expect(target.style.flex).toBe('0 0 280px');
  });

  it('releasing above the threshold does not collapse', () => {
    const { target, handle, onCollapse } = setup();
    pointer(handle, 'pointerdown', 280);
    pointer(handle, 'pointermove', 250);
    pointer(handle, 'pointerup', 250);
    expect(onCollapse).not.toHaveBeenCalled();
    expect(target.style.flex).toBe('0 0 250px');
  });

  it('arrastrando marca ws-main con is-dragging y lo quita al soltar', () => {
    const { handle, main } = setup();
    pointer(handle, 'pointerdown', 280);
    expect(main.classList.contains('is-dragging')).toBe(true);
    pointer(handle, 'pointerup', 280);
    expect(main.classList.contains('is-dragging')).toBe(false);
  });
});
