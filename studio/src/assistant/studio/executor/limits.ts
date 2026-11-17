import type { Toggle } from '../host';

export const TOGGLES: readonly Toggle[] = ['xray', 'section', 'shadows', 'grid'];

export const VIEWS = ['3d', 'plan', 'front', 'side'] as const;

export const FIND = { default: 50, max: 200 };

export const LIBRARY = { default: 20, max: 100 };

export const SELECTION_MAX = 200;

export const SHOT_DEFAULT = 1024;

/** The API rejects the whole request if an image weighs more than ~5 MB: a capture never exceeds this. */
export const SHOT_MAX = 1568;
