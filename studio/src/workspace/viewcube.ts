// ViewCube: a CSS 3D cube that copies the camera orientation (Z up), with an N/E/S/W compass
// at its base. Faces, edges and vertices orient the view; facing a face, some arrows rotate 90°
// to the neighboring face; the compass letters rotate to that cardinal point and the home
// button returns to the isometric view.
import * as THREE from 'three';
import type { ViewName } from '../render/viewer';
import { svgIcon } from '../shell/icons';

export const CUBE_SIZE = 50;

type V3 = [number, number, number];

export interface CubeFace {
  label: string;
  /** World axes of the face seen from the front: right on screen, down on screen and outward normal. */
  right: V3;
  down: V3;
  normal: V3;
}

// IFC world: X east, Y north, Z up. FRONT looks from -Y (like view('front')) and RIGHT from +X.
export const FACES: CubeFace[] = [
  { label: 'TOP', right: [1, 0, 0], down: [0, -1, 0], normal: [0, 0, 1] },
  { label: 'BOTTOM', right: [1, 0, 0], down: [0, 1, 0], normal: [0, 0, -1] },
  { label: 'FRONT', right: [1, 0, 0], down: [0, 0, -1], normal: [0, -1, 0] },
  { label: 'BACK', right: [-1, 0, 0], down: [0, 0, -1], normal: [0, 1, 0] },
  { label: 'RIGHT', right: [0, 1, 0], down: [0, 0, -1], normal: [1, 0, 0] },
  { label: 'LEFT', right: [0, -1, 0], down: [0, 0, -1], normal: [-1, 0, 0] },
];

/**
 * Zones of a face in a 3×3 grid: the center is the face, the bands are edges and the corners
 * vertices. Each cell's view direction is normal + i·right + j·down, so cells of different
 * faces that touch the same edge or vertex share a direction.
 */
export function faceZones(f: CubeFace): V3[] {
  const zones: V3[] = [];
  for (const j of [-1, 0, 1]) {
    for (const i of [-1, 0, 1]) {
      zones.push([0, 1, 2].map((k) => f.normal[k] + i * f.right[k] + j * f.down[k]) as V3);
    }
  }
  return zones;
}

/** Name of a zone in Revit order: Top/Bottom, Front/Back, Left/Right. */
export function zoneName([x, y, z]: V3): string {
  const parts = [
    z > 0 ? 'Top' : z < 0 ? 'Bottom' : '',
    y < 0 ? 'Front' : y > 0 ? 'Back' : '',
    x < 0 ? 'Left' : x > 0 ? 'Right' : '',
  ];
  return parts.filter(Boolean).join(' ');
}

/** Takes the plane of a div (x right, y down, z outward) to the given axes, offset to `at`. */
function planeMatrix(r: V3, d: V3, n: V3, at: V3): THREE.Matrix4 {
  // prettier-ignore
  return new THREE.Matrix4().set(
    r[0], d[0], n[0], at[0],
    r[1], d[1], n[1], at[1],
    r[2], d[2], n[2], at[2],
    0, 0, 0, 1,
  );
}

/** Face matrix: takes the div plane to its place in the world. */
export function faceMatrix(f: CubeFace, size = CUBE_SIZE): THREE.Matrix4 {
  const h = size / 2;
  const n = f.normal;
  return planeMatrix(f.right, f.down, n, [n[0] * h, n[1] * h, n[2] * h]);
}

/** Compass matrix: horizontal, at the height of the cube base and with north (+Y) up. */
export function ringMatrix(size = CUBE_SIZE): THREE.Matrix4 {
  return planeMatrix([1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -size / 2]);
}

/**
 * Cube matrix: the inverse camera rotation (world → camera) followed by the change to CSS,
 * which has Y down. Thus a face seen from the front stays unrotated on screen.
 */
export function cubeMatrix(cameraQuaternion: THREE.Quaternion): THREE.Matrix4 {
  const view = new THREE.Matrix4().makeRotationFromQuaternion(cameraQuaternion).transpose();
  return new THREE.Matrix4().makeScale(1, -1, 1).multiply(view);
}

/** Fixed light in camera space (x right, y up, z towards the observer): upper left. */
const LIGHT = new THREE.Vector3(-0.35, 0.75, 0.55).normalize();

/** Shading of a face (0 = full light) based on how it faces the light from the current camera. */
export function faceShade(normal: V3, cameraQuaternion: THREE.Quaternion): number {
  const n = new THREE.Vector3(...normal).applyQuaternion(cameraQuaternion.clone().invert());
  return +((1 - Math.max(0, n.dot(LIGHT))) * 0.28).toFixed(3);
}

/** World axis (±X, ±Y or ±Z) closest to `v`. */
function snapAxis(v: THREE.Vector3): THREE.Vector3 {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const k = a.indexOf(Math.max(...a));
  return new THREE.Vector3().setComponent(k, Math.sign(v.getComponent(k)));
}

/** Camera direction (from the target towards the camera) in world space. */
const backward = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);

/** Does the camera look straight at a cube face? (plan, elevations...) */
export function isFaceOn(q: THREE.Quaternion): boolean {
  const b = backward(q);
  return Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.z)) > 0.9995;
}

