import * as THREE from 'three';
import type { ViewerCore } from './core';

const DEFAULT_GRID_COLORS: readonly [number, number] = [0x8a94a3, 0xc4cad3]; // [centre line, rest]

/** Reference grid drawn under the model, with its own visibility, colours and elevation. */
export class ViewerGrid {
  showGrid = true;
  private emptyGridExtent: number | null = null;
  private gridColors?: readonly [number, number];
  private grid: THREE.GridHelper | null = null;
  private gridZ: number | null = null;

  constructor(private core: ViewerCore, private bbox: THREE.Box3) {}

  /**
   * With a value, an empty model (empty box) still gets a grid of that side (metres) centred on the
   * origin. null (the default) keeps the usual behaviour: no model, no grid.
   */
  setEmptyGrid(extent: number | null) {
    this.emptyGridExtent = extent && extent > 0 ? extent : null;
    this.updateGrid();
    this.core.requestRender();
  }

  /** Grid colours (centre line, rest). Defaults to the usual ones; rebuilds the grid if it exists. */
  setGridColors(center: number, line: number) {
    this.gridColors = [center, line];
    this.updateGrid();
    this.core.requestRender();
  }

  setGrid(on: boolean) {
    this.showGrid = on;
    if (this.grid) this.grid.visible = on;
    this.core.requestRender();
  }

  /** Elevation of the grid (that of the storey plan); null puts it back under the model. */
  setGridZ(z: number | null) {
    this.gridZ = z;
    this.updateGrid();
    this.core.requestRender();
  }

  updateGrid() {
    if (this.grid) {
      this.core.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }
    let box = this.bbox;
    if (box.isEmpty()) {
      if (!this.emptyGridExtent) return;
      const h = this.emptyGridExtent / 2 / 1.6; // the final side is extent (see the 1.6 factor below)
      box = new THREE.Box3(new THREE.Vector3(-h, -h, 0), new THREE.Vector3(h, h, 0));
    }
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y) * 1.6;
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(extent / 20, 1e-3))));
    const divisions = Math.min(Math.ceil(extent / step), 400);
    const [centerColor, lineColor] = this.gridColors ?? DEFAULT_GRID_COLORS;
    const grid = new THREE.GridHelper(divisions * step, divisions, centerColor, lineColor);
    grid.rotation.x = Math.PI / 2; // GridHelper lives in XZ; move it to XY
    const c = box.getCenter(new THREE.Vector3());
    // on a plan, a little below the storey elevation: that way it does not fight the wall faces that reach it
    grid.position.set(c.x, c.y, this.gridZ !== null ? this.gridZ - 0.02 : box.min.z - 1e-3);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.visible = this.showGrid;
    this.grid = grid;
    this.core.scene.add(grid);
  }
}
