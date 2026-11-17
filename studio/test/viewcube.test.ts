import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  arrowTarget,
  compassTarget,
  cubeMatrix,
  faceMatrix,
  FACES,
  faceShade,
  faceZones,
  isFaceOn,
  mountViewCube,
  ringMatrix,
  zoneName,
} from '../src/workspace/viewcube';
import type { ViewName } from '../src/render/viewer';

/** Camera like the viewer's (Z up) looking at the origin from the direction of view(name). */
function cameraFrom(dir: [number, number, number]): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera();
  c.up.set(0, 0, 1);
  c.position.set(...dir).normalize().multiplyScalar(10);
  c.lookAt(0, 0, 0);
  return c;
}

const DIRS: Record<ViewName, [number, number, number]> = {
  iso: [1, -1, 0.8],
  top: [0, -0.0001, 1],
  front: [0, -1, 0],
  right: [1, 0, 0],
};

/** The rotation part of M·F must be the identity: the face is seen head-on and unrotated. */
function facesCamera(view: ViewName, label: string) {
  const face = FACES.find((f) => f.label === label)!;
  const m = cubeMatrix(cameraFrom(DIRS[view]).quaternion).multiply(faceMatrix(face));
  const e = m.elements;
  const rot = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  rot.forEach((v, i) => expect(v, `${label} [${i}]`).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 3));
}

describe('ViewCube: orientation', () => {
  it('it has the six faces in English', () => {
    expect(FACES.map((f) => f.label).sort()).toEqual(
      ['BACK', 'BOTTOM', 'FRONT', 'LEFT', 'RIGHT', 'TOP'].sort(),
    );
  });

  it('desde arriba se ve TOP de frente', () => facesCamera('top', 'TOP'));
  it('desde delante se ve FRONT de frente', () => facesCamera('front', 'FRONT'));
  it('desde la derecha se ve RIGHT de frente', () => facesCamera('right', 'RIGHT'));

  it('cada cara es un giro propio respecto al cubo (no un reflejo)', () => {
    for (const f of FACES) {
      const det = cubeMatrix(new THREE.Quaternion()).multiply(faceMatrix(f)).determinant();
      expect(det, f.label).toBeCloseTo(1, 6);
    }
  });

  it('the compass sits at the base, looking up and with north towards +Y', () => {
    const m = ringMatrix(50);
    const p = new THREE.Vector3();
    p.setFromMatrixPosition(m);
    expect(p.toArray()).toEqual([0, 0, -25]);
    // El borde superior del div (y negativo en CSS) apunta al norte.
    const north = new THREE.Vector3(0, -1, 0).transformDirection(m);
    expect(north.y).toBeCloseTo(1, 6);
    expect(cubeMatrix(new THREE.Quaternion()).multiply(m).determinant()).toBeCloseTo(1, 6);
  });

  it('in the isometric TOP is the lightest face and RIGHT the darkest of the visible ones', () => {
    const q = cameraFrom(DIRS.iso).quaternion;
    const shade = (label: string) => faceShade(FACES.find((f) => f.label === label)!.normal, q);
    expect(shade('TOP')).toBeLessThan(shade('FRONT'));
    expect(shade('FRONT')).toBeLessThan(shade('RIGHT'));
  });
});

describe('ViewCube: zones, arrows and compass', () => {
  it('26 zones: 6 faces, 12 edges and 8 vertices shared between faces', () => {
    const all = FACES.flatMap((f) => faceZones(f).map((z) => z.join(',')));
    expect(all).toHaveLength(54);
    const count = new Map<string, number>();
    for (const z of all) count.set(z, (count.get(z) ?? 0) + 1);
    expect(count.size).toBe(26);
    const hist = [...count.values()].reduce<Record<number, number>>((h, n) => ({ ...h, [n]: (h[n] ?? 0) + 1 }), {});
    expect(hist).toEqual({ 1: 6, 2: 12, 3: 8 });
  });

  it('it names the zones like Revit', () => {
    expect(zoneName([0, 0, 1])).toBe('Top');
    expect(zoneName([0, -1, 1])).toBe('Top Front');
    expect(zoneName([1, -1, 1])).toBe('Top Front Right');
    expect(zoneName([-1, 1, -1])).toBe('Bottom Back Left');
  });

  it('it detects the view facing a face (also the plan tilted a hair)', () => {
    expect(isFaceOn(cameraFrom(DIRS.top).quaternion)).toBe(true);
    expect(isFaceOn(cameraFrom(DIRS.right).quaternion)).toBe(true);
    expect(isFaceOn(cameraFrom(DIRS.iso).quaternion)).toBe(false);
  });

  it('las flechas llevan a la cara vecina de ese lado de la pantalla', () => {
    const right = cameraFrom(DIRS.right).quaternion; // desde el este: norte a la derecha
    expect(arrowTarget('up', right).toArray()).toEqual([0, 0, 1]);
    expect(arrowTarget('down', right).toArray()).toEqual([0, 0, -1]);
    expect(arrowTarget('right', right).toArray()).toEqual([0, 1, 0]);
    expect(arrowTarget('left', right).toArray()).toEqual([0, -1, 0]);
    const top = cameraFrom(DIRS.top).quaternion; // planta con el norte arriba
    expect(arrowTarget('up', top).toArray()).toEqual([0, 1, 0]);
    expect(arrowTarget('right', top).toArray()).toEqual([1, 0, 0]);
  });

  it('the compass turns towards the cardinal point keeping the elevation', () => {
    const iso = cameraFrom(DIRS.iso).quaternion;
    const n = compassTarget('N', iso);
    const elev = new THREE.Vector3(...DIRS.iso).normalize().z;
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeGreaterThan(0);
    expect(n.z).toBeCloseTo(elev, 6);
    // En planta se queda en planta, con ese lado abajo.
    const e = compassTarget('E', cameraFrom(DIRS.top).quaternion);
    expect(e.z).toBeGreaterThan(0.999);
    expect(e.x).toBeGreaterThan(0);
    expect(e.y).toBeCloseTo(0, 6);
  });
});

