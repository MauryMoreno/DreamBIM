import { afterEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

import { files, setFiles, type Files } from '../src/platform/files';
import { isWeb } from '../src/platform/env';
import { readTextFile } from '../src/model/open';
import { listLibrary } from '../src/library/disk';

function fake(over: Partial<Files> = {}): Files {
  const nope = () => Promise.reject(new Error('not used'));
  return {
    readText: nope,
    readBinary: nope,
    writeText: nope,
    copyFile: nope,
    makeDir: nope,
    openExternal: nope,
    listAll: nope,
    exists: nope,
    mtime: nope,
    listDir: nope,
    search: nope,
    pickOpen: nope,
    pickSave: nope,
    pickFolder: nope,
    defaultLibraryFolder: () => null,
    ...over,
  };
}

afterEach(() => {
  setFiles(null);
  vi.clearAllMocks();
});

describe('platform/files', () => {
  it('sin setFiles usa Tauri', async () => {
    tauri.invoke.mockResolvedValue('hola');
    expect(await files().readText('C:/a.ifcx')).toBe('hola');
    expect(tauri.invoke).toHaveBeenCalledWith('read_text_file', { path: 'C:/a.ifcx' });
  });

  it('un error de Tauri (cadena) se convierte en Error', async () => {
    tauri.invoke.mockRejectedValue('Could not read C:/a.ifcx');
    await expect(files().readText('C:/a.ifcx')).rejects.toThrow('Could not read C:/a.ifcx');
  });

  it('readBinary returns a Uint8Array over the ArrayBuffer of the raw IPC response', async () => {
    const raw = new Uint8Array([80, 75, 3, 4]).buffer;
    tauri.invoke.mockResolvedValue(raw);
    const bytes = await files().readBinary('C:/a.xlsx');
    expect(bytes).toEqual(new Uint8Array([80, 75, 3, 4]));
    expect(bytes.buffer).toBe(raw);
    expect(tauri.invoke).toHaveBeenCalledWith('read_binary_file', { path: 'C:/a.xlsx' });
  });

  it('readTextFile de model/open usa el Files configurado; setFiles(null) lo restaura', async () => {
    setFiles(fake({ readText: async (p) => `fake:${p}` }));
    expect(await readTextFile('x')).toBe('fake:x');
    setFiles(null);
    tauri.invoke.mockResolvedValue('real');
    expect(await readTextFile('y')).toBe('real');
  });

  it('listLibrary de library/disk llama a listDir', async () => {
    const listDir = vi.fn(async () => [{ name: 'a', path: '/d/a', isDir: true }]);
    setFiles(fake({ listDir }));
    expect(await listLibrary('/d')).toEqual([{ name: 'a', path: '/d/a', isDir: true }]);
    expect(listDir).toHaveBeenCalledWith('/d');
  });

  it('the dialogs are Rust commands, so what the user picks is what grants access', async () => {
    const filters = [{ name: 'IFCx Model', extensions: ['ifcx'] }];
    tauri.invoke.mockResolvedValueOnce('C:/Work/a.ifcx');
    expect(await files().pickOpen(filters)).toBe('C:/Work/a.ifcx');
    expect(tauri.invoke).toHaveBeenLastCalledWith('pick_open_file', { filters });

    tauri.invoke.mockResolvedValueOnce('C:/Work/b.ifcx');
    expect(await files().pickSave('b.ifcx', filters)).toBe('C:/Work/b.ifcx');
    expect(tauri.invoke).toHaveBeenLastCalledWith('pick_save_path', { suggested: 'b.ifcx', filters });

    tauri.invoke.mockResolvedValueOnce('C:/Work');
    expect(await files().pickFolder()).toBe('C:/Work');
    expect(tauri.invoke).toHaveBeenLastCalledWith('pick_folder', {});
  });

  it('a cancelled dialog gives null', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect(await files().pickOpen([])).toBeNull();
    expect(await files().pickSave('x.ifcx', [])).toBeNull();
    expect(await files().pickFolder()).toBeNull();
  });

  it('isWeb() es false en pruebas', () => {
    expect(isWeb()).toBe(false);
  });
});
