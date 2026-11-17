// Editable Studio document and its serialization to/from IFCx.

export type { LevelParams, WallParams, FloorParams, StairParams, Placement, ComposerMeta, StudioDoc } from './document/types';
export { levelById, sortedLevels, wallBaseZ, wallHeight, floorTopZ, floorQuantities, newDocument, wallQuantities, hostsOf, stairOf, stairNodeIds } from './document/levels';
export { K_DOC, K_STAIR, K_COMPOSER, CONTAINER_PREFIX } from './document/keys';
export { placementTransform, hostedTransform, serializeComposer, placeParents, parseComposer } from './document/composer';
export { toIfcx } from './document/write';
export { fromIfcx } from './document/read';
