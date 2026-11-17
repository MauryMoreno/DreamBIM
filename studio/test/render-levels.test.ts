import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { animOffset, focusRole, orthoDistance, sortLevels, type LevelInfo } from '../src/render/levels';

const lv = (name: string, minZ: number): LevelInfo => ({ path: `/${name}`, name, minZ, maxZ: minZ + 3 });

describe('sortLevels', () => {
  it('ordena por minZ ascendente', () => {
    const out = sortLevels([lv('P2', 6), lv('P0', 0), lv('P1', 3)]);
    expect(out.map(l => l.name)).toEqual(['P0', 'P1', 'P2']);
  });

  it('con el mismo minZ desempata por nombre', () => {
    const out = sortLevels([lv('B', 0), lv('C', -3), lv('A', 0)]);
    expect(out.map(l => l.name)).toEqual(['C', 'A', 'B']);
  });

  it('no modifica la lista de entrada', () => {
    const input = [lv('P1', 3), lv('P0', 0)];
    sortLevels(input);
    expect(input.map(l => l.name)).toEqual(['P1', 'P0']);
  });
});

describe('orthoDistance', () => {
  it('mantiene el encuadre: dist · tan(fov/2) no cambia', () => {
    const d = orthoDistance(10, 45, 2);
    const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
    expect(d * half(2)).toBeCloseTo(10 * half(45), 9);
    expect(d).toBeGreaterThan(10);
  });

  it('ida y vuelta devuelve la distancia original', () => {
    expect(orthoDistance(orthoDistance(7.5, 45, 2), 2, 45)).toBeCloseTo(7.5, 9);
  });
});

describe('animOffset', () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const o = v(0, 0, 0);

  it('rodea el objetivo: a mitad de un giro de 90° la distancia se conserva', () => {
    const mid = animOffset({ from: v(0, -10, 0), to: v(0, 0, 10), tFrom: o, tTo: o }, 0.5);
    expect(mid.length()).toBeCloseTo(10, 6);
    expect(mid.y).toBeCloseTo(-10 * Math.SQRT1_2, 6);
    expect(mid.z).toBeCloseTo(10 * Math.SQRT1_2, 6);
  });

  it('empieza y acaba en los extremos e interpola la distancia', () => {
    const a = { from: v(10, 0, 0), to: v(0, 20, 0), tFrom: o, tTo: o };
    expect(animOffset(a, 0).toArray()).toEqual([10, 0, 0]);
    const end = animOffset(a, 1);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(20, 6);
    expect(animOffset(a, 0.5).length()).toBeCloseTo(15, 6);
  });

  it('un giro de 180° en horizontal rodea por el lado, no por el objetivo', () => {
    const mid = animOffset({ from: v(0, -10, 0), to: v(0, 10, 0), tFrom: o, tTo: o }, 0.5);
    expect(mid.length()).toBeCloseTo(10, 6);
  });
});

describe('focusRole', () => {
  const f = { current: '/p/b/l2', underlay: ['/p/b/l1', '/p/b/l3'] };

  it('the current level and everything that hangs from it look normal', () => {
    expect(focusRole('/p/b/l2', f)).toBe('current');
    expect(focusRole('/p/b/l2/muro/Body', f)).toBe('current');
  });

  it('los niveles de debajo y de encima, atenuados', () => {
    expect(focusRole('/p/b/l1/muro', f)).toBe('underlay');
    expect(focusRole('/p/b/l3', f)).toBe('underlay');
  });

  it('los antepasados se mantienen (sin ellos no se ve nada) y el resto se oculta', () => {
    expect(focusRole('/p', f)).toBe('ancestor');
    expect(focusRole('/p/b', f)).toBe('ancestor');
    expect(focusRole('/p/b/l4/muro', f)).toBe('hidden');
    expect(focusRole('/p/b/l22', f)).toBe('hidden'); // prefijo de texto, no de ruta
  });
});
