import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { collectResources, disposeResources } from '../src/render/dispose';

describe('collectResources', () => {
  it('it collects geometries, materials (current and base) and textures without repeats, except the excluded ones', () => {
    const geo = new THREE.BoxGeometry();
    const tex = new THREE.Texture();
    const base = new THREE.MeshStandardMaterial({ map: tex });
    const highlight = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    const a = new THREE.Mesh(geo, highlight); // resaltado: el material actual es el del visor
    a.userData.baseMaterial = base;
    const b = new THREE.Mesh(geo, base); // it shares geometry and material
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    root.add(a, b, line);

    const r = collectResources(root, [highlight]);
    expect(r.geometries.size).toBe(2);
    expect(r.materials.has(base)).toBe(true);
    expect(r.materials.has(highlight)).toBe(false);
    expect(r.materials.size).toBe(2);
    expect([...r.textures]).toEqual([tex]);
  });

  it('disposeResources llama a dispose en todo lo recogido', () => {
    const geo = new THREE.BoxGeometry();
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ normalMap: tex });
    const root = new THREE.Group().add(new THREE.Mesh(geo, mat));
    const spies = [vi.spyOn(geo, 'dispose'), vi.spyOn(mat, 'dispose'), vi.spyOn(tex, 'dispose')];
    disposeResources(collectResources(root));
    for (const s of spies) expect(s).toHaveBeenCalledOnce();
  });
});