export type ArrowDir = 'up' | 'down' | 'left' | 'right';

/** View an arrow leads to: the neighboring face on that side of the screen. */
export function arrowTarget(dir: ArrowDir, q: THREE.Quaternion): THREE.Vector3 {
  const screen: Record<ArrowDir, V3> = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  return snapAxis(new THREE.Vector3(...screen[dir]).applyQuaternion(q));
}

/** Cardinal points in world space; each letter's foot points outward from the ring. */
const COMPASS = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] } as const;
export type CompassDir = keyof typeof COMPASS;

/**
 * View a compass letter rotates to: the camera moves to that side keeping the elevation.
 * In plan it stays slightly tilted so that side is at the bottom of the screen.
 */
export function compassTarget(dir: CompassDir, q: THREE.Quaternion): THREE.Vector3 {
  const [cx, cy] = COMPASS[dir];
  const el = Math.asin(THREE.MathUtils.clamp(backward(q).z, -1, 1));
  const h = Math.max(Math.cos(el), 1e-3);
  return new THREE.Vector3(cx * h, cy * h, Math.sin(el)).normalize();
}

const css = (m: THREE.Matrix4) => `matrix3d(${m.elements.map((v) => +v.toFixed(6)).join(',')})`;

export interface ViewCubeTarget {
  readonly camera: THREE.Camera;
  view(name: ViewName): void;
  /** Looks at the target from that world direction. */
  orient(dir: THREE.Vector3): void;
}

export interface ViewCube {
  /** Copies the current camera orientation (also done on every frame). */
  update(): void;
}

export interface ViewCubeOptions {
  /** Right click on the cube (like Revit: its menu, with the perspective/parallel switch). */
  onContextMenu?: (anchor: HTMLElement) => void;
}

export function mountViewCube(host: HTMLElement, target: ViewCubeTarget, opts: ViewCubeOptions = {}): ViewCube {
  const root = document.createElement('div');
  root.className = 'viewcube';
  const q = () => target.camera.quaternion;

  const home = document.createElement('button');
  home.type = 'button';
  home.className = 'viewcube-home';
  home.title = 'Home';
  home.setAttribute('aria-label', 'Home');
  home.appendChild(svgIcon('home', 14));
  home.addEventListener('click', () => target.view('iso'));

  const stage = document.createElement('div');
  stage.className = 'viewcube-stage';
  const cube = document.createElement('div');
  cube.className = 'viewcube-cube';

  const ring = document.createElement('div');
  ring.className = 'viewcube-ring';
  ring.style.transform = css(ringMatrix());
  for (const dir of Object.keys(COMPASS) as CompassDir[]) {
    const letter = document.createElement('span');
    letter.className = 'viewcube-compass';
    letter.dataset.dir = dir;
    letter.textContent = dir;
    letter.addEventListener('click', () => target.orient(compassTarget(dir, q())));
    ring.appendChild(letter);
  }
  cube.appendChild(ring);

  // Hovering a cell lights all cells of its zone (an edge touches two faces).
  const light = (zone: string, on: boolean) => {
    for (const el of cube.querySelectorAll(`[data-zone="${zone}"]`)) el.classList.toggle('hot', on);
  };
  const faces: [HTMLElement, CubeFace][] = [];
  for (const f of FACES) {
    const face = document.createElement('div');
    face.className = 'viewcube-face';
    face.dataset.face = f.label;
    face.style.transform = css(faceMatrix(f));
    for (const z of faceZones(f)) {
      const cell = document.createElement('div');
      const zone = z.join(',');
      cell.className = 'viewcube-cell';
      cell.dataset.zone = zone;
      cell.title = zoneName(z);
      cell.addEventListener('pointerenter', () => light(zone, true));
      cell.addEventListener('pointerleave', () => light(zone, false));
      cell.addEventListener('click', () => target.orient(new THREE.Vector3(...z)));
      face.appendChild(cell);
    }
    const label = document.createElement('span');
    label.className = 'viewcube-label';
    label.textContent = f.label;
    face.appendChild(label);
    cube.appendChild(face);
    faces.push([face, f]);
  }
  stage.appendChild(cube);

  const arrows = (['up', 'down', 'left', 'right'] as ArrowDir[]).map((dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'viewcube-arrow';
    b.dataset.dir = dir;
    b.title = 'Rotate 90°';
    b.setAttribute('aria-label', `Rotate ${dir}`);
    b.addEventListener('click', () => target.orient(arrowTarget(dir, q())));
    return b;
  });

  root.append(home, stage, ...arrows);
  root.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    opts.onContextMenu?.(root);
  });
  host.appendChild(root);

  let last = '';
  const update = () => {
    const t = css(cubeMatrix(q()));
    if (t === last) return;
    last = t;
    cube.style.transform = t;
    root.classList.toggle('face-on', isFaceOn(q()));
    for (const [el, f] of faces) el.style.setProperty('--shade', String(faceShade(f.normal, q())));
  };
  const frame = () => {
    if (!root.isConnected) return; // unmounted: stop the loop
    update();
    requestAnimationFrame(frame);
  };
  update();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
  return { update };
}
