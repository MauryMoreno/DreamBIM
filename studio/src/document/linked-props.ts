import type { ComposedNode } from '../ifcx/types';
import { clearAttr, clearVariant, editPath, setAttr, setVariant } from '../composer/edits';
import { linkedEditable, type SimpleValue } from '../properties/groups';
import type { DocumentContext } from './context';

export class LinkedPropsService {
  constructor(private readonly ctx: DocumentContext) {}

  /** The node in the last composed model (with what it has now) and its edit path. */
  private linkedNode(node: ComposedNode): { node: ComposedNode; path: string } | null {
    const result = this.ctx.state.shown?.result;
    if (!result?.byPath) return null;
    const n = result.byPath.get(node.path);
    return n && n.origin === node.origin ? { node: n, path: editPath(n, result) } : null;
  }

  /** Does the edit layer of `layerId` already override `key` on that node (at its edit path)? */
  linkedAttrEdited(layerId: string, node: ComposedNode, key: string): boolean {
    const l = this.ctx.stack.edited(layerId);
    const at = this.linkedNode(node);
    if (!l || !at) return false;
    return l.editsEnabled && l.edits.some((n) => n.path === at.path && !!n.attributes && key in n.attributes);
  }

  /**
   * Overrides a simple attribute (text, number or boolean) of the node itself in the edit layer
   * of its file, per instance if it is reused. false without an editable document, if the layer or
   * the node do not exist, if the attribute or the value are not editable, or with the edit layer
   * turned off (warns).
   */
  setLinkedAttr(layerId: string, node: ComposedNode, key: string, value: SimpleValue): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s || !linkedEditable(key, value)) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Edit Property', () => {
      const l = this.ctx.stack.edited(layerId);
      const at = this.linkedNode(node);
      if (!l || !at || this.ctx.state.current !== s || !linkedEditable(key, at.node.attributes[key])) return null;
      if (this.ctx.stack.editsOff(l)) return null;
      if (at.node.attributes[key] === value) return false;
      l.edits = setAttr(l.edits, at.path, key, value);
      return true;
    });
  }

  /** Reset: removes the override of `key` and restores the file value. false if there was none or with the edit layer off. */
  resetLinkedAttr(layerId: string, node: ComposedNode, key: string): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Reset Property', () => {
      const l = this.ctx.stack.edited(layerId);
      const at = this.linkedNode(node);
      if (!l || !at || this.ctx.state.current !== s || this.ctx.stack.editsOff(l)) return null;
      const edits = clearAttr(l.edits, at.path, key);
      if (edits === l.edits) return null;
      l.edits = edits;
      return true;
    });
  }

  /** Does the edit layer of `layerId` already choose an option of the `set` variant set on that node? */
  linkedVariantEdited(layerId: string, node: ComposedNode, set: string): boolean {
    const l = this.ctx.stack.edited(layerId);
    const at = this.linkedNode(node);
    if (!l || !at) return false;
    return l.editsEnabled && l.edits.some((n) => n.path === at.path && !!n.variantSelection && set in n.variantSelection);
  }

  /**
   * Chooses the `option` of the `set` variant set of the node, in the edit layer of its
   * file and per instance if it is reused. false if the set or the option do not exist or with the
   * edit layer turned off (warns).
   */
  setLinkedVariant(layerId: string, node: ComposedNode, set: string, option: string): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Select Variant', () => {
      const l = this.ctx.stack.edited(layerId);
      const at = this.linkedNode(node);
      const v = at?.node.variantSets?.[set];
      if (!l || !at || this.ctx.state.current !== s || !v?.options.includes(option)) return null;
      if (this.ctx.stack.editsOff(l)) return null;
      if (v.selected === option) return false;
      l.edits = setVariant(l.edits, at.path, set, option);
      return true;
    });
  }

  /** Variant reset: removes the selection from the edit layer and restores the file one. */
  resetLinkedVariant(layerId: string, node: ComposedNode, set: string): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Reset Variant', () => {
      const l = this.ctx.stack.edited(layerId);
      const at = this.linkedNode(node);
      if (!l || !at || this.ctx.state.current !== s || this.ctx.stack.editsOff(l)) return null;
      const edits = clearVariant(l.edits, at.path, set);
      if (edits === l.edits) return null;
      l.edits = edits;
      return true;
    });
  }
}
