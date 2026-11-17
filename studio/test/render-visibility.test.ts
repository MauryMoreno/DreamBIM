import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyNodeVisibility, isShown } from '../src/render/visibility';

/**
 * Tree like the one the viewer builds from a Revit IFC: the refrigerator hangs from the room
 * (L2 / 202 / Refrigerator) and the window from the wall. userData.cls is the class of the owning element.
 */
function model() {
  const mat = new THREE.MeshBasicMaterial();
  const mesh = (cls: string) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    m.userData.cls = cls;
    return m;
  };
  const group = (cls: string) => {
    const g = new THREE.Group();
    g.userData.cls = cls;
    return g;
  };

  const storey = group('IfcBuildingStorey');
  const space = group('IfcSpace');
  const spaceBody = mesh('IfcSpace');
  const fridge = group('IfcBuildingElementProxy');
  const fridgeBody = mesh('IfcBuildingElementProxy');
  const wall = group('IfcWall');
  const wallBody = mesh('IfcWall');
  const window = group('IfcWindow');
  const windowBody = mesh('IfcWindow');

  storey.add(space, wall);
  space.add(spaceBody, fridge);
  fridge.add(fridgeBody);
  wall.add(wallBody, window);
  window.add(windowBody);

  const all = [storey, space, spaceBody, fridge, fridgeBody, wall, wallBody, window, windowBody];
  return { all, storey, space, spaceBody, fridgeBody, wallBody, windowBody };
}

function apply(objs: THREE.Object3D[], hiddenClasses: string[], hiddenNodes: THREE.Object3D[] = []) {
  const classes = new Set(hiddenClasses);
  for (const o of objs) applyNodeVisibility(o, !hiddenNodes.includes(o), classes);
}

describe('ocultar por clase', () => {
  it('hiding IfcSpace does not hide what is inside the room', () => {
    const m = model();
    apply(m.all, ['IfcSpace']);
    expect(isShown(m.spaceBody)).toBe(false);
    expect(isShown(m.fridgeBody)).toBe(true);
  });

  it('hiding IfcWall leaves visible the windows that hang from the wall', () => {
    const m = model();
    apply(m.all, ['IfcWall']);
    expect(isShown(m.wallBody)).toBe(false);
    expect(isShown(m.windowBody)).toBe(true);
  });

  it('volver a mostrar la clase la recupera', () => {
    const m = model();
    apply(m.all, ['IfcSpace']);
    apply(m.all, []);
    expect(isShown(m.spaceBody)).toBe(true);
    expect(m.spaceBody.userData.classHidden).toBe(false);
  });

  it('it sets classHidden for whoever copies the tree without looking at the layers', () => {
    const m = model();
    apply(m.all, ['IfcSpace']);
    expect(m.spaceBody.userData.classHidden).toBe(true);
    expect(m.fridgeBody.userData.classHidden).toBe(false);
  });
});

describe('ocultar un nodo', () => {
  it('hiding a level in the tree still hides everything it contains', () => {
    const m = model();
    apply(m.all, [], [m.storey]);
    expect(isShown(m.fridgeBody)).toBe(false);
    expect(isShown(m.windowBody)).toBe(false);
  });
});
