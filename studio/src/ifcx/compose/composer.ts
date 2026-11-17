import type { IfcxFile } from '../types';
import { FlatNode, Undo, WorkNode, emptyWork } from './types';
import { head, tail, nestedPrefixes } from './flatten';
import { cloneWork, revert, childAt } from './work';

export class Composer {
  private cache = new Map<string, WorkNode>();
  private stack = new Set<string>();
  warnings: string[] = [];

  constructor(
    private nodes: Map<string, FlatNode>,
    private payloadFiles: ReadonlyMap<string, IfcxFile> = new Map(),
    private payloadRoots: ReadonlyMap<string, string[]> = new Map(),
    private hasData?: (path: string) => boolean,
  ) {}

  /** Returns an independent copy of the class/instance node `ref` ("uuid" or "uuid/a/b"). */
  resolve(ref: string): WorkNode | null {
    const h = head(ref);
    let base = this.cache.get(h);
    if (!base) {
      if (this.stack.has(h)) {
        this.warnings.push(`Cycle detected at "${h}"`);
        return null;
      }
      this.stack.add(h);
      base = emptyWork(h);
      this.composeInto(h, base);
      this.stack.delete(h);
      this.cache.set(h, base);
    }
    const sub = childAt(base, tail(ref));
    if (!sub) {
      this.warnings.push(`Unknown node "${ref}"`);
      return null;
    }
    return cloneWork(sub);
  }

  /** Aplica los datos de la ruta `dataPath` sobre `target` y desciende a los hijos. */
  composeInto(dataPath: string, target: WorkNode) {
    const flat = this.nodes.get(dataPath);
    if (flat) {
      for (const ih of Object.values(flat.inherits)) {
        const src = this.resolve(ih);
        if (!src) continue;
        for (const [k, c] of src.children) target.children.set(k, c);
        for (const [k, v] of src.attributes) target.attributes.set(k, v);
        for (const [k, v] of src.variants) target.variants.set(k, v);
        for (const [k, p] of src.payloads) target.payloads.set(k, p);
        for (const k of src.loaded) target.loaded.add(k);
      }
      for (const [set, opts] of Object.entries(flat.variants)) {
        let v = target.variants.get(set);
        if (!v) target.variants.set(set, v = { options: new Map(), selected: null, applied: null });
        for (const [o, ref] of Object.entries(opts)) v.options.set(o, ref);
        v.selected ??= v.options.keys().next().value ?? null;
      }
      for (const [set, option] of Object.entries(flat.variantSelection)) {
        const v = target.variants.get(set);
        if (!v || !v.options.has(option)) {
          this.warnings.push(`Unknown variant "${set}: ${option}" at "${dataPath}"`);
          continue;
        }
        if (v.selected === option) continue;
        revert(target, v);
        v.selected = option;
      }
      for (const [name, ref] of Object.entries(flat.children)) {
        if (ref === null) { target.children.delete(name); continue; }
        const c = this.resolve(ref);
        if (c) target.children.set(name, c);
      }
      for (const [k, v] of Object.entries(flat.attributes)) {
        if (v === null) target.attributes.delete(k);
        else target.attributes.set(k, v);
      }
      for (const [k, p] of Object.entries(flat.payloads)) target.payloads.set(k, p);
    }
    this.applyVariants(target);
    this.applyPayloads(target);
    // Layers may override data at nested paths ("uuid/Body"), so we descend.
    for (const [name, child] of target.children) {
      const nested = `${dataPath}/${name}`;
      if (this.hasDataUnder(nested)) this.composeInto(nested, child);
    }
  }

  /** Composes the chosen option of each set not yet applied, like an inheritance that can be undone. */
  private applyVariants(target: WorkNode) {
    for (const v of target.variants.values()) {
      if (v.applied || v.selected === null) continue;
      const u: Undo = { children: [], attributes: [] };
      v.applied = u;
      const src = this.resolve(v.options.get(v.selected)!);
      if (!src) continue;
      for (const [k, c] of src.children) { u.children.push([k, target.children.get(k)]); target.children.set(k, c); }
      for (const [k, a] of src.attributes) { u.attributes.push([k, target.attributes.get(k)]); target.attributes.set(k, a); }
    }
  }

  /** Composes the loaded payloads, below what the node already has. */
  private applyPayloads(target: WorkNode) {
    for (const [name, p] of target.payloads) {
      if (target.loaded.has(name) || !this.payloadFiles.has(p.uri)) continue;
      target.loaded.add(name);
      const add = (k: string, c: WorkNode) => { if (!target.children.has(k)) target.children.set(k, c); };
      if (!p.path) {
        for (const r of this.payloadRoots.get(p.uri) ?? []) {
          const c = this.resolve(r);
          if (c) add(r, c);
        }
        continue;
      }
      const src = this.resolve(p.path);
      if (!src) continue;
      for (const [k, c] of src.children) add(k, c);
      for (const [k, a] of src.attributes) if (!target.attributes.has(k)) target.attributes.set(k, a);
    }
  }

  private prefixes: Set<string> | null = null;
  private hasDataUnder(p: string): boolean {
    if (this.hasData) return this.hasData(p);
    this.prefixes ??= nestedPrefixes(this.nodes);
    return this.prefixes.has(p);
  }
}
