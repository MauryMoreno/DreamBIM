import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_KEY, loadLayout, saveLayout } from '../src/workspace/layoutstate';

describe('estado del layout', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sin nada guardado da DEFAULT_LAYOUT', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
    expect(Object.values(DEFAULT_LAYOUT).every((v) => v === false)).toBe(true);
    expect(LAYOUT_KEY).toBe('studio.layout');
  });

  it('guarda y lee', () => {
    saveLayout({ ...DEFAULT_LAYOUT, left: true, ribbon: true });
    expect(loadLayout()).toEqual({ ...DEFAULT_LAYOUT, left: true, ribbon: true });
  });

  it('garbage or partial JSON: the fields that are not boolean fall back to the default', () => {
    localStorage.setItem(LAYOUT_KEY, '{"left":"x","right":true}');
    expect(loadLayout()).toEqual({ ...DEFAULT_LAYOUT, right: true });
    localStorage.setItem(LAYOUT_KEY, 'no-json');
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('localStorage que lanza: load da el defecto y save no lanza', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
    expect(() => saveLayout({ ...DEFAULT_LAYOUT, left: true })).not.toThrow();
  });
});
