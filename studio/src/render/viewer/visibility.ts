import { focusRole, type LevelFocus } from '../levels';
import { applyNodeVisibility } from '../visibility';
import type { ViewerCore } from './core';

/**
 * Classes hidden when a model opens: spaces (IfcSpace) would cover the interior, as in Revit, and
 * axis grids (IfcGrid) cross the whole model.
 */
export const DEFAULT_HIDDEN_CLASSES: readonly string[] = ['IfcSpace', 'IfcGrid'];

/** Drawing state the visibility pass refreshes after changing what is shown. */
interface VisibilityPeers {
  levelFocus(): LevelFocus | null;
  syncBatches(): void;
  syncMirrors(): void;
  edgesPossible(): boolean;
  markEdgesDirty(): void;
  refreshWalk(): void;
  onVisibilityChange(): void;
  requestRender(): void;
}

/** Hidden paths, hidden classes and isolation; applies them to the logical model objects. */
export class ViewerVisibility {
  private hiddenPaths = new Set<string>();
  private hiddenClasses = new Set(DEFAULT_HIDDEN_CLASSES);
  private isolated: string | null = null;

  constructor(private core: ViewerCore, private peers: VisibilityPeers) {}

  setHidden(paths: Set<string>) {
    this.hiddenPaths = paths;
    this.apply();
  }

  setHiddenClasses(codes: Set<string>) {
    this.hiddenClasses = codes;
    this.apply();
  }

  isolate(path: string | null) {
    this.isolated = path;
    this.apply();
  }

  /** A new model: an isolation that no longer exists is cleared. */
  prune() {
    if (this.isolated && !this.core.objects.has(this.isolated)) this.isolated = null;
  }

  apply() {
    const iso = this.isolated;
    for (const [path, obj] of this.core.objects) {
      // Hidden classes do not enter here: applyNodeVisibility removes them without inheriting to children.
      let visible = !this.hiddenPaths.has(path);
      let layerOn = true;
      if (iso && visible) {
        const inside = path === iso || path.startsWith(iso + '/');
        const ancestor = iso.startsWith(path + '/');
        visible = inside || ancestor;
        // an ancestor with geometry of its own must not be drawn when isolating a descendant
        if (ancestor && obj.userData.baseMaterial) layerOn = false;
      }
      const focus = this.peers.levelFocus();
      if (focus && visible) {
        const role = focusRole(path, focus);
        if (role === 'hidden') visible = false;
        // an ancestor of the shown levels with geometry of its own (e.g. the terrain) is not drawn
        else if (role === 'ancestor' && obj.userData.baseMaterial) layerOn = false;
      }
      applyNodeVisibility(obj, visible, this.hiddenClasses, layerOn);
    }
    this.peers.syncBatches();
    this.peers.syncMirrors();
    if (this.peers.edgesPossible()) {
      this.peers.markEdgesDirty();
    }
    this.peers.refreshWalk();
    this.peers.onVisibilityChange();
    this.peers.requestRender();
  }
}
