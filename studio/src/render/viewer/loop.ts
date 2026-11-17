import * as THREE from 'three';
import { perfAdd, perfEnabled } from '../perf';
import type { ViewerCore } from './core';

/**
 * Per-frame work that still lives in the viewer facade while the camera and walk subsystems are
 * being extracted.
 */
export interface ViewerLoopHost {
  /** Advances walking, camera animation and orbit damping; true when the view moved. */
  advance(dt: number): boolean;
  /** Runs just before drawing: edge rebuild, shaded sun and section box scale. */
  prepareRender(): void;
}

/** Render loop, frame timing, resize observer and first-frame metric. */
export class ViewerLoop {
  private clock = new THREE.Clock();
  /** Durations of the last 60 frames. */
  private frameMs: number[] = [];
  /** The first render after setModel is recorded as viewer.firstFrame. */
  private pendingFirstFrame = false;

  constructor(private core: ViewerCore, private host: ViewerLoopHost) {
    new ResizeObserver(() => this.resize()).observe(core.host);
    this.resize();
    this.loop();
  }

  /** Arms the first-frame metric for the next frame that is drawn. */
  armFirstFrame(): void {
    this.pendingFirstFrame = perfEnabled();
  }

  /** Draw calls and triangles of the last frame plus the mean render time of the last 60 frames. */
  frameStats(): { drawCalls: number; triangles: number; avgFrameMs: number } {
    const info = this.core.renderer.info.render;
    const n = this.frameMs.length;
    const avgFrameMs = n ? this.frameMs.reduce((a, b) => a + b, 0) / n : 0;
    return { drawCalls: info.calls, triangles: info.triangles, avgFrameMs };
  }

  /** Draws the scene once, with the same work and timing as a loop frame. */
  renderNow(): void {
    const t0 = performance.now();
    this.host.prepareRender();
    this.core.renderer.render(this.core.scene, this.core.camera);
    const dt = performance.now() - t0;
    this.frameMs.push(dt);
    if (this.frameMs.length > 60) this.frameMs.shift();
    if (this.pendingFirstFrame) {
      this.pendingFirstFrame = false;
      perfAdd('viewer.firstFrame', dt);
    }
  }

  private resize(): void {
    const w = this.core.host.clientWidth;
    const h = this.core.host.clientHeight;
    if (!w || !h) return;
    this.core.renderer.setSize(w, h, false);
    this.core.camera.aspect = w / h;
    this.core.camera.updateProjectionMatrix();
    this.core.requestRender();
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const dt = this.clock.getDelta();
    if (this.host.advance(dt)) this.core.needsRender = true;
    if (!this.core.needsRender) return;
    this.core.needsRender = false;
    this.renderNow();
  };
}
