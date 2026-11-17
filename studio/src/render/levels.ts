// Storeys (IfcBuildingStorey) and pure camera maths, no WebGL: so they can be tested in node.
import * as THREE from 'three';

export interface LevelInfo {
  path: string;
  name: string;
  minZ: number; // lower elevation of the storey box, without explosion (metres)
  maxZ: number;
}

/** Storey plan: `current` shows normally; `underlay` (neighbouring storeys), dimmed. Storey paths. */
export interface LevelFocus {
  current: string;
  underlay: string[];
}

export type FocusRole = 'current' | 'underlay' | 'ancestor' | 'hidden';

const within = (path: string, root: string) => path === root || path.startsWith(root + '/');

/** Role of a node in a storey plan; the ancestors of the shown storeys are kept. */
export function focusRole(path: string, f: LevelFocus): FocusRole {
  if (within(path, f.current)) return 'current';
  if (f.underlay.some((u) => within(path, u))) return 'underlay';
  if ([f.current, ...f.underlay].some((p) => p.startsWith(path + '/'))) return 'ancestor';
  return 'hidden';
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  projection: 'perspective' | 'orthographic';
}

/** Sorted copy, bottom to top; at the same elevation, by name ("Level 2" before "Level 10"). */
export function sortLevels(levels: LevelInfo[]): LevelInfo[] {
  return [...levels].sort((a, b) => a.minZ - b.minZ || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * Distance to the target that keeps the framing when the fov changes (degrees):
 * dist' = dist · tan(fromFov/2) / tan(toFov/2).
 */
export function orthoDistance(dist: number, fromFov: number, toFov: number): number {
  const half = (deg: number) => Math.tan((deg * Math.PI) / 360);
  return (dist * half(fromFov)) / half(toFov);
}

/**
 * Near and far planes that follow the distance to the target: near keeps what is close to the camera
 * from being cut when zooming in, far always covers the whole model.
 */
export function clipRange(distance: number, modelDiagonal: number): { near: number; far: number } {
  return { near: Math.max(distance / 1e4, 1e-3), far: Math.max(distance * 100, modelDiagonal * 10) };
}

/**
 * Camera minus target offset at fraction k (0...1) of an animation: the direction turns along the
 * shortest arc (the camera orbits the target instead of crossing it) and the distance interpolates
 * in a straight line.
 */
export function animOffset(
  a: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3 },
  k: number,
): THREE.Vector3 {
  const o0 = a.from.clone().sub(a.tFrom);
  const o1 = a.to.clone().sub(a.tTo);
  const [d0, d1] = [o0.length(), o1.length()];
  if (d0 === 0 || d1 === 0) return o0.lerp(o1, k);
  const turn = new THREE.Quaternion().setFromUnitVectors(o0.clone().normalize(), o1.clone().normalize());
  const q = new THREE.Quaternion().slerp(turn, k);
  return o0.normalize().applyQuaternion(q).multiplyScalar(d0 + (d1 - d0) * k);
}
