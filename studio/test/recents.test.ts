import { describe, expect, it } from 'vitest';
import { MAX_RECENTS, addRecent, removeRecent, samePath, type RecentEntry } from '../src/home/recents';

const e = (path: string, openedAt: number, thumbnail: string | null = null): RecentEntry => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  openedAt,
  thumbnail,
});

describe('recientes', () => {
  it('the most recent goes first', () => {
    const a = e('C:\\X\\a.ifcx', 1);
    const b = e('C:\\X\\b.ifcx', 2);
    expect(addRecent(addRecent([], a), b)).toEqual([b, a]);
  });

  it('no duplica', () => {
    const first = e('C:\\X\\a.ifcx', 1);
    const second = e('c:/x/A.IFCX', 2);
    const result = addRecent([first], second);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(second);
  });

  it('conserva la miniatura previa si la nueva es null', () => {
    const first = e('C:\\X\\a.ifcx', 1, 'data:image/png;base64,AAA');
    const result = addRecent([first], e('C:\\X\\a.ifcx', 2, null));
    expect(result[0].thumbnail).toBe('data:image/png;base64,AAA');
    expect(result[0].openedAt).toBe(2);
  });

  it('maximum 12', () => {
    let list: RecentEntry[] = [];
    for (let i = 0; i < 13; i++) list = addRecent(list, e(`C:\\X\\m${i}.ifcx`, i));
    expect(MAX_RECENTS).toBe(12);
    expect(list).toHaveLength(12);
    expect(list[0].path).toBe('C:\\X\\m12.ifcx');
    expect(list.some((r) => r.path === 'C:\\X\\m0.ifcx')).toBe(false);
  });

  it('removeRecent quita usando samePath', () => {
    const a = e('C:\\X\\a.ifcx', 1);
    const b = e('C:\\X\\b.ifcx', 2);
    const input = [b, a];
    expect(removeRecent(input, 'c:/x/A.IFCX')).toEqual([b]);
    expect(input).toEqual([b, a]);
  });

  it('samePath ignores case and separators', () => {
    expect(samePath('C:\\X\\a.ifcx', 'c:/x/A.IFCX')).toBe(true);
    expect(samePath('C:\\X\\a.ifcx', 'C:\\X\\b.ifcx')).toBe(false);
  });
});
