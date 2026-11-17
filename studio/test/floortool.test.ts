import { describe, expect, it } from 'vitest';
import { FloorTool } from '../src/modeling/floortool';
import type { WallAxis } from '../src/modeling/footprint';

const TOL = 0.05;
const ROOM: WallAxis[] = [
  { id: 's', start: [0, 0], end: [6, 0], thickness: 0.2 },
  { id: 'e', start: [6, 0], end: [6, 4], thickness: 0.2 },
  { id: 'n', start: [6, 4], end: [0, 4], thickness: 0.2 },
  { id: 'w', start: [0, 4], end: [0, 0], thickness: 0.2 },
];

const started = () => {
  const t = new FloorTool();
  t.start();
  return t;
};

describe('FloorTool', () => {
  it('start activates Pick Walls without lines', () => {
    const t = started();
    expect(t.active).toBe(true);
    expect(t.mode).toBe('pick');
    expect(t.lines).toEqual([]);
    expect(t.prompt).toBe('Pick walls to create lines.');
  });

  it('Pick Walls: cuatro muros elegidos por dentro cierran el contorno', () => {
    const t = started();
    for (const p of [[3, 0.05], [5.95, 2], [3, 3.95], [0.05, 2]] as [number, number][]) t.click(p, ROOM, TOL);
    expect(t.lines).toHaveLength(4);
    expect(t.finish().ok).toBe(true);
  });

  it('Pick Walls: choosing the same wall twice does not add a line', () => {
    const t = started();
    t.click([3, 0.05], ROOM, TOL);
    t.click([1, -0.05], ROOM, TOL); // el otro lado del mismo muro
    expect(t.lines).toHaveLength(1);
  });

  it('Pick Walls: move previsualiza la cara del lado del cursor', () => {
    const t = started();
    expect(t.move([3, 0.05], ROOM)).toEqual([[[0, 0.1], [6, 0.1]]]);
    expect(t.move([3, 2], ROOM)).toEqual([]); // fuera de cualquier muro
  });

  it('a click on a sketch line selects it and Del deletes it', () => {
    const t = started();
    t.click([3, 0.05], ROOM, TOL);
    const id = t.lines[0].id;
    t.click([3, 0.1], ROOM, TOL);
    expect(t.selected).toBe(id);
    expect(t.deleteSelected()).toBe(true);
    expect(t.lines).toHaveLength(0);
    expect(t.selected).toBeNull();
    expect(t.deleteSelected()).toBe(false);
  });

  it('Pick Walls: an unchosen wall wins over a nearby line (the corner does not steal the click)', () => {
    const t = started();
    t.click([3, 0.05], ROOM, TOL); // cara sur, termina en [5.9, 0.1]
    t.click([5.95, 0.12], ROOM, 0.2); // at 0.07 from that line, but inside the east wall
    expect(t.lines).toHaveLength(2);
    expect(t.selected).toBeNull();
  });

  it('Line encadena y avisa del siguiente punto', () => {
    const t = started();
    t.setMode('line');
    expect(t.prompt).toBe('Click to enter line start point.');
    t.click([0, 0], [], TOL);
    expect(t.prompt).toBe('Click to enter line end point.');
    t.click([2, 0], [], TOL);
    t.click([2, 2], [], TOL);
    expect(t.lines.map((l) => [l.a, l.b])).toEqual([[[0, 0], [2, 0]], [[2, 0], [2, 2]]]);
    expect(t.currentStart).toEqual([2, 2]);
    expect(t.chainStart).toEqual([0, 0]);
    expect(t.move([5, 5], [])).toEqual([[[2, 2], [5, 5]]]);
  });

  it('Line ignora un clic casi sobre el inicio', () => {
    const t = started();
    t.setMode('line');
    t.click([1, 1], [], TOL);
    t.click([1.0005, 1], [], TOL);
    expect(t.lines).toHaveLength(0);
    expect(t.currentStart).toEqual([1, 1]);
  });

  it('Line: volver al primer punto cierra la cadena', () => {
    const t = started();
    t.setMode('line');
    for (const p of [[0, 0], [4, 0], [4, 3], [0, 0]] as [number, number][]) t.click(p, [], TOL);
    expect(t.lines).toHaveLength(3);
    expect(t.currentStart).toBeNull();
  });

  it('Line: a click on the end of a line starts drawing instead of selecting', () => {
    const t = started();
    t.setMode('line');
    t.click([0, 0], [], TOL);
    t.click([4, 0], [], TOL);
    t.escape(); // corta la cadena
    t.click([4, 0.01], [], TOL);
    expect(t.selected).toBeNull();
    expect(t.currentStart).toEqual([4, 0.01]);
  });

  it('Esc: corta la cadena, deja la herramienta y sale del boceto', () => {
    const t = started();
    t.setMode('line');
    t.click([0, 0], [], TOL);
    t.click([2, 0], [], TOL);
    expect(t.escape()).toBe('chain-cut');
    expect(t.mode).toBe('line');
    expect(t.currentStart).toBeNull();
    expect(t.escape()).toBe('mode-off');
    expect(t.mode).toBeNull();
    expect(t.prompt).toBe('Select a line, or click Finish Edit Mode.');
    expect(t.escape()).toBe('exit');
    expect(t.active).toBe(false);
    expect(t.lines).toEqual([]);
  });

  it('Rectangle: two clicks add four lines', () => {
    const t = started();
    t.setMode('rect');
    expect(t.prompt).toBe('Click to enter rectangle start corner.');
    t.click([0, 0], [], TOL);
    expect(t.prompt).toBe('Click to enter rectangle opposite corner.');
    expect(t.move([4, 3], [])).toHaveLength(4);
    t.click([4, 3], [], TOL);
    expect(t.lines).toHaveLength(4);
    expect(t.lines.every((l) => l.source === 'rect')).toBe(true);
    expect(t.finish().ok).toBe(true);
  });

  it('cambiar de herramienta descarta la cadena en curso', () => {
    const t = started();
    t.setMode('line');
    t.click([0, 0], [], TOL);
    t.setMode('rect');
    expect(t.currentStart).toBeNull();
    expect(t.prompt).toBe('Click to enter rectangle start corner.');
  });

  it('finish con el contorno abierto no cambia nada', () => {
    const t = started();
    t.setMode('line');
    t.click([0, 0], [], TOL);
    t.click([2, 0], [], TOL);
    const r = t.finish();
    expect(r.ok).toBe(false);
    expect(t.active).toBe(true);
    expect(t.lines).toHaveLength(1);
  });

  it('finish with success deactivates the tool and returns the polygon', () => {
    const t = started();
    t.setMode('rect');
    t.click([0, 0], [], TOL);
    t.click([4, 3], [], TOL);
    const r = t.finish();
    expect(r.ok && r.polygon).toHaveLength(4);
    expect(t.active).toBe(false);
  });

  it('cancel descarta el boceto', () => {
    const t = started();
    t.setMode('rect');
    t.click([0, 0], [], TOL);
    t.click([4, 3], [], TOL);
    t.cancel();
    expect(t.active).toBe(false);
    expect(t.lines).toEqual([]);
    expect(t.prompt).toBeNull();
  });
});
