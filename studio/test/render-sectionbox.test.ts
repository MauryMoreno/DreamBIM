import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { closestOnAxis, MIN_BOX_SIZE, SectionBox } from '../src/render/sectionbox';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const unit = () => new THREE.Box3(v(0, 0, 0), v(10, 6, 3));

function boxOf(onChange = () => {}) {
  const b = new SectionBox(onChange);
  b.setBounds(unit());
  return b;
}

describe('closestOnAxis', () => {
  it('finds the position along the axis under the pointer ray', () => {
    // X axis through the origin; vertical ray that crosses it at x = 4
    expect(closestOnAxis(v(4, 0, 10), v(0, 0, -1), v(0, 0, 0), v(1, 0, 0))).toBeCloseTo(4);
    // oblique ray that passes 2 m high over the axis: it still gives the nearest x
    expect(closestOnAxis(v(7, 0, 2), v(0, 0, -1), v(0, 0, 0), v(1, 0, 0))).toBeCloseTo(7);
  });

  it('returns null when the ray is parallel to the axis', () => {
    expect(closestOnAxis(v(0, 1, 0), v(1, 0, 0), v(0, 0, 0), v(1, 0, 0))).toBeNull();
  });
});

describe('SectionBox', () => {
  it('starts hidden and wraps the bounds with a small margin', () => {
    const b = boxOf();
    expect(b.visible).toBe(false);
    expect(b.box.min.x).toBeLessThan(0);
    expect(b.box.max.z).toBeGreaterThan(3);
    for (const p of [v(0, 0, 0), v(10, 6, 3), v(5, 3, 1.5)]) expect(b.contains(p)).toBe(true);
  });

  it('keeps what is inside and clips what is outside each face', () => {
    const b = boxOf();
    b.setFace(0, 5); // cara +X en x = 5
    expect(b.contains(v(4, 3, 1))).toBe(true);
    expect(b.contains(v(6, 3, 1))).toBe(false);
    b.setFace(5, 1); // cara -Z en z = 1
    expect(b.contains(v(4, 3, 0.5))).toBe(false);
    expect(b.contains(v(4, 3, 2))).toBe(true);
  });

  it('matches the horizontal section: a +Z face at z keeps what is below', () => {
    const b = boxOf();
    b.setFace(4, 2);
    expect(b.planes[4].normal.z).toBe(-1);
    expect(Math.abs(b.planes[4].normal.x) + Math.abs(b.planes[4].normal.y)).toBe(0);
    expect(b.planes[4].constant).toBeCloseTo(2);
  });

  it('never lets a face cross the opposite one, nor leave the allowed reach', () => {
    const b = boxOf();
    b.setFace(0, -100); // +X por debajo de -X
    expect(b.box.max.x).toBeCloseTo(b.box.min.x + MIN_BOX_SIZE);
    const b2 = boxOf();
    b2.setFace(0, 1000);
    expect(b2.box.max.x).toBeLessThan(15); // 10 m + a quarter of the size
    b2.setFace(1, -1000);
    expect(b2.box.min.x).toBeGreaterThan(-5);
  });

  it('notifies each change', () => {
    const onChange = vi.fn();
    const b = boxOf(onChange);
    b.setFace(2, 3);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('drags a face along its axis from the pointer ray', () => {
    const b = boxOf();
    b.setVisible(true);
    const ray = (x: number) => {
      const r = new THREE.Raycaster();
      r.ray.origin.set(x, 3, 50); // mirando hacia abajo, a la altura media de la caja
      r.ray.direction.set(0, 0, -1);
      return r;
    };
    const start = b.box.max.x;
    expect(b.beginDrag(0, ray(start))).toBe(true);
    expect(b.dragging).toBe(true);
    b.moveDrag(ray(start - 4));
    expect(b.box.max.x).toBeCloseTo(start - 4);
    b.endDrag();
    expect(b.dragging).toBe(false);
  });

  it('finds a face handle under the ray only while visible', () => {
    const b = boxOf();
    const r = new THREE.Raycaster();
    const face = b.box.max.x;
    r.ray.origin.set(face + 5, 3, 1.5);
    r.ray.direction.set(-1, 0, 0);
    expect(b.hitHandle(r)).toBeNull();
    b.setVisible(true);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(30, 30, 30);
    b.updateScale(cam, v(5, 3, 1.5));
    b.root.updateMatrixWorld(true);
    expect(b.hitHandle(r)).toBe(0);
  });
});
