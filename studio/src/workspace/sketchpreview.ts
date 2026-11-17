// Lines of a floor sketch, in magenta on the level plane (like Revit). They are drawn on top of
// everything and in any visual style; the selection and lines with a loose end are blue.
import * as THREE from 'three';
import type { Vec2 } from '../modeling/footprint';
import type { SketchLine } from '../modeling/sketch';
import type { PreviewHost } from './wallpreview';

/** Elevation above the level elevation, same as the wall preview (m). */
const Z_OFFSET = 0.02;
const MAGENTA = 0xd600d6;
const HOT = 0x1a73e8;
/** Above the wall preview (renderOrder 10). */
const RENDER_ORDER = 20;

export interface SketchPreview {
  /** The sketch lines; `selected` and `open` (loose ends) are highlighted. */
  setLines(lines: readonly SketchLine[], z: number, opts?: { selected?: string | null; open?: string[] }): void;
  /** Segments of the running tool (the rubber band); empty removes them. */
  setRubber(segments: readonly [Vec2, Vec2][], z: number): void;
  /** Removes everything and releases the GPU. */
  clear(): void;
}

export function createSketchPreview(host: PreviewHost): SketchPreview {
  const objects = new Map<string, THREE.LineSegments>();

  const remove = (name: string): void => {
    const o = objects.get(name);
    if (!o) return;
    host.scene.remove(o);
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
    objects.delete(name);
  };

  /** Creates, updates or removes (if there are no segments) the object `name`. */
  const show = (name: string, color: number, segments: readonly [Vec2, Vec2][], z: number): void => {
    if (!segments.length) return remove(name);
    const zz = z + Z_OFFSET;
    const pts = segments.flatMap(([a, b]) => [a[0], a[1], zz, b[0], b[1], zz]);
    let o = objects.get(name);
    if (!o) {
      o = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
      );
      o.name = name;
      o.renderOrder = RENDER_ORDER;
      o.frustumCulled = false;
      host.scene.add(o);
      objects.set(name, o);
    }
    o.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    o.geometry.computeBoundingSphere();
  };

  return {
    setLines(lines, z, opts = {}) {
      const hot = new Set([...(opts.open ?? []), ...(opts.selected ? [opts.selected] : [])]);
      const seg = (l: SketchLine): [Vec2, Vec2] => [l.a, l.b];
      show('sketch-lines', MAGENTA, lines.filter((l) => !hot.has(l.id)).map(seg), z);
      show('sketch-hot', HOT, lines.filter((l) => hot.has(l.id)).map(seg), z);
      host.requestRender();
    },
    setRubber(segments, z) {
      show('sketch-rubber', MAGENTA, segments, z);
      host.requestRender();
    },
    clear() {
      for (const name of [...objects.keys()]) remove(name);
      host.requestRender();
    },
  };
}
