import { DOCUMENT_RELOCATE_TEXT, isLayerDrag } from './helpers';
import type { ComposedNode } from '../../ifcx/types';
import { classCode } from '../../ifcx/names';
import { draggedAsset } from '../../library/librarypanel';
import { toast } from '../../shell/toast';
import { insideOwnOrigin } from '../edits';
import { LAYER_DRAG_TYPE } from '../rows';
import type { StageContext } from './context';

export function installDragReparent(ctx: StageContext): void {
  // --- Arrastrar para reubicar -------------------------------------------------------------
  /** Node being dragged (the DataTransfer cannot be read during dragover in all engines). */
  ctx.dragging = null;

  const clearDrop = () => {
    for (const x of [ctx.tree, ...ctx.tree.querySelectorAll('.drop-target, .drop-denied')]) x.classList.remove('drop-target', 'drop-denied');
  };
  ctx.clearDrop = clearDrop;

  /**
   * Can `n` be dropped on `t`? 'self': the node itself, a descendant or (what hangs from) another
   * instance of the same origin; 'document': an element of the document (relocated through Properties ›
   * Level); 'denied': another origin layer, its current parent, or `n` hangs directly from the composed
   * root (it is the root of a file); 'ok': same origin layer, it is relocated.
   */
  const verdict = (n: ComposedNode, t: ComposedNode): 'ok' | 'denied' | 'self' | 'document' => {
    if (insideOwnOrigin(n, t)) return 'self';
    const src = ctx.sourceFor(n);
    if (src === 'document') return 'document';
    const parent = n.parent;
    if (!parent?.parent || t === parent) return 'denied';
    return ctx.sourceFor(t) === src && ctx.sourceFor(parent) === src ? 'ok' : 'denied';
  };

  /**
   * Is dropping a file to place it offered? On any node, if the document allows it (not
   * in read-only); the controller rejects with a warning what is not valid (a node of the file itself).
   */
  const placeable = (): boolean => !ctx.cb.canPlace || ctx.cb.canPlace();

  /** Project of the document: where what is dropped in the empty space of the tree falls. */
  const projectNode = (): ComposedNode | null =>
    ctx.data.root?.children.find((c) => classCode(c) === 'IfcProject' && ctx.sourceFor(c) === 'document') ?? null;

  const targetOf = (e: Event): { r: HTMLElement; t: ComposedNode } | null => {
    const r = e.target instanceof Element ? e.target.closest<HTMLElement>('.stage-row') : null;
    const t = r?.dataset.path !== undefined ? ctx.nodes.get(r.dataset.path) : undefined;
    return r && t ? { r, t } : null;
  };

  ctx.tree.addEventListener('dragover', (e) => {
    const hit = targetOf(e);
    if (!ctx.dragging && (isLayerDrag(e.dataTransfer) || draggedAsset())) {
      // a layer of the Layer panel or a library card: on any node, or the empty space (the project)
      clearDrop();
      const mark = hit?.r ?? (projectNode() ? ctx.tree : null);
      if (!mark) return;
      if (placeable()) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        mark.classList.add('drop-target');
      } else {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        mark.classList.add('drop-denied');
      }
      return;
    }
    if (!ctx.dragging || !hit) return;
    const v = verdict(ctx.dragging, hit.t);
    clearDrop();
    if (v === 'document') {
      // it is accepted so that the drop arrives, which warns how to move it
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    } else if (v === 'ok') {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      hit.r.classList.add('drop-target');
    } else {
      // sin preventDefault el navegador muestra el cursor de no permitido
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      hit.r.classList.add('drop-denied');
    }
  });

  ctx.tree.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node) || !ctx.tree.contains(e.relatedTarget)) clearDrop();
  });

  ctx.tree.addEventListener('drop', (e) => {
    const hit = targetOf(e);
    const n = ctx.dragging;
    clearDrop();
    const asset = draggedAsset();
    const layerDrag = isLayerDrag(e.dataTransfer);
    if (!n && (asset || layerDrag)) {
      const parent = hit?.t ?? projectNode();
      if (!parent || !placeable()) return;
      e.preventDefault();
      if (asset) ctx.cb.onPlaceAsset?.(asset, parent.origin);
      else {
        const id = e.dataTransfer?.getData(LAYER_DRAG_TYPE);
        if (id) ctx.cb.onPlace?.(id, parent.origin);
      }
      return;
    }
    if (!n || !hit) return;
    const v = verdict(n, hit.t);
    if (v === 'document') {
      e.preventDefault();
      ctx.dragging = null;
      toast(DOCUMENT_RELOCATE_TEXT, 'info');
      return;
    }
    if (v !== 'ok') return;
    e.preventDefault();
    ctx.dragging = null;
    ctx.cb.onReparent?.(n.origin, hit.t.origin, { node: n.path, parent: hit.t.path, layer: ctx.sourceFor(n) });
  });
}
