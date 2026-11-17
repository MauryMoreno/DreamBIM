// Scan of the project folder: everything on the disk, without a registry.
import { describe, expect, it, vi } from 'vitest';
import { scanProject } from '../src/docs/scan';
import type { FileEntry } from '../src/platform/files';

const dir = (name: string): FileEntry => ({ name, path: '', isDir: true });
const file = (name: string, mtime = 0): FileEntry => ({ name, path: '', isDir: false, mtime });

function fakeDisk(tree: Record<string, FileEntry[]>) {
  return vi.fn(async (d: string): Promise<FileEntry[]> => {
    const key = d.replace(/^C:\/p\/Casa\/?/, '');
    if (!(key in tree)) throw new Error(`no such folder ${d}`);
    return tree[key];
  });
}

describe('scanProject', () => {
  it('recorre las subcarpetas y da rutas relativas con /', async () => {
    const list = fakeDisk({
      '': [dir('Planos'), file('Memoria.docx', 5)],
      Planos: [dir('Estructura'), file('A.pdf')],
      'Planos/Estructura': [file('B.dwg')],
    });
    const t = await scanProject('C:/p/Casa', list);
    expect(t.folders).toEqual(['Planos', 'Planos/Estructura']);
    expect(t.files.map((f) => f.path).sort()).toEqual(['Memoria.docx', 'Planos/A.pdf', 'Planos/Estructura/B.dwg']);
    expect(t.files.find((f) => f.path === 'Memoria.docx')!.mtime).toBe(5);
  });

  it('with the root written with Windows slashes or with a trailing slash', async () => {
    const list = vi.fn(async () => [file('A.pdf')]);
    await scanProject('C:\\p\\Casa\\', list);
    expect(list).toHaveBeenCalledWith('C:\\p\\Casa');
  });

  it('salta solo lo oculto: los archivos y carpetas visibles salen todos', async () => {
    const list = fakeDisk({
      '': [dir('.git'), dir('Documents.documentos'), file('Documents.documentos.ifcx'), file('.DS_Store'), file('A.pdf')],
    });
    const t = await scanProject('C:/p/Casa', list);
    expect(t.folders).toEqual(['Documents.documentos']);
    expect(t.files.map((f) => f.path).sort()).toEqual(['A.pdf', 'Documents.documentos.ifcx']);
  });

  it('an unreadable subfolder is ignored; an unreadable root throws', async () => {
    const t = await scanProject('C:/p/Casa', fakeDisk({ '': [dir('Privada'), file('A.pdf')] }));
    expect(t.folders).toEqual(['Privada']);
    expect(t.files).toHaveLength(1);
    await expect(scanProject('C:/p/Casa', async () => { throw new Error('denied'); })).rejects.toThrow('denied');
  });

  it('corta a 5000 archivos y a 8 niveles de profundidad', async () => {
    const many = Array.from({ length: 6000 }, (_, i) => file(`f${i}.pdf`));
    expect((await scanProject('C:/p/Casa', async () => many)).files).toHaveLength(5000);
    const deep = vi.fn(async () => [dir('n')]);
    const t = await scanProject('C:/p/Casa', deep);
    expect(t.folders).toHaveLength(8);
    expect(deep).toHaveBeenCalledTimes(8);
  });
});
