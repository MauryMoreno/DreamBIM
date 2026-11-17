import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createLevelMarks, type LevelMarksView } from '../src/workspace/levelmarks';
import { levelMarks } from '../src/workspace/levelmarks-geom';

const MARKS = levelMarks(
  [
    { path: '/l1', name: 'Level 1', minZ: 0, maxZ: 3 },
    { path: '/l2', name: 'Level 2', minZ: 3, maxZ: 6 },
  ],
  { minX: 0, minY: 0, maxX: 10, maxY: 4 },
);

describe('createLevelMarks', () => {
  let scene: THREE.Scene;
  let camera: THREE.Camera;
  let overlay: HTMLElement;
  let onSelect: ReturnType<typeof vi.fn>;
  let view: LevelMarksView;

  const marksInScene = () => scene.children.filter((c) => c.name === 'level-mark');
  const heads = () => [...overlay.querySelectorAll<HTMLElement>('.level-head')];
  const labels = () => [...overlay.querySelectorAll<HTMLElement>('.level-label')];

  beforeEach(() => {
    document.body.innerHTML = '<div id="ov"></div>';
    overlay = document.getElementById('ov')!;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    camera.position.set(0, 0, 20);
    camera.updateMatrixWorld();
    onSelect = vi.fn();
    view = createLevelMarks({ scene, camera, requestRender: vi.fn() }, overlay, onSelect);
  });

  it('outline: a dashed line per level and head + label in the overlay', () => {
    view.show(MARKS, 'outline', null);
    const objs = marksInScene() as THREE.Line[];
    expect(objs).toHaveLength(2);
    expect(objs.every((o) => o.material instanceof THREE.LineDashedMaterial)).toBe(true);
    expect(labels().map((l) => l.textContent)).toEqual(['Level 1 0.000', 'Level 2 3.000']);
    expect(heads()).toHaveLength(2);
  });

  it('plane: a transparent mesh without depth writing plus its border, per level', () => {
    view.show(MARKS, 'plane', null);
    const meshes = marksInScene().filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    expect(meshes).toHaveLength(2);
    for (const m of meshes) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    expect(marksInScene().filter((o) => o instanceof THREE.LineLoop)).toHaveLength(2);
  });

  it('off and clear() empty the scene and the overlay; showing twice does not duplicate', () => {
    view.show(MARKS, 'outline', null);
    view.show(MARKS, 'outline', null);
    expect(marksInScene()).toHaveLength(2);
    expect(labels()).toHaveLength(2);
    view.show(MARKS, 'off', null);
    expect(marksInScene()).toHaveLength(0);
    expect(overlay.children).toHaveLength(0);
    view.show(MARKS, 'plane', null);
    view.clear();
    expect(scene.children).toHaveLength(0);
    expect(overlay.children).toHaveLength(0);
  });

  it('el nivel seleccionado lleva la clase selected en cabeza y etiqueta', () => {
    view.show(MARKS, 'outline', '/l2');
    const sel = [...heads(), ...labels()].filter((e) => e.classList.contains('selected'));
    expect(sel.map((e) => e.dataset.path)).toEqual(['/l2', '/l2']);
  });

  it('un clic en la etiqueta o en la cabeza llama a onSelect con la ruta del nivel', () => {
    view.show(MARKS, 'outline', null);
    labels()[0].click();
    heads()[1].click();
    expect(onSelect.mock.calls).toEqual([['/l1'], ['/l2']]);
  });

  it('un nombre con HTML se pinta como texto', () => {
    view.show(levelMarks([{ path: '/x', name: '<b>x</b>', minZ: 0, maxZ: 1 }], null), 'outline', null);
    expect(overlay.querySelector('b')).toBeNull();
    expect(labels()[0].textContent).toBe('<b>x</b> 0.000');
  });

  it('a level behind the camera or off screen hides its head and label', () => {
    const persp = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    persp.position.set(0, 0, 20);
    persp.lookAt(0, 0, 0);
    persp.updateMatrixWorld();
    const v = createLevelMarks({ scene, camera: persp, requestRender: vi.fn() }, overlay, onSelect);
    const delante = levelMarks([{ path: '/d', name: 'D', minZ: 0, maxZ: 1 }], null); // z = 0, delante
    const detras = levelMarks([{ path: '/t', name: 'T', minZ: 40, maxZ: 41 }], null); // z = 40, behind the camera
    v.show([...delante, ...detras], 'outline', null);
    v.update();
    const byPath = (p: string) => overlay.querySelector<HTMLElement>(`.level-head[data-path="${p}"]`)!;
    expect(byPath('/d').hidden).toBe(false);
    expect(byPath('/t').hidden).toBe(true);
  });

  it('dispose quita todo', () => {
    view.show(MARKS, 'plane', null);
    view.dispose();
    expect(scene.children).toHaveLength(0);
    expect(overlay.children).toHaveLength(0);
  });
});
