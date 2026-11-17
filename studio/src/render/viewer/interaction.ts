import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { perfSpan } from '../perf';
import { isShown } from '../visibility';
import type { ViewerAppearance } from './appearance';
import type { ViewerCamera } from './camera';
import type { ViewerCore } from './core';
import type { ViewerSection } from './section';

/** What pointer capture, picking and screenshots reach in the rest of the viewer. */
interface InteractionPeers {
  readonly container: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly section: ViewerSection;
  readonly appearance: ViewerAppearance;
  readonly cameras: ViewerCamera;
  onPick(path: string | null, toggle: boolean): void;
  onHover(path: string | null): void;
  fit(path: string): void;
  renderNow(): void;
  requestRender(): void;
}

/** Pointer handling, picking and screenshots. */
export class ViewerInteraction {
  private raycaster = new THREE.Raycaster();

  constructor(private core: ViewerCore, private peers: InteractionPeers) {
    this.raycaster.params.Line = { threshold: 0.05 };
    this.raycaster.params.Points = { threshold: 0.05 };
    this.bindPointer();
  }

  screenshot(): string {
    const box = this.peers.section.box;
    const boxShown = box.visible;
    box.root.visible = false; // the box drawing (edges and handles) does not appear in the capture
    this.peers.renderNow();
    box.root.visible = boxShown;
    this.peers.requestRender();
    return this.peers.renderer.domElement.toDataURL('image/png');
  }

  /** Returns the path of the object under the cursor. */
  pick(e: MouseEvent): string | null {
    const r = this.peers.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.peers.camera);
    const hits = perfSpan('viewer.pick', () => this.raycaster.intersectObjects(this.core.pickables.filter(isShown), false));
    for (const h of hits) {
      if (this.peers.appearance.isUnderlay(h.object)) continue; // nearby storeys are only a reference
      if (this.peers.section.clipped(h.point)) continue;
      return h.object.userData.path;
    }
    return null;
  }

  private bindPointer() {
    const el = this.peers.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    let hoverQueued = false;
    let lastMove: PointerEvent | null = null;

    // section box handles: capture on the container, before OrbitControls and the pick
    const ndcOf = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.peers.camera);
    };
    const box = this.peers.section.box;
    let controlsWere = true;
    const dragMove = (e: PointerEvent) => { ndcOf(e); box.moveDrag(this.raycaster); this.peers.requestRender(); };
    const dragEnd = () => {
      window.removeEventListener('pointermove', dragMove);
      window.removeEventListener('pointerup', dragEnd);
      window.removeEventListener('pointercancel', dragEnd);
      box.endDrag();
      el.style.cursor = '';
      this.peers.controls.enabled = controlsWere;
      this.peers.requestRender();
    };
    this.peers.container.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.peers.cameras.walking || !box.visible) return;
      ndcOf(e);
      const face = box.hitHandle(this.raycaster);
      if (face === null || !box.beginDrag(face, this.raycaster)) return;
      e.stopPropagation();
      e.preventDefault();
      controlsWere = this.peers.controls.enabled;
      this.peers.controls.enabled = false;
      el.style.cursor = 'grabbing';
      window.addEventListener('pointermove', dragMove);
      window.addEventListener('pointerup', dragEnd);
      window.addEventListener('pointercancel', dragEnd);
      this.peers.requestRender();
    }, true);
    this.peers.container.addEventListener('pointermove', e => {
      if (e.buttons || this.peers.cameras.walking || !box.visible || box.dragging) return;
      ndcOf(e);
      const face = box.hitHandle(this.raycaster);
      el.style.cursor = face === null ? '' : 'grab';
      if (box.setHot(face)) this.peers.requestRender();
    }, true);

    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (!down || this.peers.cameras.walking) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || e.button !== 0) return;
      this.peers.onPick(this.pick(e), e.ctrlKey || e.metaKey);
    });
    el.addEventListener('dblclick', e => {
      if (this.peers.cameras.walking) return;
      const p = this.pick(e);
      if (p) this.peers.fit(p);
    });
    el.addEventListener('pointermove', e => {
      if (e.buttons || this.peers.cameras.walking) return;
      lastMove = e;
      if (hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const p = lastMove ? this.pick(lastMove) : null;
        if (p !== this.peers.appearance.hoveredPath) {
          this.peers.appearance.setHovered(p);
          this.peers.onHover(p);
        }
      });
    });
    el.addEventListener('pointerleave', () => {
      if (this.peers.appearance.hoveredPath) {
        this.peers.appearance.setHovered(null);
        this.peers.onHover(null);
      }
    });
  }
}
