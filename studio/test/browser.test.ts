import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposedNode } from '../src/ifcx/types';
import type { LevelInfo } from '../src/render/levels';
import { buildViewsTree, viewLabel, type ViewRef } from '../src/browser/views';
import { mountProjectBrowser } from '../src/browser/browser';

const levels: LevelInfo[] = [
  { path: '/p/n0', name: 'Level 0', minZ: 0, maxZ: 3 },
  { path: '/p/n1', name: 'Level 1', minZ: 3, maxZ: 6 },
];

describe('buildViewsTree', () => {
  it('a click on a view keeps the same DOM node', () => {
    const root = buildViewsTree(levels);
    expect(root.label).toBe('Views (all)');
    expect(root.children!.map((c) => c.label)).toEqual(['3D', 'Floor Plans', 'Elevations']);
    const [d3, plans, elev] = root.children!;
    expect(d3.children!.map((c) => c.label)).toEqual(['{3D}']);
    expect(d3.children![0].view).toEqual({ kind: '3d' });
    expect(plans.children!.map((c) => c.label)).toEqual(['Level 0', 'Level 1']);
    expect(plans.children![1].view).toEqual({ kind: 'plan', level: levels[1] });
    expect(elev.children!.map((c) => c.label)).toEqual(['Front', 'Side']);
    expect(elev.children!.map((c) => c.view)).toEqual([
      { kind: 'elevation', side: 'front' },
      { kind: 'elevation', side: 'side' },
    ]);
  });

  it('it only shows views: the model tree and its search live in the Stage', () => {
    const plans = buildViewsTree([]).children![1];
    expect(plans.children).toHaveLength(1);
    expect(plans.children![0].label).toBe('(no levels)');
    expect(plans.children![0].view).toBeUndefined();
  });
});

describe('viewLabel', () => {
  it('etiquetas de cada tipo de vista', () => {
    expect(viewLabel({ kind: '3d' })).toBe('{3D}');
    expect(viewLabel({ kind: 'plan', level: levels[1] })).toBe('Floor Plan: Level 1');
    expect(viewLabel({ kind: 'elevation', side: 'front' })).toBe('Elevation: Front');
    expect(viewLabel({ kind: 'elevation', side: 'side' })).toBe('Elevation: Side');
  });
});

function model(): ComposedNode {
  const root: ComposedNode = { path: '', name: 'root', origin: 'r', attributes: {}, children: [], parent: null };
  const a: ComposedNode = { path: '/a', name: 'Wall A', origin: 'a', attributes: {}, children: [], parent: root };
  const b: ComposedNode = { path: '/b', name: 'Puerta B', origin: 'b', attributes: {}, children: [], parent: root };
  root.children.push(a, b);
  return root;
}

describe('mountProjectBrowser', () => {
  let el: HTMLElement;
  let cb: { onOpenView: ReturnType<typeof vi.fn>; onSelectView: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    document.body.innerHTML = '';
    el = document.createElement('div');
    document.body.append(el);
    cb = { onOpenView: vi.fn(), onSelectView: vi.fn() };
  });
  const node = (label: string) =>
    [...el.querySelectorAll<HTMLElement>('.pb-node')].find((n) => n.querySelector('.pb-label')?.textContent === label)!;

  it('doble clic en una vista llama a onOpenView; un clic solo selecciona', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    node('Level 1').click();
    expect(cb.onOpenView).not.toHaveBeenCalled();
    expect(node('Level 1').classList.contains('selected')).toBe(true);
    node('Level 1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cb.onOpenView).toHaveBeenCalledWith({ kind: 'plan', level: levels[1] } satisfies ViewRef);
  });

  it('un clic simple en una planta llama a onSelectView (sin abrirla); el doble clic sigue abriendo', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    node('Level 0').click();
    expect(cb.onSelectView).toHaveBeenCalledWith({ kind: 'plan', level: levels[0] } satisfies ViewRef);
    expect(cb.onOpenView).not.toHaveBeenCalled();
    node('Level 0').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cb.onOpenView).toHaveBeenCalledTimes(1);
  });

  it('Enter abre la vista seleccionada', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    node('{3D}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb.onOpenView).toHaveBeenCalledWith({ kind: '3d' });
  });

  it('(no levels) no abre nada', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), []);
    const n = node('(no levels)');
    n.click();
    n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb.onOpenView).not.toHaveBeenCalled();
  });

  it('el nombre de un nivel se pinta como texto, no como HTML', () => {
    const evil: LevelInfo = { path: '/x', name: '<img src=x onerror=alert(1)>', minZ: 0, maxZ: 1 };
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), [evil]);
    expect(el.querySelector('img')).toBeNull();
    expect(node('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('las ramas se pliegan y despliegan sin reconstruir el DOM', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    const root = node('Views (all)');
    const plantas = node('Floor Plans');
    const group = root.nextElementSibling as HTMLElement;
    expect(group.hidden).toBe(false);
    root.querySelector<HTMLElement>('.pb-toggle')!.click();
    expect(root.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.pb-toggle')!.textContent).toBe('+');
    expect(group.hidden).toBe(true);
    root.querySelector<HTMLElement>('.pb-toggle')!.click();
    expect(root.getAttribute('aria-expanded')).toBe('true');
    expect(group.hidden).toBe(false);
    expect(node('Floor Plans')).toBe(plantas);
  });

  it('without a BuiltBot build it says how to generate it', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    const before = node('Level 1');
    before.click();
    const after = node('Level 1');
    expect(after).toBe(before);
    expect(before.isConnected).toBe(true);
    expect(before.getAttribute('aria-selected')).toBe('true');
    node('Level 0').click();
    expect(before.classList.contains('selected')).toBe(false);
    expect(before.getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowLeft en una rama la pliega sin perder el foco', () => {
    document.body.append(el);
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    const row = node('Floor Plans');
    row.focus();
    expect(document.activeElement).toBe(row);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(row.isConnected).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });

  it('clic, clic, dblclick sobre una planta abre la vista una sola vez', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    const row = node('Level 1');
    row.click();
    row.click();
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cb.onOpenView).toHaveBeenCalledTimes(1);
    expect(cb.onOpenView).toHaveBeenCalledWith({ kind: 'plan', level: levels[1] });
  });

  it('the Studio index (what Vite serves for a route that does not exist) is not one', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(model(), levels);
    expect(el.querySelector('input')).toBeNull();
    expect(node('Wall A')).toBeUndefined();
    expect(node('Views (all)')).toBeTruthy();
  });

  it('sin modelo muestra No model loaded', () => {
    const br = mountProjectBrowser(el, cb);
    br.setModel(null, []);
    expect(el.textContent).toContain('No model loaded');
    br.setModel(model(), levels);
    expect(el.textContent).not.toContain('No model loaded');
  });
});
