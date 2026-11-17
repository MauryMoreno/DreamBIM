import type { FloorParams, WallParams } from '../document';

export type EditError = 'unknown' | 'empty-name' | 'duplicate-name' | 'bad-number' | 'wall-height' | 'opening' | 'stair';
/** Restricciones editables de un muro (Properties › Constraints). */
export type WallPatch = Partial<Pick<WallParams, 'baseLevelId' | 'baseOffset' | 'topLevelId' | 'topOffset' | 'height'>>;
/** Restricciones editables de un suelo (Properties › Constraints). */
export type FloorPatch = Partial<Pick<FloorParams, 'levelId' | 'offset'>>;
export type EditResult = { ok: true } | { ok: false; error: EditError };

export const OK: EditResult = { ok: true };
export const fail = (error: EditError): EditResult => ({ ok: false, error });
