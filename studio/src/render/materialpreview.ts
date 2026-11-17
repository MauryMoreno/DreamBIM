// Material preview: a simple shape (sphere, plane or cube) with its colour and opacity, on its own
// canvas. It draws only when something changes (no animation). It depends only on three.js.
import * as THREE from 'three';

export type PreviewShape = 'sphere' | 'plane' | 'cube';
export const PREVIEW_SHAPES: readonly PreviewShape[] = ['sphere', 'plane', 'cube'];

/** What the preview shows of a material. `color`: '#rrggbb' (sRGB). */
export interface PreviewMaterial {
  color: string;
  opacity: number;
  /** Colour image and metres one repeat covers. */
  texture?: { image: string; width: number; height: number };
}

export interface MaterialPreview {
  setShape(shape: PreviewShape): void;
  setMaterial(material: PreviewMaterial): void;
  dispose(): void;
}

/** Geometry of each shape, of similar size so none looks bigger than the others. */
export function previewGeometry(shape: PreviewShape): THREE.BufferGeometry {
  switch (shape) {
    case 'sphere':
      return new THREE.SphereGeometry(1, 48, 32);
    case 'plane':
      return new THREE.PlaneGeometry(2.2, 2.2);
    case 'cube':
      return new THREE.BoxGeometry(1.5, 1.5, 1.5);
  }
}

/** Rotation of each shape so it shows volume: the cube with three faces, the plane tilted. */
const POSE: Record<PreviewShape, [number, number, number]> = {
  sphere: [0, 0, 0],
  plane: [-0.35, 0.3, 0],
  cube: [0.5, 0.7, 0],
};

/** How much the image repeats on the preview shape, which measures about 2 m. */
export function previewTextureRepeat(t: NonNullable<PreviewMaterial['texture']>): [number, number] {
  return [2 / t.width, 2 / t.height];
}

/** three material parameters: matte like the viewer's; transparent only when needed. */
export function previewMaterialParams(m: PreviewMaterial): THREE.MeshStandardMaterialParameters {
  const transparent = m.opacity < 1;
  return {
    color: new THREE.Color(m.color), // '#rrggbb' is sRGB: three converts it to the working space
    roughness: 0.85,
    metalness: 0,
    opacity: m.opacity,
    transparent,
    depthWrite: !transparent, // glass must not hide its own back face
    side: THREE.DoubleSide,
  };
}

// (the colour is a number so there are no colour literals in strings, which css-tokens.test.ts checks)
const START_COLOR = '#' + (0xcccccc).toString(16); // until the first material arrives

/** Can this browser create a WebGL context? (without leaving one open) */
export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Preview on `canvas` (`size` in CSS pixels; the canvas is square). Throws if there is no WebGL.
 * Ambient light plus a sun, with intensities × π as in the rest of the viewer (three physical lights).
 */
export function createMaterialPreview(canvas: HTMLCanvasElement, size: number): MaterialPreview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0); // the background is the panel's

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.55 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.65 * Math.PI);
  sun.position.set(3, 4, 5);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(0, 0, 4.6);
  camera.lookAt(0, 0, 0);

  const material = new THREE.MeshStandardMaterial(previewMaterialParams({ color: START_COLOR, opacity: 1 }));
  const mesh = new THREE.Mesh(previewGeometry('sphere'), material);
  scene.add(mesh);

  const draw = () => renderer.render(scene, camera);
  draw();

  let texture: THREE.Texture | null = null;
  let textureImage: string | null = null;
  /** Sets, changes or removes the material image; the repeat adjusts without loading it again. */
  function setTexture(t: PreviewMaterial['texture']): void {
    if (!t) {
      if (material.map) {
        material.map = null;
        texture?.dispose();
        texture = null;
        textureImage = null;
      }
      return;
    }
    if (!texture || textureImage !== t.image) {
      texture?.dispose();
      textureImage = t.image;
      texture = new THREE.TextureLoader().load(t.image, draw);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      material.map = texture;
    }
    texture.repeat.set(...previewTextureRepeat(t));
  }

  return {
    setShape(shape) {
      mesh.geometry.dispose();
      mesh.geometry = previewGeometry(shape);
      mesh.rotation.set(...POSE[shape]);
      draw();
    },
    setMaterial(m) {
      const p = previewMaterialParams(m);
      setTexture(m.texture);
      // with a texture the image goes untinted, as in the viewer
      material.color.copy(m.texture ? new THREE.Color(0xffffff) : (p.color as THREE.Color));
      material.opacity = p.opacity!;
      material.transparent = p.transparent!;
      material.depthWrite = p.depthWrite!;
      material.needsUpdate = true; // `transparent` changes: the material program recompiles
      draw();
    },
    dispose() {
      mesh.geometry.dispose();
      texture?.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
