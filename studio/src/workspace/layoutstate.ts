export const LAYOUT_KEY = 'studio.layout';

export interface LayoutState {
  left: boolean;
  right: boolean;
  bottom: boolean;
  props: boolean;
  browser: boolean;
  ribbon: boolean;
}

export const DEFAULT_LAYOUT: LayoutState = {
  left: false,
  right: false,
  bottom: false,
  props: false,
  browser: false,
  ribbon: false,
};

/** State shared by modes and documents; a partial or corrupt value falls back to the default field by field. */
export function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_LAYOUT };
    const stored = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(DEFAULT_LAYOUT).map((key) => [key, typeof stored[key] === 'boolean' ? stored[key] : false]),
    ) as unknown as LayoutState;
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function saveLayout(s: LayoutState): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(s));
  } catch {
    /* no storage */
  }
}
