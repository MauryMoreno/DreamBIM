// Levels drawn in the 3D view: lines or planes in the three.js scene and, above them, the head
// and label as HTML (sharp in light and dark themes), repositioned on every frame.
import * as THREE from 'three';
import { onThemeChange } from '../shell/theme';
import type { LevelMark, LevelsStyle } from './levelmarks-geom';

export interface LevelMarksHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  requestRender(): void;
}

export interface LevelMarksView {
  show(marks: LevelMark[], style: LevelsStyle, selected: string | null): void;
  clear(): void;
  /** Repositions heads and labels with the current camera (only done on every frame). */
  update(): void;
  dispose(): void;
  /** Marks currently shown (empty with Off). */
  readonly marks: LevelMark[];
}

const OBJECT_NAME = 'level-mark';
/** Opacity of the level plane. */
const PLANE_OPACITY = 0.12;
const DASH = 0.6;
const GAP = 0.3;
/** Above this value (in normalized coordinates) a point is off screen. */
const NDC_LIMIT = 1.2;
/** Offset of the label from the center of the head (px). */
const LABEL_OFFSET_PX = 14;
/** Fallback if the token cannot be read (e.g. outside the browser). */
const FALLBACK_LINE = 0x5b6674;
const FALLBACK_ACCENT = 0x1a5fb4;

function tokenColor(name: string, fallback: number): number {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v ? new THREE.Color(v).getHex() : fallback;
  } catch {
    return fallback;
  }
}

export function createLevelMarks(
  host: LevelMarksHost,
  overlay: HTMLElement,
  onSelect: (path: string) => void,
): LevelMarksView {
  let marks: LevelMark[] = [];
  let style: LevelsStyle = 'off';
  let selected: string | null = null;
  let objects: THREE.Object3D[] = [];
  let items: { mark: LevelMark; head: HTMLElement; label: HTMLElement }[] = [];
  let running = false;
  const point = new THREE.Vector3();

  const disposeObject = (o: THREE.Object3D): void => {
    host.scene.remove(o);
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material | undefined)?.dispose();
  };

  const clear = (): void => {
    objects.forEach(disposeObject);
    objects = [];
    overlay.replaceChildren();
    items = [];
    marks = [];
    host.requestRender();
  };

  const reposition = (): void => {
    const w = overlay.clientWidth;
    const h = overlay.clientHeight;
    host.camera.updateMatrixWorld();
    for (const { mark, head, label } of items) {
      point.set(mark.head[0], mark.head[1], mark.z).project(host.camera);
      const hidden = point.z > 1 || Math.abs(point.x) > NDC_LIMIT || Math.abs(point.y) > NDC_LIMIT;
      head.hidden = hidden;
      label.hidden = hidden;
      if (hidden) continue;
      const x = ((point.x + 1) / 2) * w;
      const y = ((1 - point.y) / 2) * h;
      head.style.left = `${x}px`;
      head.style.top = `${y}px`;
      label.style.left = `${x + LABEL_OFFSET_PX}px`;
      label.style.top = `${y}px`;
    }
  };

  const frame = (): void => {
    if (!running || !overlay.isConnected || !items.length) {
      running = false;
      return;
    }
    reposition();
    requestAnimationFrame(frame);
  };

  const build = (): void => {
    const line = tokenColor('--level-line', FALLBACK_LINE);
    const accent = tokenColor('--accent', FALLBACK_ACCENT);
    for (const m of marks) {
      const color = m.path === selected ? accent : line;
      const pts = m.corners.flatMap(([x, y]) => [x, y, m.z]);
      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
        style === 'plane'
          ? new THREE.LineBasicMaterial({ color })
          : new THREE.LineDashedMaterial({ color, dashSize: DASH, gapSize: GAP }),
      );
      if (style === 'outline') border.computeLineDistances();
      border.name = OBJECT_NAME;
      border.userData.path = m.path;
      border.renderOrder = 5;
      host.scene.add(border);
      objects.push(border);

      if (style === 'plane') {
        const geo = new THREE.BufferGeometry()
          .setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
          .setIndex([0, 1, 2, 0, 2, 3]);
        const plane = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: PLANE_OPACITY, depthWrite: false, side: THREE.DoubleSide,
          }),
        );
        plane.name = OBJECT_NAME;
        plane.userData.path = m.path;
        plane.renderOrder = 4;
        host.scene.add(plane);
        objects.push(plane);
      }

      const head = document.createElement('div');
      head.className = 'level-head';
      const label = document.createElement('div');
      label.className = 'level-label';
      label.textContent = m.label;
      for (const e of [head, label]) {
        e.dataset.path = m.path;
        e.classList.toggle('selected', m.path === selected);
        e.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // does not start the orbit
        e.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelect(m.path);
        });
      }
      overlay.append(head, label);
      items.push({ mark: m, head, label });
    }
  };

  const show: LevelMarksView['show'] = (next, nextStyle, nextSelected) => {
    clear();
    style = nextStyle;
    selected = nextSelected;
    if (style === 'off' || !next.length) return;
    marks = next;
    build();
    reposition();
    host.requestRender();
    if (!running && typeof requestAnimationFrame === 'function') {
      running = true;
      requestAnimationFrame(frame);
    }
  };

  // when the theme changes the line colors are read again from the tokens
  const stopTheme = onThemeChange(() => {
    if (style === 'off' || !marks.length) return;
    const current = marks;
    show(current, style, selected);
  });

  return {
    show,
    clear,
    update: reposition,
    dispose() {
      stopTheme();
      running = false;
      clear();
    },
    get marks() {
      return marks;
    },
  };
}
