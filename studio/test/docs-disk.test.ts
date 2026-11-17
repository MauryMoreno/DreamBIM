// Docs disk in the web demo (in memory), with the same checks as the Rust commands: only
// escribe dentro de la carpeta elegida, sin «..» y sin sobrescribir.
import { afterEach, describe, expect, it } from 'vitest';
import { files, setFiles } from '../src/platform/files';
import { webFiles } from '../src/platform/web-files';

const SRC = '/local/a.pdf';
const ROOT = 'C:/p/Casa';
const PROJECT = '/C:/p/Casa';
const REJECT = 'Files can only be written inside the project folder';

function web() {
  const f = webFiles();
  f.memory.set(SRC, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  setFiles(f);
  return f;
}

afterEach(() => setFiles(null));

describe('proyecto de Docs en la demo web', () => {
  it('copyFile copia dentro de la carpeta elegida y no sobrescribe', async () => {
    const f = web();
    await files().copyFile(SRC, 'C:/p/Casa/Planos/A.pdf', ROOT);
    expect(f.memory.get(`${PROJECT}/Planos/A.pdf`)).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    await expect(files().copyFile(SRC, 'C:/p/Casa/Planos/A.pdf', ROOT)).rejects.toThrow('A file with that name is already stored');
  });

  it('fuera de la carpeta elegida no escribe nada', async () => {
    const f = web();
    await expect(files().copyFile(SRC, 'C:/otro/A.pdf', ROOT)).rejects.toThrow(REJECT);
    await expect(files().makeDir('C:/otro/Nueva', ROOT)).rejects.toThrow(REJECT);
    expect(f.memory.has('/C:/otro/A.pdf')).toBe(false);
  });

  it('with .. in the destination it fails, even if it is inside the folder', async () => {
    web();
    await expect(files().copyFile(SRC, 'C:/p/Casa/Planos/../../fuera.pdf', ROOT)).rejects.toThrow(REJECT);
  });

  it('makeDir creates a folder that listAll shows; a repeated one fails', async () => {
    web();
    await files().makeDir('C:/p/Casa/Planos', ROOT);
    await files().copyFile(SRC, 'C:/p/Casa/Memoria.pdf', ROOT);
    const root = await files().listAll('C:/p/Casa');
    expect(root.map((e) => [e.name, e.isDir])).toEqual([['Planos', true], ['Memoria.pdf', false]]);
    await expect(files().makeDir('C:/p/Casa/Planos', ROOT)).rejects.toThrow('already exists');
  });

  it('opening with another application does not exist in the web demo', async () => {
    web();
    await expect(files().openExternal('C:/p/Casa/A.pdf')).rejects.toThrow('not available in the web demo');
  });

  it('listAll deduces the subfolders from the files and skips what is hidden', async () => {
    const f = web();
    f.memory.set(`${PROJECT}/Planos/Estructura/A.pdf`, 'x');
    f.memory.set(`${PROJECT}/.oculto/x.txt`, 'x');
    const root = await files().listAll('C:/p/Casa');
    expect(root.map((e) => e.name)).toEqual(['Planos']);
    expect((await files().listAll('C:/p/Casa/Planos')).map((e) => [e.name, e.isDir])).toEqual([['Estructura', true]]);
  });
});
