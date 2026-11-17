import type { ComposedNode, IfcxFile } from '../ifcx/types';
import { findRoots, flatten } from '../ifcx/compose';
import type { ComposerLayer } from '../composer/stack';
import { linkUri, resolveUri, sameFile } from '../composer/uri';
import { worldOrigin, type Vec3 } from '../composer/xform';
import { errorMessage, fileName } from '../model/open';
import type { Placement } from '../modeling/document';
import type { AssetRef } from '../modeling/place';
import { ForeignSession } from '../modeling/foreign';
import type { Vec2 } from '../modeling/footprint';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { MoveTarget, targetPosition, studioOf } from './move-target';

const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class PlacementService {
  constructor(private readonly ctx: DocumentContext) {}

  /**
   * World origin of the linked node a container hangs from (null if it is not in the
   * composition or the parent is from the document).
   */
  readonly placementBase = (p: Placement): Vec3 | null => {
    // in a foreign file every parent is a node (of the base, if it has no layer)
    if (p.parentLayerUri === undefined && !(this.ctx.state.current instanceof ForeignSession)) return null;
    const n = this.ctx.state.shown?.result.byOrigin.get(p.parentId)?.[0];
    return n ? worldOrigin(n) : null;
  };

  /**
   * Where a placement dropped on `origin` hangs: the element of the document it is (or that
   * contains it, e.g. the wall of its Body), or the node of another linked layer. null (with a warning) if it is a
   * node of the file itself or of something hanging from it (that would be a cycle), or if it is not in the Stage.
   */
  private placeParent(s: EditSession, l: ComposerLayer, origin: string): { id: string; layerUri?: string } | null {
    if (s.isPlaceTarget(origin)) return { id: origin };
    const node = this.ctx.state.shown?.result.byOrigin.get(origin)?.[0];
    if (!node) return null;
    const own = s.placementOf(l.uri);
    const file = this.ctx.state.files.get(l.uri);
    const roots = new Set(file ? findRoots(flatten([file])) : own?.roots ?? []);
    for (let a: ComposedNode | null = node; a; a = a.parent) {
      if (a.origin === own?.id || roots.has(a.origin)) {
        this.ctx.d.toast(`${l.name} cannot be placed inside itself`, 'info');
        return null;
      }
    }
    const { sourceOf } = this.ctx.stack.stageData();
    for (let a: ComposedNode | null = node; a; a = a.parent) {
      const src = sourceOf.get(a.origin);
      if (!src) continue;
      if (src === 'document') {
        // a document node that is not an element (the Body of a wall, a container): its element;
        // if there is none (a container in a foreign file), the layer node that contains it
        if (s.isPlaceTarget(a.origin)) return { id: a.origin };
        continue;
      }
      const layer = this.ctx.stack.edited(src);
      if (!layer) return null;
      if (layer === l) {
        this.ctx.d.toast(`${l.name} cannot be placed inside itself`, 'info');
        return null;
      }
      // the closest node that defines a layer: the clicked one, or the one that contains what was clicked
      return { id: a.origin, layerUri: layer.uri };
    }
    return null;
  }

  /**
   * Places the layer file under the `parentOrigin` node of the Stage: a document element
   * (project, site, building, level, wall, floor) or a node of another linked file. Its roots
   * come to hang from a container that follows the elevation of its level (or from the linked node). If it was already
   * placed, it changes the parent and keeps the offset. false without an editable document, if the layer
   * does not exist, if the destination is not valid (or would make a cycle) or if the file roots are not known.
   */
  place(layerId: string, parentOrigin: string): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Place', () => {
      const l = this.ctx.stack.layer(layerId);
      if (!l || this.ctx.state.current !== s) return null;
      const parent = this.placeParent(s, l, parentOrigin);
      if (!parent) return null;
      const file = this.ctx.state.files.get(l.uri);
      // without the file (not found) the roots it already had are kept
      const roots = file ? findRoots(flatten([file])) : s.placementOf(l.uri)?.roots ?? [];
      if (!roots.length) {
        this.ctx.d.toast(`Could not place ${l.name}: ${file ? 'it has no root nodes' : 'file not found'}`, 'error');
        return null;
      }
      // if it was already placed, changing the parent keeps it where it was in the world: the offset
      // compensates the difference between the old parent base (its elevation or origin) and the new one
      const prev = s.placementOf(l.uri);
      const where = (): Vec3 | null =>
        prev ? targetPosition({ branch: 'document', origin: prev.id }, studioOf(s, this.placementBase)) : null;
      const before = where();
      const placed = s.place(l.uri, parent.id, roots, parent.layerUri);
      const after = where();
      if (placed && prev && before && after) {
        prev.offset = [prev.offset[0] + before[0] - after[0], prev.offset[1] + before[1] - after[1], prev.offset[2] + before[2] - after[2]];
      }
      // a disabled layer is not seen in the Stage: it is placed anyway, but a warning is shown
      if (placed && !l.enabled) this.ctx.d.toast(`${l.name} is disabled; enable it to see it in the Stage`, 'info');
      return placed;
    });
  }

  /** Undoes the placement: the file roots return to the root. false if it was not placed. */
  unplace(layerId: string): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) return Promise.resolve(false);
    return this.ctx.stack.stackChange('Unplace', () => {
      const l = this.ctx.stack.layer(layerId);
      if (!l || this.ctx.state.current !== s) return null;
      return s.unplace(l.uri) || null;
    });
  }

  /** Layer that already links that file (without warning). */
  private layerOfFile(absPath: string): ComposerLayer | undefined {
    const docPath = this.ctx.stack.docPath();
    return this.ctx.state.layers.find((l) => sameFile(resolveUri(docPath, l.uri), absPath));
  }

  /**
   * Library: links the file (if it was not) and places it under `parentOrigin`. With `at`, the
   * container moves in plan to that point. In read-only it only links it. A file is
   * linked once: dropping it again moves it. true if it ended up linked (and placed).
   */
  async placeFile(absPath: string, parentOrigin: string, at?: Vec2): Promise<boolean> {
    // linking, placing and moving it to the point are a single undo step
    const mark = this.ctx.state.undoStack.at(-1);
    const gen = this.ctx.state.generation;
    try {
      return await this.placeFileSteps(absPath, parentOrigin, at);
    } finally {
      if (gen === this.ctx.state.generation) this.ctx.history.mergeHistory(mark, `Place ${fileName(absPath)}`);
    }
  }

  private async placeFileSteps(absPath: string, parentOrigin: string, at?: Vec2): Promise<boolean> {
    if (!this.layerOfFile(absPath) && !(await this.ctx.links.linkFile(absPath))) return false;
    const s = this.ctx.state.current;
    const l = this.layerOfFile(absPath);
    if (!s || !l) return !!l;
    if (!(await this.place(l.id, parentOrigin))) return false;
    const p = s.placementOf(l.uri);
    if (!at || !p || this.ctx.state.current !== s) return true;
    // what falls on the point is the model that is seen (its first root), not the container: if the root
    // moved on its own (an edit in its layer), the container shifts as much as needed
    const target: MoveTarget = { branch: 'document', origin: p.id };
    const pos = this.visibleRoot(p.id, p.roots[0]) ?? targetPosition(target, studioOf(s, this.placementBase));
    return this.ctx.transform.moveBy(target, [at[0] - pos[0], at[1] - pos[1], 0]);
  }

  /** World origin of the root `root` that hangs from the container `container` (null if it is not seen). */
  private visibleRoot(container: string, root: string | undefined): Vec3 | null {
    if (!root) return null;
    const n = this.ctx.state.shown?.result.byOrigin.get(root)?.find((x) => x.parent?.origin === container);
    return n ? worldOrigin(n) : null;
  }

  /**
   * Reads (without warnings) each requested file that is not a layer yet and gathers its measurements; those that were not
   * are also returned to link them as new layers when applying the placement.
   */
  async assetRefs(
    paths: string[],
    cmd: string,
  ): Promise<{ assets: Map<string, AssetRef>; nuevos: { asset: string; uri: string; file: IfcxFile }[] }> {
    const wanted: string[] = [];
    for (const path of paths) if (!wanted.includes(path)) wanted.push(path);
    const assets = new Map<string, AssetRef>();
    const nuevos: { asset: string; uri: string; file: IfcxFile }[] = [];
    for (const asset of wanted) {
      const layer = this.layerOfFile(asset);
      let file = layer ? this.ctx.state.files.get(layer.uri) : undefined;
      if (!file) {
        try {
          file = await this.ctx.links.parseLinked(await this.ctx.d.readText(asset), fileName(asset));
        } catch (e) {
          throw new Error(`${cmd}: could not read '${asset}': ${errorMessage(e)}`);
        }
      }
      const flat = flatten([file]);
      const roots = findRoots(flat);
      if (!roots.length) throw new Error(`${cmd}: '${asset}' has no root nodes`);
      const attrs = flat.get(roots[0])?.attributes ?? {};
      const cls = attrs['bsi::ifc::class'];
      const measure = (key: string): number | undefined =>
        typeof attrs[key] === 'number' && Number.isFinite(attrs[key]) ? (attrs[key] as number) : undefined;
      const uri = layer?.uri ?? linkUri(this.ctx.stack.docPath(), asset);
      assets.set(asset, {
        layerUri: uri,
        roots,
        name: fileName(asset).replace(/\.ifcx$/i, ''),
        ifcClass: plain(cls) && typeof cls.code === 'string' ? cls.code : null,
        width: measure('bsi::ifc::prop::Width'),
        depth: measure('bsi::ifc::prop::Depth'),
        height: measure('bsi::ifc::prop::Height'),
      });
      if (!layer && !nuevos.some((n) => n.uri === uri)) nuevos.push({ asset, uri, file });
    }
    return { assets, nuevos };
  }
}
