import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WallTool, pointOnLevel } from '../src/modeling/walltool';

describe('WallTool', () => {
  it('encadena muros con clics sucesivos', () => {
    const t = new WallTool();
    t.start();
    expect(t.click([0, 0])).toBeNull();
    expect(t.click([4, 0])).toEqual({ kind: 'wall', start: [0, 0], end: [4, 0] });
    expect(t.click([4, 3])).toEqual({ kind: 'wall', start: [4, 0], end: [4, 3] });
  });

  it('ignora un clic sobre el inicio y lo conserva', () => {
    const t = new WallTool();
    t.start();
    t.click([1, 1]);
    expect(t.click([1.0005, 1])).toBeNull();
    expect(t.click([3, 1])).toEqual({ kind: 'wall', start: [1, 1], end: [3, 1] });
  });

  it('move solo previsualiza con inicio fijado', () => {
    const t = new WallTool();
    t.start();
    expect(t.move([1, 1])).toBeNull();
    t.click([0, 0]);
    expect(t.move([2, 2])).toEqual({ start: [0, 0], end: [2, 2] });
  });

  it('escape corta la cadena y luego sale', () => {
    const t = new WallTool();
    t.start();
    t.click([0, 0]);
    t.click([1, 0]);
    expect(t.escape()).toBe('chain-cut');
    expect(t.active).toBe(true);
    expect(t.click([5, 5])).toBeNull();
    expect(t.click([6, 5])).toEqual({ kind: 'wall', start: [5, 5], end: [6, 5] });
    t.escape();
    expect(t.escape()).toBe('exit');
    expect(t.active).toBe(false);
  });

  it('prompt according to the state', () => {
    const t = new WallTool();
    expect(t.prompt).toBeNull();
    t.start();
    expect(t.prompt).toBe('Click to enter wall start point.');
    t.click([0, 0]);
    expect(t.prompt).toBe('Click to enter wall end point. Esc to finish.');
    t.cancel();
    expect(t.active).toBe(false);
    expect(t.prompt).toBeNull();
  });
});

describe('pointOnLevel', () => {
  it('a top camera gives the point on the plane', () => {
    const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    cam.up.set(0, 1, 0);
    cam.position.set(2, 3, 10);
    cam.lookAt(2, 3, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const p = pointOnLevel({ x: 0, y: 0 }, cam, 0)!;
    expect(p[0]).toBeCloseTo(2);
    expect(p[1]).toBeCloseTo(3);
  });

  it('devuelve null si el rayo es paralelo al plano', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    cam.up.set(0, 0, 1);
    cam.position.set(0, 0, 5);
    cam.lookAt(10, 0, 5);
    cam.updateMatrixWorld();
    expect(pointOnLevel({ x: 0, y: 0 }, cam, 0)).toBeNull();
  });
});

describe('WallTool: chainStart', () => {
  it('se fija en el primer clic y se conserva al encadenar', () => {
    const t = new WallTool();
    t.start();
    expect(t.chainStart).toBeNull();
    t.click([1, 2]);
    t.click([4, 2]);
    t.click([4, 5]);
    expect(t.chainStart).toEqual([1, 2]);
    expect(t.currentStart).toEqual([4, 5]);
  });

  it('se reinicia con Esc (corte), salida, cancel y start', () => {
    const t = new WallTool();
    t.start();
    t.click([1, 2]);
    t.escape();
    expect(t.chainStart).toBeNull();
    t.click([3, 3]);
    expect(t.chainStart).toEqual([3, 3]);
    t.cancel();
    expect(t.chainStart).toBeNull();
    t.start();
    t.click([5, 5]);
    t.start();
    expect(t.chainStart).toBeNull();
    t.escape();
    expect(t.chainStart).toBeNull();
  });
});

describe('WallTool sin cadena', () => {
  it('cada muro son dos clics y luego vuelve a pedir un inicio nuevo', () => {
    const t = new WallTool();
    t.chain = false;
    t.start();
    expect(t.click([0, 0])).toBeNull();
    expect(t.click([4, 0])).toEqual({ kind: 'wall', start: [0, 0], end: [4, 0] });
    expect(t.currentStart).toBeNull();
    expect(t.chainStart).toBeNull();
    expect(t.prompt).toBe('Click to enter wall start point.');
    expect(t.click([10, 10])).toBeNull();
    expect(t.click([14, 10])).toEqual({ kind: 'wall', start: [10, 10], end: [14, 10] });
    expect(t.active).toBe(true);
  });

  it('cutChain corta la cadena en curso y no hace nada sin inicio', () => {
    const t = new WallTool();
    t.start();
    t.cutChain();
    expect(t.prompt).toBe('Click to enter wall start point.');
    t.click([0, 0]);
    t.click([4, 0]);
    t.cutChain();
    expect(t.currentStart).toBeNull();
    expect(t.chainStart).toBeNull();
    expect(t.active).toBe(true);
  });
});
