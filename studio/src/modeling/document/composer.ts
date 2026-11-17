import { hostedOrigin, wallAngle, type WallHost } from '../hosting';
import { composeRows } from '../../composer/xform';
import { WallParams, Placement, ComposerMeta, StudioDoc } from './types';
import { levelById } from './levels';
import { K_CLASS, K_NAME, K_WALL, K_FLOOR, CONTAINER_PREFIX } from './keys';
import { isObj, isNum, isStr } from './read';

/** 4x4 matrix by rows with the translation in the last row (format of `usd::xformop`). */
export const translation = (x: number, y: number, z: number) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, y, z, 1]];

/** xformop of the container of a placement: its offset (plus `baseZ`), rotation and scale. */
export function placementTransform(p: Placement, baseZ = 0): number[][] {
  const t: [number, number, number] = [p.offset[0], p.offset[1], p.offset[2] + baseZ];
  return p.rotation || p.scale ? composeRows(t, p.rotation ?? [0, 0, 0], p.scale ?? [1, 1, 1]) : translation(...t);
}

/** xformop of the container of a hosted piece: on the axis of the wall, rotated with it. */
export function hostedTransform(w: WallParams, baseZ: number, h: WallHost): number[][] {
  const [x, y] = hostedOrigin(w, h.along);
  return composeRows([x, y, baseZ + h.sill], [0, 0, wallAngle(w)], [1, 1, 1]);
}

/** Copy of the composer with only the persistent fields (without the session id of the layers). */
export const serializeComposer = (c: ComposerMeta): ComposerMeta => ({
  layers: c.layers.map((l) => ({
    uri: l.uri, name: l.name, color: l.color, enabled: l.enabled, editsEnabled: l.editsEnabled, edits: l.edits,
  })),
  placements: c.placements,
});

/** Ids of the document that a linked file can hang from: project, site, building, levels, walls and floors. */
export function placeParents(doc: StudioDoc): Set<string> {
  const { ids, levels, walls, floors } = doc;
  return new Set([ids.project, ids.site, ids.building, ...levels.map((l) => l.id), ...walls.map((w) => w.id), ...floors.map((f) => f.id)]);
}

/**
 * Valid parent of a placement: its own if it exists (a document id, or a node of a layer
 * that is still linked); otherwise, the project (without this fix, it would be discarded when read).
 */
export function validParent(p: Placement, parents: Set<string>, uris: Set<string>, project: string): Placement {
  const ok = p.parentLayerUri !== undefined ? uris.has(p.parentLayerUri) && p.parentLayerUri !== p.layerUri : parents.has(p.parentId);
  if (ok) return p;
  const { parentLayerUri: _gone, ...rest } = p;
  return { ...rest, parentId: project };
}

/** Does the hosted piece hang from a wall of the document? (a normal placement always qualifies) */
export const hostIsValid = (doc: Pick<StudioDoc, 'walls'>, p: Placement): boolean =>
  p.host === undefined || (p.parentLayerUri === undefined && doc.walls.some((w) => w.id === p.parentId));

/** Composer that is saved: without the placements of layers that are no longer there and with valid parents. */
export function savedComposer(doc: StudioDoc): ComposerMeta {
  const { composer, ids } = doc;
  const uris = new Set(composer.layers.map((l) => l.uri));
  const parents = placeParents(doc);
  return {
    layers: composer.layers,
    placements: composer.placements
      .filter((p) => uris.has(p.layerUri) && hostIsValid(doc, p))
      .map((p) => validParent(p, parents, uris, ids.project)),
  };
}

/**
 * Effective parent when writing the container: that of a node of a disabled layer is not in the
 * composition, so meanwhile it hangs from the project (without changing what is saved).
 */
export function effectiveParent(c: ComposerMeta, p: Placement, project: string): string {
  if (p.parentLayerUri === undefined) return p.parentId;
  return c.layers.find((l) => l.uri === p.parentLayerUri)?.enabled ? p.parentId : project;
}

/** Hijos de `parentId` que son contenedores de archivos enlazados. */
export const placementChildren = (c: ComposerMeta, parentId: string, project: string): Record<string, string> =>
  Object.fromEntries(c.placements.filter((p) => effectiveParent(c, p, project) === parentId).map((p) => [p.id, p.id]));

