import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ViewerCore } from '../src/render/viewer/core';
import { ViewerGrid } from '../src/render/viewer/grid';

/** Grid subsystem without WebGL: only the objects it uses and requestRender. */
function bare(extent: number | null = null) {
  const core = { scene: new THREE.Scene(), requestRender: () => {} } as unknown as ViewerCore;
  const v = new ViewerGrid(core, new THREE.Box3()) as any;
  v.setEmptyGrid(extent);
  return v;
}

/** [center, line] of the grid: the color with fewer vertices is the center line (2 lines), the most repeated one the rest. */
function gridColors(g: THREE.GridHelper): [number, number] {
  const c = g.geometry.getAttribute('color');
  const count = new Map<number, number>();
  for (let i = 0; i < c.count; i++) {
    const hex = new THREE.Color().setRGB(c.getX(i), c.getY(i), c.getZ(i)).getHex();
    count.set(hex, (count.get(hex) ?? 0) + 1);
  }
  const sorted = [...count.entries()].sort((x, y) => x[1] - y[1]);
  return [sorted[0][0], sorted[sorted.length - 1][0]];
}

describe('setGridColors', () => {
  it('by default the grid uses the usual colors', () => {
    const v = bare(40);
    v.setEmptyGrid(40);
    const [center, line] = gridColors(v.grid!);
    expect(center).toBe(new THREE.Color(0x8a94a3).getHex());
    expect(line).toBe(new THREE.Color(0xc4cad3).getHex());
  });

  it('rehace la rejilla existente con los colores nuevos', () => {
    const v = bare(40);
    v.setEmptyGrid(40);
    const before = v.grid;
    v.setGridColors(0x445566, 0x2a3038);
    expect(v.grid).not.toBe(before);
    const [center, line] = gridColors(v.grid!);
    expect(center).toBe(new THREE.Color(0x445566).getHex());
    expect(line).toBe(new THREE.Color(0x2a3038).getHex());
  });

  it('without a grid it saves the colors for next time and keeps the visibility', () => {
    const v = bare(null);
    v.setGridColors(0x445566, 0x2a3038);
    expect(v.grid).toBeNull();
    v.setGrid(false);
    v.setEmptyGrid(40);
    expect(gridColors(v.grid!)[0]).toBe(new THREE.Color(0x445566).getHex());
    expect(v.grid!.visible).toBe(false);
  });
});
