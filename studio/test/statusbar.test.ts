import { describe, expect, it } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import { hoverText, levelText, mountStatusBar, STATUS_HINT } from '../src/workspace/statusbar';
import { mountSplitter } from '../src/workspace/splitter';

const node = (name: string, attributes: Record<string, unknown>, parent: ComposedNode | null = null): ComposedNode => ({
  path: `/${name}`,
  name,
  origin: name,
  attributes,
  children: [],
  parent,
} as unknown as ComposedNode);

describe('barra de estado', () => {
  it('hoverText: nombre · clase del primer ancestro clasificado', () => {
    const wall = node('Basic Wall', { 'bsi::ifc::class': { code: 'IfcWall' } });
    const body = node('Body', {}, wall);
    expect(hoverText(wall)).toBe('Basic Wall · IfcWall');
    expect(hoverText(body)).toBe('Basic Wall · IfcWall');
    expect(hoverText(node('Suelto', {}))).toBe('Suelto');
  });

  it('levelText: solo las plantas tienen nivel', () => {
    expect(levelText({ kind: 'plan', level: { path: '/n', name: 'Level 1', minZ: 0, maxZ: 3 } })).toBe('Level 1');
    expect(levelText({ kind: '3d' })).toBe('');
    expect(levelText({ kind: 'elevation', side: 'front' })).toBe('');
    expect(levelText(null)).toBe('');
  });

  it('mountStatusBar: default message, own message as text and level', () => {
    const el = document.createElement('div');
    const s = mountStatusBar(el);
    expect(STATUS_HINT).toBe('Click to select an element.');
    expect(el.querySelector('.ws-status-msg')!.textContent).toBe(STATUS_HINT);
    s.setMessage('<b>x</b>');
    expect(el.querySelector('.ws-status-msg')!.textContent).toBe('<b>x</b>');
    expect(el.querySelector('b')).toBeNull();
    s.setLevel('Level 2');
    expect(el.querySelector('.ws-status-level')!.textContent).toBe('Level 2');
    s.setMessage(null);
    expect(el.querySelector('.ws-status-msg')!.textContent).toBe(STATUS_HINT);
  });
});

describe('divisor', () => {
  it('dragging changes the size of the panel within the limits; the arrows too', () => {
    const target = document.createElement('div');
    const handle = document.createElement('div');
    document.body.replaceChildren(target, handle);
    mountSplitter(handle, { axis: 'x', target, min: 200, max: 500 });
    expect(handle.getAttribute('role')).toBe('separator');
    const ev = (type: string, clientX: number) =>
      handle.dispatchEvent(new PointerEvent(type, { clientX, button: 0, bubbles: true }));
    ev('pointerdown', 10);
    ev('pointermove', 310); // the initial size in happy-dom is 0: 0 + 300
    expect(target.style.flex).toBe('0 0 300px');
    ev('pointermove', 2000);
    expect(target.style.flex).toBe('0 0 500px');
    ev('pointerup', 2000);
    ev('pointermove', 50); // ya no arrastra
    expect(target.style.flex).toBe('0 0 500px');
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(target.style.flex).toBe('0 0 200px'); // 0 (happy-dom) + 16, clipped to the minimum
  });
});
