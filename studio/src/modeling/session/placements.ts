// Placements of linked files in a Studio document: pure functions over the document. The session wraps them
// and marks itself dirty when `changed` is true.
import { hostsOf, placeParents, wallHeight, type Placement, type StudioDoc } from '../document';
import { checkHost, wallLength, type WallHost } from '../hosting';
import { fail, OK, type EditResult } from './result';

type Vec3 = [number, number, number];

/** Is `id` an element of the document that can contain a linked file? Project, site, building, level, wall or floor. */
export const isPlaceTarget = (doc: StudioDoc, id: string): boolean => placeParents(doc).has(id);

export const placementOf = (doc: StudioDoc, layerUri: string): Placement | undefined =>
  doc.composer.placements.find((p) => p.layerUri === layerUri);

/**
 * Always adds a NEW placement (does not reuse the file's one). null if the parent is not valid, there are no
 * roots, or there is a `host` and the parent is not a wall. It does not check that the piece fits.
 */
export function addPlacement(
  doc: StudioDoc,
  layerUri: string,
  parentId: string,
  roots: string[],
  at?: { offset?: Vec3; rotation?: Vec3; host?: WallHost },
): Placement | null {
  if (!roots.length || !isPlaceTarget(doc, parentId)) return null;
  if (at?.host && !doc.walls.some((w) => w.id === parentId)) return null;
  const p: Placement = {
    id: crypto.randomUUID(),
    layerUri,
    parentId,
    roots: [...roots],
    offset: at?.offset ? [at.offset[0], at.offset[1], at.offset[2]] : [0, 0, 0],
    ...(at?.rotation ? { rotation: [at.rotation[0], at.rotation[1], at.rotation[2]] as Vec3 } : {}),
    ...(at?.host ? { host: { ...at.host } } : {}),
  };
  doc.composer.placements.push(p);
  return p;
}

/** Removes a placement by its id; false if it does not exist. */
export function removePlacement(doc: StudioDoc, id: string): boolean {
  const list = doc.composer.placements;
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/**
 * Places the file `layerUri` under `parentId` with those roots: an element of the document or, with
 * `parentLayerUri`, the origin of a node of that other linked layer (the caller checks that it exists and does not
 * form a cycle). If it was already placed, the parent and the roots change and its offset is kept.
 * null if the parent is not valid or there are no roots; false if nothing changes; true if it changed.
 */
export function placeFile(doc: StudioDoc, layerUri: string, parentId: string, roots: string[], parentLayerUri?: string): boolean | null {
  const valid = parentLayerUri !== undefined ? parentLayerUri !== layerUri : isPlaceTarget(doc, parentId);
  if (!valid || !roots.length) return null;
  const prev = placementOf(doc, layerUri);
  if (prev) {
    const same = prev.roots.length === roots.length && prev.roots.every((r, i) => r === roots[i]);
    if (prev.parentId === parentId && prev.parentLayerUri === parentLayerUri && same) return false;
    // a hosted piece that changes parent leaves its wall: it is no longer hosted (and the opening closes)
    if (prev.parentId !== parentId || parentLayerUri !== undefined) delete prev.host;
    prev.parentId = parentId;
    if (parentLayerUri !== undefined) prev.parentLayerUri = parentLayerUri;
    else delete prev.parentLayerUri;
    prev.roots = [...roots];
  } else {
    doc.composer.placements.push({
      id: crypto.randomUUID(), layerUri, parentId, ...(parentLayerUri !== undefined ? { parentLayerUri } : {}),
      roots: [...roots], offset: [0, 0, 0],
    });
  }
  return true;
}

/** Removes every placement of the file; false if there was none. */
export function unplaceFile(doc: StudioDoc, layerUri: string): boolean {
  const before = doc.composer.placements.length;
  doc.composer.placements = doc.composer.placements.filter((p) => p.layerUri !== layerUri);
  return doc.composer.placements.length !== before;
}

/**
 * Moves the container of a placement. A hosted piece slides along the axis of its wall (x, y are projected onto it)
 * and changes its sill with z; if it stops fitting, nothing changes. `changed` tells whether the document changed.
 */
export function movePlacement(doc: StudioDoc, id: string, d: Vec3): { result: EditResult; changed: boolean } {
  const p = doc.composer.placements.find((x) => x.id === id);
  if (!p) return { result: fail('unknown'), changed: false };
  if (!d.every(Number.isFinite)) return { result: fail('bad-number'), changed: false };
  if (d.every((v) => v === 0)) return { result: OK, changed: false };
  if (p.host) {
    const w = doc.walls.find((x) => x.id === p.parentId);
    if (!w) return { result: fail('unknown'), changed: false };
    const length = wallLength(w);
    const dx = length > 0 ? (w.end[0] - w.start[0]) / length : 0;
    const dy = length > 0 ? (w.end[1] - w.start[1]) / length : 0;
    const next: WallHost = { ...p.host, along: p.host.along + d[0] * dx + d[1] * dy, sill: p.host.sill + d[2] };
    const others = hostsOf(doc, w.id).flatMap((x) => (x.id !== p.id && x.host ? [x.host] : []));
    if (checkHost(length, wallHeight(doc.levels, w), next, others)) return { result: fail('opening'), changed: false };
    p.host = next;
    return { result: OK, changed: true };
  }
  p.offset = [p.offset[0] + d[0], p.offset[1] + d[1], p.offset[2] + d[2]];
  return { result: OK, changed: true };
}
