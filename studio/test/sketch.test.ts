import { describe, expect, it } from 'vitest';
import { polygonArea, type Vec2, type WallAxis } from '../src/modeling/footprint';
import { closeLoop, joinPicked, nearestLine, rectangle, wallAt, wallFace, type SketchLine } from '../src/modeling/sketch';

const wall = (id: string, start: Vec2, end: Vec2, thickness = 0.2): WallAxis => ({ id, start, end, thickness });
const line = (id: string, a: Vec2, b: Vec2, source: SketchLine['source'] = 'line'): SketchLine => ({ id, a, b, source });
const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
const sameSet = (got: Vec2[], want: Vec2[]) =>
  got.length === want.length && want.every((w) => got.some((g) => near(g, w)));

/** Walls of the 6 × 4 rectangle, by axis, with thickness 0.2. */
const ROOM = [
  wall('s', [0, 0], [6, 0]),
  wall('e', [6, 0], [6, 4]),
  wall('n', [6, 4], [0, 4]),
  wall('w', [0, 4], [0, 0]),
];
/** Un punto dentro de la sala, junto a cada muro: elige su cara interior. */
const INSIDE: Vec2[] = [[3, 0.05], [5.95, 2], [3, 3.95], [0.05, 2]];

function pickAllInside(): SketchLine[] {
  let lines: SketchLine[] = [];
  ROOM.forEach((w, i) => {
    const [a, b] = wallFace(w, INSIDE[i]);
    lines = joinPicked(lines, { id: w.id, a, b, source: 'pick', wallId: w.id, thickness: w.thickness });
  });
  return lines;
}

describe('wallAt y wallFace', () => {
  const w = wall('w', [0, 0], [4, 0]);
  it('wallAt devuelve el muro que contiene el punto y null fuera', () => {
    expect(wallAt([w], [2, 0.05])).toBe(w);
    expect(wallAt([w], [2, 0.5])).toBeNull();
  });
  it('wallAt picks the wall with the nearest axis', () => {
    const b = wall('b', [0, 0.1], [4, 0.1]);
    expect(wallAt([w, b], [2, 0.09])).toBe(b);
  });
  it('wallFace da la cara del lado del punto, con la longitud del eje', () => {
    expect(wallFace(w, [2, 0.05])).toEqual([[0, 0.1], [4, 0.1]]);
    expect(wallFace(w, [2, -0.05])).toEqual([[0, -0.1], [4, -0.1]]);
  });
});

describe('joinPicked', () => {
  it('cuatro muros elegidos por dentro cierran el contorno sin retoques', () => {
    const r = closeLoop(pickAllInside());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sameSet(r.polygon, [[0.1, 0.1], [5.9, 0.1], [5.9, 3.9], [0.1, 3.9]])).toBe(true);
    expect(polygonArea(r.polygon)).toBeGreaterThan(0);
  });

  it('it does not join when the intersection is far from the ends', () => {
    const a: SketchLine = { id: 'a', a: [0, 0.1], b: [2, 0.1], source: 'pick', wallId: 'a', thickness: 0.2 };
    const b: SketchLine = { id: 'b', a: [3, 0], b: [3, 4], source: 'pick', wallId: 'b', thickness: 0.2 };
    const out = joinPicked([a], b);
    expect(out.find((l) => l.id === 'a')!.b).toEqual([2, 0.1]);
    expect(out.find((l) => l.id === 'b')!.a).toEqual([3, 0]);
  });

  it('it only touches lines chosen with Pick Walls', () => {
    const a = line('a', [0, 0.1], [5.9, 0.1], 'line');
    const b: SketchLine = { id: 'b', a: [6, 0], b: [6, 4], source: 'pick', wallId: 'b', thickness: 0.2 };
    const out = joinPicked([a], b);
    expect(out.find((l) => l.id === 'a')!.b).toEqual([5.9, 0.1]);
    expect(out.find((l) => l.id === 'b')!.a).toEqual([6, 0]);
  });

  it('no modifica la lista original', () => {
    const a: SketchLine = { id: 'a', a: [0, 0.1], b: [6, 0.1], source: 'pick', wallId: 'a', thickness: 0.2 };
    const b: SketchLine = { id: 'b', a: [5.9, 0], b: [5.9, 4], source: 'pick', wallId: 'b', thickness: 0.2 };
    const orig = [a];
    joinPicked(orig, b);
    expect(orig[0].b).toEqual([6, 0.1]);
  });
});

