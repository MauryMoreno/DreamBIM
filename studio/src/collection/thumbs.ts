// Thumbnails of the cards: a single hidden Viewer draws each card and delivers a still image. This way the
// grid does not open a WebGL context per card (the browser limits it to about 16).
import { compose } from '../ifcx/compose';
import type { IfcxFile } from '../ifcx/types';
import type { Viewer } from '../render/viewer';

export type ThumbViewer = Pick<Viewer, 'setModel' | 'thumbnail' | 'disposeModel'>;

/** Size of the thumbnails, in pixels. */
export const THUMB_SIZE = { width: 360, height: 270 };

/** Returns a function card → data URL (null if there is nothing to draw). The viewer is created on first use. */
export function createThumbRenderer(make: (host: HTMLElement) => ThumbViewer): (file: IfcxFile) => string | null {
  let viewer: ThumbViewer | null = null;
  return (file) => {
    if (!viewer) {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_SIZE.width}px;height:${THUMB_SIZE.height}px;overflow:hidden`;
      document.body.append(host);
      viewer = make(host);
    }
    const { root } = compose([file]);
    viewer.setModel(root);
    try {
      return viewer.thumbnail(root.children.map((c) => c.path), THUMB_SIZE.width, THUMB_SIZE.height);
    } finally {
      viewer.disposeModel(); // la ficha siguiente no acumula la anterior en la GPU
    }
  };
}
