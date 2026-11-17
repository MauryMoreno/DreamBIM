import type * as THREE from 'three';

/** Drawn: layer 0 enabled and the whole ancestor chain visible. */
export function isShown(o: THREE.Object3D) {
  if (!o.layers.isEnabled(0)) return false;
  for (let c: THREE.Object3D | null = o; c; c = c.parent) if (!c.visible) return false;
  return true;
}

/**
 * Visibility of a model object.
 *
 * - `visible` (hiding a node in the tree, isolating, storeys) goes in Object3D.visible and is inherited:
 *   hiding a storey hides everything it contains.
 * - Hiding a class only removes the geometry of the elements of that class (userData.cls, the owning
 *   element's class), with layer 0, which is not inherited. Thus hiding IfcSpace does not take what is
 *   inside the room (Revit equipment hangs from the space) and hiding IfcWall does not take the wall's
 *   windows.
 *
 * `layerOn` is what isolating and the storeys decided about the layer (an ancestor with geometry of its
 * own is not drawn when isolating a descendant). userData.classHidden is left for whoever copies the
 * tree looking only at Object3D.visible (thumbnails).
 */
export function applyNodeVisibility(o: THREE.Object3D, visible: boolean, hiddenClasses: ReadonlySet<string>, layerOn = true) {
  const cls = o.userData.cls as string | undefined;
  const classHidden = !!cls && hiddenClasses.has(cls);
  o.userData.classHidden = classHidden;
  o.visible = visible;
  if (layerOn && !classHidden) o.layers.enable(0);
  else o.layers.disable(0);
}