describe('closeLoop', () => {
  const square = (): SketchLine[] => [
    line('1', [0, 0], [4, 0]),
    line('2', [4, 0], [4, 3]),
    line('3', [4, 3], [0, 3]),
    line('4', [0, 3], [0, 0]),
  ];

  it('it accepts any order and direction, and returns the counterclockwise polygon', () => {
    const sq = square();
    const scrambled = [sq[2], { ...sq[0], a: sq[0].b, b: sq[0].a }, sq[3], sq[1]];
    const r = closeLoop(scrambled);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(polygonArea(r.polygon)).toBeCloseTo(12);
      expect(sameSet(r.polygon, [[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(true);
    }
  });

  it('a clockwise boundary also comes out counterclockwise', () => {
    const cw = [
      line('1', [0, 0], [0, 3]),
      line('2', [0, 3], [4, 3]),
      line('3', [4, 3], [4, 0]),
      line('4', [4, 0], [0, 0]),
    ];
    const r = closeLoop(cw);
    expect(r.ok && polygonArea(r.polygon) > 0).toBe(true);
  });

  it('it removes collinear vertices', () => {
    const lines = [...square().slice(1), line('a', [0, 0], [2, 0]), line('b', [2, 0], [4, 0])];
    const r = closeLoop(lines);
    expect(r.ok && r.polygon.length).toBe(4);
  });

  it('une extremos a menos de JOIN_TOLERANCE y no a 1 cm', () => {
    const near1 = square();
    near1[1] = { ...near1[1], a: [4.0005, 0] };
    expect(closeLoop(near1).ok).toBe(true);
    const far = square();
    far[1] = { ...far[1], a: [4.01, 0] };
    expect(closeLoop(far).ok).toBe(false);
  });

  it('it rejects a lone line and points it out', () => {
    const r = closeLoop([...square(), line('x', [10, 10], [11, 10])]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.open).toContain('x');
  });

  it('rechaza dos cuadrados separados', () => {
    const second = square().map((l) => ({
      ...l,
      id: `b${l.id}`,
      a: [l.a[0] + 10, l.a[1]] as Vec2,
      b: [l.b[0] + 10, l.b[1]] as Vec2,
    }));
    const r = closeLoop([...square(), ...second]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.open).toHaveLength(8);
  });

  it('it rejects a figure eight (crossing without a vertex)', () => {
    const r = closeLoop([
      line('1', [0, 0], [2, 2]),
      line('2', [2, 2], [2, 0]),
      line('3', [2, 0], [0, 2]),
      line('4', [0, 2], [0, 0]),
    ]);
    expect(r.ok).toBe(false);
  });

  it('in an open U it points out the lines of the free ends', () => {
    const r = closeLoop(square().slice(0, 3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.open.sort()).toEqual(['1', '3']);
  });

  it('an empty list does not close', () => {
    expect(closeLoop([])).toEqual({ ok: false, open: [] });
  });
});

describe('rectangle', () => {
  it('da cuatro segmentos que forman un lazo', () => {
    const segs = rectangle([0, 0], [2, 1])!;
    expect(segs).toHaveLength(4);
    const r = closeLoop(segs.map(([a, b], i) => line(String(i), a, b, 'rect')));
    expect(r.ok && polygonArea(r.polygon)).toBeCloseTo(2);
  });
  it('null si ancho o alto son casi cero', () => {
    expect(rectangle([0, 0], [2, 0])).toBeNull();
    expect(rectangle([0, 0], [0.0005, 3])).toBeNull();
  });
});

describe('nearestLine', () => {
  const lines = [line('a', [0, 0], [4, 0]), line('b', [0, 2], [4, 2])];
  it('it returns the line within tol', () => {
    expect(nearestLine(lines, [2, 0.1], 0.2)).toBe('a');
    expect(nearestLine(lines, [2, 1.95], 0.2)).toBe('b');
  });
  it('null beyond tol', () => {
    expect(nearestLine(lines, [2, 1], 0.2)).toBeNull();
  });
});
