// Per-element colour above the element's own material (e.g. "colour by material" in Studio).
// No WebGL, so it can be tested in node.
import * as THREE from 'three';
import type { ComposedNode } from '../ifcx/types';

export interface ElementColor {
  color: string;
  opacity: number;
}

/** Colour of an element by its composed path; null = its own material. */
export type ColorFn = (elementPath: string) => ElementColor | null;

export class ColorOverride {
  private fn: ColorFn | null = null;
  /** Temporary Assistant colours: they go above `fn` (the modes). */
  private top: ReadonlyMap<string, ElementColor> | null = null;
  /** Colours saved in the model (colour sidecar): below the modes, per element. */
  private saved: ReadonlyMap<string, ElementColor> | null = null;
  private cache = new Map<string, THREE.MeshStandardMaterial>();

  set(fn: ColorFn | null): void {
    this.fn = fn;
  }

  setTop(colors: ReadonlyMap<string, ElementColor> | null): void {
    this.top = colors;
  }

  setSaved(colors: ReadonlyMap<string, ElementColor> | null): void {
    this.saved = colors;
  }

  get active(): boolean {
    return this.fn !== null || this.top !== null || this.saved !== null;
  }

  /** Material of the element, or null when there is no override or it does not colour it. Same colour and opacity, same object. */
  materialFor(elementPath: string | null): THREE.MeshStandardMaterial | null {
    if (elementPath === null) return null;
    const c = this.top?.get(elementPath) ?? this.fn?.(elementPath) ?? this.saved?.get(elementPath);
    if (!c) return null;
    const key = `${c.color}|${c.opacity}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(c.color),
        roughness: 0.8,
        side: THREE.DoubleSide,
        transparent: c.opacity < 1,
        opacity: c.opacity,
        depthWrite: c.opacity >= 1,
      });
      this.cache.set(key, m);
    }
    return m;
  }

  all(): THREE.Material[] {
    return [...this.cache.values()];
  }

  /** Frees the created materials (the override itself is kept). */
  clearCache(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

/**
 * `code` of the effective material of a mesh: the element's if it has one (it wins over its parts') and
 * otherwise the mesh's own; null if neither.
 */
export function effectiveMaterialCode(element: ComposedNode | undefined, mesh: ComposedNode | undefined): string | null {
  const code = (n: ComposedNode | undefined): string | null => {
    const m = n?.attributes['bsi::ifc::material'] as { code?: unknown } | undefined;
    return typeof m?.code === 'string' ? m.code : null;
  };
  return code(element) ?? code(mesh);
}
