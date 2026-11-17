// Visual styles (like Revit's): each style's material is derived from the element's original material
// and cached. No WebGL, so it can be tested in node.
import * as THREE from 'three';

export type VisualStyle = 'wireframe' | 'hidden' | 'shaded' | 'consistent' | 'textures';

type WithColor = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };

export class StyleMaterials {
  private cache = new Map<THREE.Material, Map<VisualStyle, THREE.Material>>();
  /** Hidden Line faces: the view background colour (white in the light theme). */
  private hiddenColor = 0xffffff;

  /** Does the style draw the element edges? (like Revit: all but Textures) */
  static showsEdges(style: VisualStyle): boolean {
    return style !== 'textures';
  }

  /** Material `base` is drawn with in `style` (`base` itself when no other is needed). */
  get(base: THREE.Material, style: VisualStyle): THREE.Material {
    if (style === 'textures') return base;
    const b = base as WithColor;
    let byStyle = this.cache.get(base);
    if (!byStyle) this.cache.set(base, (byStyle = new Map()));
    let m = byStyle.get(style);
    if (!m) byStyle.set(style, (m = derive(b, style, this.hiddenColor)));
    return m;
  }

  /** Colour of the Hidden Line faces (the theme background); it also applies to those already created. */
  setHiddenColor(hex: number): void {
    this.hiddenColor = hex;
    for (const byStyle of this.cache.values()) (byStyle.get('hidden') as THREE.MeshBasicMaterial | undefined)?.color.setHex(hex);
  }

  /** Derived materials that exist now (to clip them with the section, for instance). */
  all(): THREE.Material[] {
    return [...this.cache.values()].flatMap((m) => [...m.values()]);
  }

  /** Frees the derived materials (on a model change); the originals are not its own. */
  dispose(): void {
    for (const m of this.all()) m.dispose();
    this.cache.clear();
  }
}

function derive(base: WithColor, style: VisualStyle, hiddenColor: number): THREE.Material {
  switch (style) {
    case 'shaded':
      // Lambert with the SHADED_LIGHT light, no environment reflections and no tone mapping (like Revit)
      return new THREE.MeshLambertMaterial({
        color: shadingColor(base),
        transparent: base.transparent,
        opacity: base.opacity,
        depthWrite: base.depthWrite,
        side: base.side,
        toneMapped: false,
      });
    case 'consistent':
      return new THREE.MeshBasicMaterial({
        color: shadingColor(base),
        transparent: base.transparent,
        opacity: base.opacity,
        side: base.side,
        toneMapped: false,
      });
    case 'hidden':
      // opaque faces of the background colour: only the edges are read, and they hide what is behind
      return new THREE.MeshBasicMaterial({ color: hiddenColor, side: base.side });
    case 'wireframe':
      return new THREE.MeshBasicMaterial({ visible: false });
    default:
      return base;
  }
}

/**
 * Shading colour: the IFC diffuseColor comes in sRGB (Revit's), but the viewer loads it as linear;
 * here it is reinterpreted so 0.75 grey looks 0.75 and not almost white. A glTF material with a
 * texture brings its node's diffuseColor in `shadeColor`: its own colour is the white that does not
 * tint the image, and in the colour styles the IFC colour shows.
 */
function shadingColor(base: WithColor): THREE.Color {
  const shade = base.userData.shadeColor as number[] | undefined;
  if (shade) return new THREE.Color(shade[0], shade[1], shade[2]).convertSRGBToLinear();
  const c = base.color?.clone() ?? new THREE.Color(0xffffff);
  return base.userData.srgbColor ? c.convertSRGBToLinear() : c;
}

/**
 * Shaded light, measured in Revit captures: a 0.75 grey wall looks 0.30 on faces away from the sun,
 * 0.68 on faces beside it and white on top. The sun is relative to the view: high (70°) and 45°
 * between the camera right and the camera itself. Intensities × π because three no longer applies
 * it (physical lights).
 */
export const SHADED_LIGHT = { ambient: 0.137 * Math.PI, sun: 1.88 * Math.PI, elevation: (70 * Math.PI) / 180 };

const Z = new THREE.Vector3(0, 0, 1);

/** Shaded sun direction for a camera looking towards `forward` (and `up` as fallback in plan). */
export function shadedSunDir(forward: THREE.Vector3, up: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  // towards the camera, horizontally; in plan (looking down) the screen "up" is used
  const back = new THREE.Vector3(-forward.x, -forward.y, 0);
  if (back.lengthSq() < 1e-8) back.set(-up.x, -up.y, 0);
  back.normalize();
  const right = new THREE.Vector3().crossVectors(Z, back); // Z × towards-camera = right
  const h = Math.cos(SHADED_LIGHT.elevation) * Math.SQRT1_2;
  return out.copy(right).multiplyScalar(h).addScaledVector(back, h).addScaledVector(Z, Math.sin(SHADED_LIGHT.elevation));
}
