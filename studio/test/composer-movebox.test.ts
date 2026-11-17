import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountMoveBox } from '../src/composer/movebox';

const ALL = { x: true, y: true, z: true };

function setup() {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host')!;
  const cb = { moveTo: vi.fn(), moveBy: vi.fn() };
  const box = mountMoveBox(host, cb);
  return { host, cb, box };
}

const field = (label: string) =>
  document.querySelector<HTMLInputElement>(`.movebox input[aria-label="${label}"]`)!;
const enter = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
};
const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent);

beforeEach(() => vi.clearAllMocks());

describe('mountMoveBox', () => {
  it('is hidden until something is shown, and hides again with null', () => {
    const { box } = setup();
    const root = document.querySelector<HTMLElement>('.movebox')!;
    expect(root.hidden).toBe(true);
    box.show({ title: 'Door', pos: [1, 2.345, -3], axes: ALL });
    expect(root.hidden).toBe(false);
    expect(document.querySelector('.movebox-title')!.textContent).toBe('Transform · Door');
    expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(['1.00', '2.35', '-3.00']);
    expect(['ΔX', 'ΔY', 'ΔZ'].map((a) => field(a).value)).toEqual(['0.00', '0.00', '0.00']);
    box.show(null);
    expect(root.hidden).toBe(true);
  });

  it('Enter on ΔX calls moveBy([0.5,0,0]) and returns to 0.00', () => {
    const { box, cb } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    enter(field('ΔX'), '0.5');
    expect(cb.moveBy).toHaveBeenCalledWith([0.5, 0, 0]);
    expect(field('ΔX').value).toBe('0.00');
    expect(cb.moveTo).not.toHaveBeenCalled();
  });

  it('Enter on Y calls moveTo with the other coordinates unchanged', () => {
    const { box, cb } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    enter(field('Y'), '7,25 m');
    expect(cb.moveTo).toHaveBeenCalledWith([1, 7.25, 3]);
  });

  it("'abc' does not call anything: toast and the value is restored", () => {
    const { box, cb } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    enter(field('X'), 'abc');
    enter(field('ΔZ'), 'abc');
    expect(cb.moveTo).not.toHaveBeenCalled();
    expect(cb.moveBy).not.toHaveBeenCalled();
    expect(field('X').value).toBe('1.00');
    expect(field('ΔZ').value).toBe('0.00');
    expect(toasts()).toContain('Enter a valid number');
  });

  it('fields of a disallowed axis are disabled', () => {
    const { box } = setup();
    box.show({ title: 'Wall', pos: [0, 0, 0], axes: { x: true, y: true, z: false } });
    expect(field('Z').disabled).toBe(true);
    expect(field('ΔZ').disabled).toBe(true);
    expect(field('X').disabled).toBe(false);
    box.show({ title: 'Level 1', pos: [0, 0, 3], axes: { x: false, y: false, z: true } });
    expect(field('X').disabled).toBe(true);
    expect(field('Z').disabled).toBe(false);
  });

  it('preview updates X/Y/Z without committing', () => {
    const { box, cb } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    box.preview([4, 5, 6]);
    expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(['4.00', '5.00', '6.00']);
    expect(cb.moveTo).not.toHaveBeenCalled();
  });

  it('Escape restores the field without moving', () => {
    const { box, cb } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    const x = field('X');
    x.value = '9';
    x.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(x.value).toBe('1.00');
    expect(cb.moveTo).not.toHaveBeenCalled();
  });
  it('the header folds and unfolds the fields (click or Enter)', () => {
    const { box } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    const root = document.querySelector<HTMLElement>('.movebox')!;
    const head = document.querySelector<HTMLElement>('.movebox-title')!;
    head.click();
    expect(root.classList.contains('is-collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    head.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(root.classList.contains('is-collapsed')).toBe(false);
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });
  it('rotation and scale rows show the values and confirm absolute values', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host')!;
    const cb = { moveTo: vi.fn(), moveBy: vi.fn(), rotateTo: vi.fn(), scaleTo: vi.fn() };
    const box = mountMoveBox(host, cb);
    const wall = { x: false, y: false, z: true };
    const none = { x: false, y: false, z: false };
    box.show({ title: 'Wall', pos: [0, 0, 0], axes: ALL, rot: [0, 0, 90], rotAxes: wall, scale: [1, 1, 1], scaleAxes: none });
    expect(['Rotation X', 'Rotation Y', 'Rotation Z'].map((a) => field(a).value)).toEqual(['0.00', '0.00', '90.00']);
    expect(['Scale X', 'Scale Y', 'Scale Z'].map((a) => field(a).value)).toEqual(['1.000', '1.000', '1.000']);
    expect(field('Rotation X').disabled).toBe(true);
    expect(field('Rotation Z').disabled).toBe(false);
    expect(field('Scale Z').disabled).toBe(true);
    enter(field('Rotation Z'), '45°');
    expect(cb.rotateTo).toHaveBeenCalledWith([0, 0, 45]);
    box.show({ title: 'Chair', pos: [0, 0, 0], axes: ALL, rot: [0, 0, 0], rotAxes: ALL, scale: [1, 1, 1], scaleAxes: ALL });
    enter(field('Scale Y'), '2,5');
    expect(cb.scaleTo).toHaveBeenCalledWith([1, 2.5, 1]);
    enter(field('Scale X'), '0');
    expect(cb.scaleTo).toHaveBeenCalledTimes(1);
    expect(toasts()).toContain('Scale cannot be 0');
  });

  it('without rotation and scale data those rows stay disabled', () => {
    const { box } = setup();
    box.show({ title: 'Door', pos: [1, 2, 3], axes: ALL });
    expect(field('Rotation Z').disabled).toBe(true);
    expect(field('Scale Z').disabled).toBe(true);
  });
});