/**
 * Elevation the container follows: that of the level if it hangs from a level, or of the level of its wall or floor;
 * 0 under the project, the site, the building or a linked node (which already contributes its transformation).
 */
export function placementBaseZ(doc: Pick<StudioDoc, 'levels' | 'walls' | 'floors'>, p: Placement): number {
  if (p.parentLayerUri !== undefined) return 0;
  const levelId =
    levelById(doc.levels, p.parentId)?.id ??
    doc.walls.find((w) => w.id === p.parentId)?.baseLevelId ??
    doc.floors.find((f) => f.id === p.parentId)?.levelId;
  return (levelId && levelById(doc.levels, levelId)?.elevation) || 0;
}

/** Attributes of a linked-file container (those `toIfcx` writes for a placement)? */
export function esContenedor(a: Record<string, unknown>): boolean {
  return (
    a[K_CLASS] === undefined && a[K_WALL] === undefined && a[K_FLOOR] === undefined &&
    typeof a[K_NAME] === 'string' && a[K_NAME].startsWith(CONTAINER_PREFIX) && isObj(a['usd::xformop'])
  );
}

/**
 * Saved composer; null if it is missing or malformed. The placement of a layer that is not there is
 * discarded; the parents are validated afterwards, with the whole document read. `containers`: ids of
 * all the placements read (also the discarded ones).
 */
export function parseComposer(raw: unknown): (ComposerMeta & { containers: Set<string> }) | null {
  if (!isObj(raw) || !Array.isArray(raw.layers) || !Array.isArray(raw.placements)) return null;
  const layers: ComposerMeta['layers'] = [];
  for (const l of raw.layers) {
    if (!isObj(l) || !isStr(l.uri)) return null;
    if (l.edits !== undefined && !(Array.isArray(l.edits) && l.edits.every((n) => isObj(n) && isStr(n.path)))) return null;
    layers.push({
      uri: l.uri,
      name: typeof l.name === 'string' ? l.name : l.uri,
      color: typeof l.color === 'string' ? l.color : '',
      enabled: l.enabled !== false,
      editsEnabled: l.editsEnabled !== false,
      edits: JSON.parse(JSON.stringify(l.edits ?? [])),
    });
  }
  const placements: Placement[] = [];
  const ids = new Set<string>();
  for (const p of raw.placements) {
    const o = isObj(p) ? p.offset : undefined;
    const vec = (v: unknown) => v === undefined || (Array.isArray(v) && v.length === 3 && v.every(isNum));
    const h = isObj(p) ? p.host : undefined;
    const hostOk =
      h === undefined ||
      (isObj(h) && isNum(h.along) && isNum(h.sill) && isNum(h.width) && isNum(h.height) && h.width > 0 && h.height > 0);
    if (
      !isObj(p) || !isStr(p.id) || ids.has(p.id) || !isStr(p.layerUri) || !isStr(p.parentId) ||
      (p.parentLayerUri !== undefined && !isStr(p.parentLayerUri)) ||
      !Array.isArray(p.roots) || !p.roots.every(isStr) ||
      !Array.isArray(o) || o.length !== 3 || !o.every(isNum) ||
      !vec(p.rotation) || !vec(p.scale) || (Array.isArray(p.scale) && p.scale.some((v) => v === 0)) || !hostOk
    ) {
      return null;
    }
    ids.add(p.id);
    if (!layers.some((l) => l.uri === p.layerUri)) continue;
    placements.push({
      id: p.id, layerUri: p.layerUri, parentId: p.parentId, ...(isStr(p.parentLayerUri) ? { parentLayerUri: p.parentLayerUri } : {}),
      roots: [...p.roots], offset: [o[0], o[1], o[2]],
      ...(Array.isArray(p.rotation) ? { rotation: [p.rotation[0], p.rotation[1], p.rotation[2]] as [number, number, number] } : {}),
      ...(Array.isArray(p.scale) ? { scale: [p.scale[0], p.scale[1], p.scale[2]] as [number, number, number] } : {}),
      ...(isObj(h) ? { host: { along: h.along as number, sill: h.sill as number, width: h.width as number, height: h.height as number } } : {}),
    });
  }
  return { layers, placements, containers: ids };
}
