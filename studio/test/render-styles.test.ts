import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { shadedSunDir, StyleMaterials } from '../src/render/styles';

const conTextura = () =>
  new THREE.MeshStandardMaterial({ color: 0x336699, map: new THREE.Texture(), transparent: true, opacity: 0.5 });

describe('StyleMaterials', () => {
  it('Textures usa el material original tal cual', () => {
    const base = conTextura();
    expect(new StyleMaterials().get(base, 'textures')).toBe(base);
  });

  it('Shaded: Lambert sin textura ni tone mapping, con el color y la transparencia del original', () => {
    const base = conTextura();
    const m = new StyleMaterials().get(base, 'shaded') as THREE.MeshLambertMaterial;
    expect(m).not.toBe(base);
    expect(m).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(m.map).toBeNull();
    expect(m.toneMapped).toBe(false);
    expect(m.color.getHex()).toBe(0x336699);
    expect(m.opacity).toBe(0.5);
    expect(base.map).not.toBeNull(); // el original no se toca
  });

  it('Shaded y Consistent Colors leen el diffuseColor de IFC como sRGB (gris 0.75 = #c0c0c0)', () => {
    const base = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.753, 0.753, 0.753) });
    base.userData.srgbColor = true;
    const s = new StyleMaterials();
    for (const style of ['shaded', 'consistent'] as const) {
      expect((s.get(base, style) as THREE.MeshBasicMaterial).color.getHex()).toBe(0xc0c0c0);
    }
  });

  it('Shaded y Consistent Colors pintan un material con textura con su color de IFC (shadeColor), no con el blanco del glTF', () => {
    const base = conTextura();
    base.color.setRGB(1, 1, 1);
    base.userData.shadeColor = [0.753, 0.753, 0.753]; // diffuseColor del nodo: sRGB
    const s = new StyleMaterials();
    for (const style of ['shaded', 'consistent'] as const) {
      expect((s.get(base, style) as THREE.MeshBasicMaterial).color.getHex()).toBe(0xc0c0c0);
    }
    expect(s.get(base, 'textures')).toBe(base); // Textures sigue con la imagen
  });

  it('Consistent Colors: color plano sin luz, con la misma transparencia', () => {
    const m = new StyleMaterials().get(conTextura(), 'consistent') as THREE.MeshBasicMaterial;
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(m.color.getHex()).toBe(0x336699);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(0.5);
    expect(m.map).toBeNull();
  });

  it('Hidden Line: flat white opaque faces', () => {
    const m = new StyleMaterials().get(conTextura(), 'hidden') as THREE.MeshBasicMaterial;
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(m.color.getHex()).toBe(0xffffff);
    expect(m.transparent).toBe(false);
  });

  it('Wireframe: las caras no se dibujan', () => {
    expect(new StyleMaterials().get(conTextura(), 'wireframe').visible).toBe(false);
  });

  it('it caches by material and style; all() lists the derived ones and dispose() releases them', () => {
    const s = new StyleMaterials();
    const base = conTextura();
    const a = s.get(base, 'consistent');
    expect(s.get(base, 'consistent')).toBe(a);
    s.get(base, 'shaded');
    expect(s.all().length).toBeGreaterThanOrEqual(2);
    let freed = 0;
    a.addEventListener('dispose', () => freed++);
    s.dispose();
    expect(freed).toBe(1);
    expect(s.all()).toEqual([]);
  });

  it('showsEdges in all except Textures (as in Revit: Shaded and Consistent Colors also carry edges)', () => {
    expect(['wireframe', 'hidden', 'shaded', 'consistent', 'textures'].map((x) => StyleMaterials.showsEdges(x as never))).toEqual([
      true, true, true, true, false,
    ]);
  });

  it('the color of the Hidden Line faces can be changed (theme background), also on those already created', () => {
    const s = new StyleMaterials();
    const a = s.get(conTextura(), 'hidden') as THREE.MeshBasicMaterial;
    s.setHiddenColor(0x2a3039);
    expect(a.color.getHex()).toBe(0x2a3039);
    const b = s.get(new THREE.MeshStandardMaterial(), 'hidden') as THREE.MeshBasicMaterial;
    expect(b.color.getHex()).toBe(0x2a3039);
    expect((s.get(conTextura(), 'consistent') as THREE.MeshBasicMaterial).color.getHex()).toBe(0x336699); // the others, no
  });

  it('the Shaded sun goes high and between the right of the camera and the camera (±X/±Y faces as in Revit)', () => {
    // camera to the southeast looking northwest, like the default 3D
    const fwd = new THREE.Vector3(-1, 1, -1).normalize();
    const sun = shadedSunDir(fwd, new THREE.Vector3(0, 0, 1));
    expect(sun.length()).toBeCloseTo(1);
    expect(sun.z).toBeGreaterThan(0.9); // de arriba: las tapas, claras
    expect(sun.x).toBeGreaterThan(0.3); // las caras +X, iluminadas
    expect(sun.y).toBeCloseTo(0); // las caras -Y, solo con luz ambiente
  });

  it('en planta (mirando abajo) el sol de Shaded usa el «arriba» de la pantalla', () => {
    const sun = shadedSunDir(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
    expect(Number.isFinite(sun.x) && Number.isFinite(sun.y)).toBe(true);
    expect(sun.z).toBeGreaterThan(0.9);
  });
});
