import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ViewerAppearance } from '../src/render/viewer/appearance';
import type { ViewerCore } from '../src/render/viewer/core';

function setup() {
  const base = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), base);
  mesh.userData = { path: '/el', ownClass: 'IfcWall', cls: 'IfcWall', baseMaterial: base };
  const core = { objects: new Map([['/el', mesh]]), pickables: [mesh], drawablesUnder: () => new Set([mesh]) } as unknown as ViewerCore;
  const seen: THREE.Material[][] = [];
  const appearance: ViewerAppearance = new ViewerAppearance(core, {
    nodes: new Map(), levelFocus: () => null, syncBatches: () => {}, syncMirrors: () => {},
    requestRender: () => {}, refreshEdges: () => {}, setShadedStyle: () => {},
    applyClipping: () => seen.push(appearance.clippingMaterials()),
  });
  return { appearance, mesh, seen };
}

describe('ViewerAppearance clipping order', () => {
  it.each([
    ['setColorOverride', (a: ViewerAppearance) => a.setColorOverride(() => ({ color: '#ff0000', opacity: 1 }))],
    ['setSavedColors', (a: ViewerAppearance) => a.setSavedColors(new Map([['/el', { color: '#ff0000', opacity: 1 }]]))],
    ['setAssistantColors', (a: ViewerAppearance) => a.setAssistantColors(new Map([['/el', { color: '#ff0000', opacity: 1 }]]))],
  ])('%s clips the materials it has just created', (_name, run) => {
    const { appearance, mesh, seen } = setup();
    run(appearance);
    expect(seen.at(-1)).toContain(mesh.material);
  });
});
