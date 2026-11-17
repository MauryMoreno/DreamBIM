import * as THREE from 'three';
import type { Vec2 } from './footprint';
import { JOIN_TOLERANCE } from './constants';

export type WallToolResult = { kind: 'wall'; start: Vec2; end: Vec2 } | null;

type Estado = 'inactive' | 'waitingStart' | 'waitingEnd';

/** Wall tool: pure state machine, no DOM. */
export class WallTool {
  private state: Estado = 'inactive';
  private from: Vec2 | null = null;
  private first: Vec2 | null = null;
  /** Chain (Options Bar): each wall starts where the previous one ended. Without it, each wall takes two clicks. */
  chain = true;

  /** Inicio del muro en curso (null si se espera el primer punto). */
  get currentStart(): Vec2 | null {
    return this.state === 'waitingEnd' ? this.from : null;
  }

  /** First point of the chain in progress (for the closing snap); null outside a chain. */
  get chainStart(): Vec2 | null {
    return this.first;
  }

  get active(): boolean {
    return this.state !== 'inactive';
  }

  /** Activa la herramienta y espera el punto inicial. */
  start(): void {
    this.state = 'waitingStart';
    this.from = null;
    this.first = null;
  }

  /** 1.º clic fija el inicio; el siguiente devuelve un muro y, con `chain`, encadena el siguiente. */
  click(p: Vec2): WallToolResult {
    if (this.state === 'waitingStart') {
      this.from = [p[0], p[1]];
      this.first = [p[0], p[1]];
      this.state = 'waitingEnd';
      return null;
    }
    if (this.state === 'waitingEnd' && this.from) {
      if (Math.hypot(p[0] - this.from[0], p[1] - this.from[1]) < JOIN_TOLERANCE) return null;
      const start = this.from;
      const end: Vec2 = [p[0], p[1]];
      if (this.chain) this.from = end;
      else this.cutChain();
      return { kind: 'wall', start, end };
    }
    return null;
  }

  /** Preview of the wall in progress. */
  move(p: Vec2): { start: Vec2; end: Vec2 } | null {
    if (this.state !== 'waitingEnd' || !this.from) return null;
    return { start: this.from, end: [p[0], p[1]] };
  }

  /** Corta la cadena en curso: vuelve a esperar un punto de inicio (sin efecto si ya lo espera). */
  cutChain(): void {
    if (this.state !== 'waitingEnd') return;
    this.state = 'waitingStart';
    this.from = null;
    this.first = null;
  }

  /** With a fixed start it cuts the chain; without it, it leaves the tool. */
  escape(): 'chain-cut' | 'exit' {
    if (this.state === 'waitingEnd') {
      this.cutChain();
      return 'chain-cut';
    }
    this.cancel();
    return 'exit';
  }

  /** Leaves without more (change of view or of document). */
  cancel(): void {
    this.state = 'inactive';
    this.from = null;
    this.first = null;
  }

  /** Status bar text according to the state. */
  get prompt(): string | null {
    if (this.state === 'waitingStart') return 'Click to enter wall start point.';
    if (this.state === 'waitingEnd') return 'Click to enter wall end point. Esc to finish.';
    return null;
  }
}

/** Intersects the camera ray through the NDC with the plane z; null if it is parallel or lies behind. */
export function pointOnLevel(
  ndc: { x: number; y: number },
  camera: THREE.Camera,
  z: number,
): Vec2 | null {
  camera.updateMatrixWorld();
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const plano = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  const hit = rc.ray.intersectPlane(plano, new THREE.Vector3());
  return hit ? [hit.x, hit.y] : null;
}