describe('ViewCube: montaje', () => {
  const mount = (dir = DIRS.iso) => {
    document.body.innerHTML = '<div id="h"></div>';
    const camera = cameraFrom(dir);
    const target = { camera, view: vi.fn(), orient: vi.fn() };
    const cube = mountViewCube(document.getElementById('h')!, target);
    return { target, cube, camera };
  };
  const face = (label: string) => document.querySelector<HTMLElement>(`[data-face="${label}"]`)!;
  const cell = (label: string, zone: string) =>
    face(label).querySelector<HTMLElement>(`[data-zone="${zone}"]`)!;
  const lastOrient = (target: { orient: ReturnType<typeof vi.fn> }) =>
    (target.orient.mock.lastCall![0] as THREE.Vector3).toArray();

  it('faces, edges and vertices orient the view; the house goes back to the isometric', () => {
    const { target } = mount();
    cell('TOP', '0,0,1').click();
    expect(lastOrient(target)).toEqual([0, 0, 1]);
    cell('BOTTOM', '0,0,-1').click();
    expect(lastOrient(target)).toEqual([0, 0, -1]);
    cell('FRONT', '0,-1,1').click(); // arista TOP-FRONT
    expect(lastOrient(target)).toEqual([0, -1, 1]);
    cell('RIGHT', '1,-1,1').click(); // vertex TOP-FRONT-RIGHT
    expect(lastOrient(target)).toEqual([1, -1, 1]);
    document.querySelector<HTMLButtonElement>('.viewcube-home')!.click();
    expect(target.view).toHaveBeenLastCalledWith('iso');
  });

  it('passing over an edge lights its cells on both faces', () => {
    mount();
    const a = cell('TOP', '0,-1,1');
    a.dispatchEvent(new Event('pointerenter'));
    expect(cell('FRONT', '0,-1,1').classList.contains('hot')).toBe(true);
    expect(cell('TOP', '0,0,1').classList.contains('hot')).toBe(false);
    a.dispatchEvent(new Event('pointerleave'));
    expect(document.querySelectorAll('.hot')).toHaveLength(0);
  });

  it('the arrows are only shown facing a face and rotate 90°', () => {
    const { target, cube, camera } = mount();
    const root = document.querySelector<HTMLElement>('.viewcube')!;
    expect(root.classList.contains('face-on')).toBe(false);
    camera.position.set(10, 0, 0);
    camera.lookAt(0, 0, 0);
    cube.update();
    expect(root.classList.contains('face-on')).toBe(true);
    document.querySelector<HTMLButtonElement>('.viewcube-arrow[data-dir="up"]')!.click();
    expect(lastOrient(target)).toEqual([0, 0, 1]);
  });

  it('the compass letters orient the view towards that side', () => {
    const { target } = mount();
    document.querySelector<HTMLElement>('.viewcube-compass[data-dir="W"]')!.click();
    const [x, y] = lastOrient(target);
    expect(x).toBeLessThan(0);
    expect(y).toBeCloseTo(0, 6);
  });

  it('update copies the rotation of the camera to the cube', () => {
    const { cube, camera } = mount();
    const el = document.querySelector<HTMLElement>('.viewcube-cube')!;
    const before = el.style.transform;
    expect(before).toMatch(/^matrix3d\(/);
    camera.position.set(0, -10, 0);
    camera.lookAt(0, 0, 0);
    cube.update();
    expect(el.style.transform).not.toBe(before);
  });

  it('it draws the N/E/S/W compass and shades the faces', () => {
    mount();
    const dirs = [...document.querySelectorAll<HTMLElement>('.viewcube-ring .viewcube-compass')];
    expect(dirs.map((d) => d.textContent)).toEqual(['N', 'E', 'S', 'W']);
    expect(face('TOP').style.getPropertyValue('--shade')).not.toBe('');
  });
});
