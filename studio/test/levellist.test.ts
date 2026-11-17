import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LevelInfo } from '../src/render/levels';
import { layoutScale, mountLevelList } from '../src/workspace/levellist';

const L: LevelInfo[] = [
  { path: '/a', name: 'Level 1', minZ: 0, maxZ: 3 },
  { path: '/b', name: 'Level 2', minZ: 3.25, maxZ: 6 },
  { path: '/c', name: 'Roof', minZ: 6.5, maxZ: 7 },
];
const lv = (path: string, minZ: number): LevelInfo => ({ path, name: path, minZ, maxZ: minZ + 1 });

describe('layoutScale', () => {
  it('without levels there is nothing to draw', () => {
    expect(layoutScale([])).toEqual({ height: 0, ticks: [], items: [] });
  });

  it('one mark per whole meter, from top to bottom, covering all the levels', () => {
    const s = layoutScale(L); // 0 … 6,5 → regla de 0 a 7 m
    expect(s.ticks.map((t) => t.meters)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    const ys = s.ticks.map((t) => t.y);
    const paso = ys[1] - ys[0];
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(paso); // escala uniforme
    expect(s.ticks.every((t) => t.label === String(t.meters))).toBe(true);
  });

  it('cada nivel va exactamente a su cota en la regla', () => {
    const s = layoutScale(L);
    const yDe = (m: number) => s.ticks.find((t) => t.meters === m)!.y;
    const roof = s.items.find((i) => i.level.path === '/c')!;
    expect(roof.y).toBeCloseTo((yDe(6) + yDe(7)) / 2); // 6,5 m: a mitad entre 6 y 7
    const l2 = s.items.find((i) => i.level.path === '/b')!;
    expect(l2.y).toBeCloseTo(yDe(3) + (yDe(4) - yDe(3)) * 0.25); // 3,25 m: un cuarto de camino de 3 a 4
    expect(s.items.map((i) => i.level.path)).toEqual(['/c', '/b', '/a']); // de arriba abajo
  });

  it('with a large range the numbers go every 2, 5 or 10 m so as not to crowd', () => {
    const s = layoutScale([lv('/a', 0), lv('/b', 60)]);
    const rotuladas = s.ticks.filter((t) => t.label !== null);
    for (let i = 1; i < rotuladas.length; i++) expect(rotuladas[i].y - rotuladas[i - 1].y).toBeGreaterThanOrEqual(14);
    expect(rotuladas.map((t) => t.meters)).toContain(0);
    expect(rotuladas.every((t) => t.meters % 10 === 0)).toBe(true);
  });

  it('negative elevations and a single level', () => {
    const s = layoutScale([lv('/s', -2.5), lv('/g', 0)]);
    expect(s.ticks.map((t) => t.meters)).toEqual([0, -1, -2, -3]);
    const uno = layoutScale([lv('/g', 3)]);
    expect(uno.ticks.map((t) => t.meters)).toEqual([4, 3]);
    expect(uno.items[0].y).toBeCloseTo(uno.ticks[1].y);
  });

  it('dos niveles casi a la misma cota: la marca va a su cota y el nombre se separa', () => {
    const s = layoutScale([lv('/a', 3), lv('/b', 3.05)]);
    const [b, a] = s.items;
    expect(Math.abs(b.y - a.y)).toBeLessThan(5); // las marcas, a su cota real
    expect(a.labelY - b.labelY).toBeGreaterThanOrEqual(14); // los nombres, sin pisarse
  });
});

describe('mountLevelList', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="h"></div>';
    host = document.getElementById('h')!;
  });
  const rows = () => [...host.querySelectorAll<HTMLElement>('.level-list .level-item')];
  const ticks = () => [...host.querySelectorAll<HTMLElement>('.level-list .level-tick')];

  it('un clic en un nivel avisa con su ruta', () => {
    const onSelect = vi.fn();
    mountLevelList(host, onSelect).update(L, []);
    rows().find((r) => r.dataset.path === '/b')!.click();
    expect(onSelect).toHaveBeenCalledWith('/b');
  });

  it('dibuja la regla de metros y los niveles de arriba abajo', () => {
    mountLevelList(host).update(L, []);
    expect(ticks().map((t) => t.textContent)).toEqual(['7', '6', '5', '4', '3', '2', '1', '0']);
    expect(rows().map((r) => r.querySelector('.level-item-name')!.textContent)).toEqual(['Roof', 'Level 2', 'Level 1']);
    expect(host.querySelector('.level-list')!.getAttribute('aria-label')).toBe('Levels');
  });

  it('each level carries its exact elevation to show it on hover', () => {
    mountLevelList(host).update(L, []);
    const l2 = rows()[1];
    expect(l2.querySelector('.level-item-z')!.textContent).toBe('3.250 m');
    expect(l2.getAttribute('aria-label')).toBe('Level 2: 3.250 m');
    expect(l2.title).toBe('');
  });

  it('el alto de la regla se ajusta al contenido', () => {
    const list = mountLevelList(host);
    list.update(L, []);
    expect(parseFloat(host.querySelector<HTMLElement>('.level-list')!.style.height)).toBeGreaterThan(40);
  });

  it('resalta los niveles indicados', () => {
    mountLevelList(host).update(L, ['/b']);
    expect(rows().filter((r) => r.classList.contains('active')).map((r) => r.dataset.path)).toEqual(['/b']);
  });

  it('a new update replaces the previous one', () => {
    const list = mountLevelList(host);
    list.update(L, ['/a']);
    list.update(L.slice(0, 1), []);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].classList.contains('active')).toBe(false);
  });

  it('sin niveles queda oculta', () => {
    const list = mountLevelList(host);
    list.update(L, []);
    expect(host.querySelector<HTMLElement>('.level-list')!.hidden).toBe(false);
    list.update([], []);
    expect(host.querySelector<HTMLElement>('.level-list')!.hidden).toBe(true);
  });

  it('es de solo lectura y pinta el nombre como texto', () => {
    mountLevelList(host).update([{ path: '/x', name: '<b>x</b>', minZ: 0, maxZ: 1 }], []);
    expect(host.querySelector('b')).toBeNull();
    expect(host.querySelector('button, input, a')).toBeNull();
    expect(rows()[0].querySelector('.level-item-name')!.textContent).toBe('<b>x</b>');
  });
});
