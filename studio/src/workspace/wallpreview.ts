// Preview of the wall in progress: the start/end rectangle ± thickness/2 at the level elevation.
import * as THREE from 'three';
import type { Vec2 } from '../modeling/footprint';
import { WALL_THICKNESS } from '../modeling/constants';

/** Elevation above the level elevation so the stroke does not flicker against the floor (m). */
const Z_OFFSET = 0.02;
const COLOR = 0x1a73e8;
/** Dashes of the orthogonal guide line (m). */
const GUIDE_DASH = 0.15;
const GUIDE_GAP = 0.1;

export interface WallPreview {
  show(start: Vec2, end: Vec2, z: number): void;
  /** Dashed guide line from `start` along `through`, twice the segment. */
  showGuide(start: Vec2, through: Vec2, z: number): void;
  clearGuide(): void;
  /** Removes the rectangle and the guide. */
  clear(): void;
}

/** What the preview needs from the viewer (lets it be tested with a fake viewer). */
export interface PreviewHost {
  scene: THREE.Scene;
  requestRender(): void;
}

export function createWallPreview(host: PreviewHost): WallPreview {
  let line: THREE.LineLoop | null = null;
  let guide: THREE.Line | null = null;

  const disposeObject = (o: THREE.Line): void => {
    host.scene.remove(o);
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  };

  const clearGuide = (): void => {
    if (!guide) return;
    disposeObject(guide);
    guide = null;
    host.requestRender();
  };

  const clear = (): void => {
    clearGuide();
    if (!line) return;
    disposeObject(line);
    line = null;
    host.requestRender();
  };

  return {
    clear,
    clearGuide,
    showGuide(start, through, z) {
      const dx = through[0] - start[0];
      const dy = through[1] - start[1];
      if (Math.hypot(dx, dy) < 1e-6) return clearGuide();
      const zz = z + Z_OFFSET;
      const pts = [start[0], start[1], zz, start[0] + 2 * dx, start[1] + 2 * dy, zz];
      if (!guide) {
        guide = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineDashedMaterial({ color: COLOR, dashSize: GUIDE_DASH, gapSize: GUIDE_GAP }),
        );
        guide.name = 'wall-guide';
        guide.renderOrder = 10;
        host.scene.add(guide);
      }
      guide.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      guide.geometry.computeBoundingSphere();
      guide.computeLineDistances();
      host.requestRender();
    },
    show(start, end, z) {
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return clear();
      const h = WALL_THICKNESS / 2;
      const nx = (-dy / len) * h;
      const ny = (dx / len) * h;
      const zz = z + Z_OFFSET;
      const pts = [
        start[0] + nx, start[1] + ny, zz,
        end[0] + nx, end[1] + ny, zz,
        end[0] - nx, end[1] - ny, zz,
        start[0] - nx, start[1] - ny, zz,
      ];
      if (!line) {
        line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOR }));
        line.renderOrder = 10;
        host.scene.add(line);
      }
      line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      line.geometry.computeBoundingSphere();
      host.requestRender();
    },
  };
}
