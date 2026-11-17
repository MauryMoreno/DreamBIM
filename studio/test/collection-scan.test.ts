import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/library/librarypanel';
import { scanLibrary } from '../src/collection/scan';

const f = (path: string): LibraryEntry => ({ name: path.split('/').at(-1)!, path, isDir: false, mtime: 1 });
const d = (path: string): LibraryEntry => ({ name: path.split('/').at(-1)!, path, isDir: true, mtime: 1 });

const DISK: Record<string, LibraryEntry[]> = {
  '/lib': [d('/lib/hvac'), d('/lib/rota'), f('/lib/suelta.ifcx')],
  '/lib/hvac': [d('/lib/hvac/Grille'), f('/lib/hvac/a.ifcx')],
  '/lib/hvac/Grille': [f('/lib/hvac/Grille/g1.ifcx'), f('/lib/hvac/Grille/g2.ifcx')],
};
const list = async (dir: string) => {
  const l = DISK[dir];
  if (!l) throw new Error(`Could not read ${dir}`);
  return l;
};

describe('scanLibrary', () => {
  it('recorre en profundidad y devuelve solo archivos', async () => {
    const r = await scanLibrary('/lib', list);
    expect(r.files.map((e) => e.path)).toEqual([
      '/lib/hvac/Grille/g1.ifcx',
      '/lib/hvac/Grille/g2.ifcx',
      '/lib/hvac/a.ifcx',
      '/lib/suelta.ifcx',
    ]);
  });

  it('una subcarpeta ilegible se anota y el recorrido sigue', async () => {
    const r = await scanLibrary('/lib', list);
    expect(r.errors).toEqual(['Could not read /lib/rota']);
    expect(r.files).toHaveLength(4);
  });

  it('it launches the indexer with the files of all the subfolders', async () => {
    await expect(scanLibrary('/nada', list)).rejects.toThrow('Could not read /nada');
  });
});
