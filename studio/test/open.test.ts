import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

import { fileName, openPath, pickPath, pickSavePath, writeTextFile } from '../src/model/open';
import { InvalidModelError } from '../src/model/load';
import { ForeignSession } from '../src/modeling/foreign';
import { newSession } from '../src/modeling/session';

const MODELO = JSON.stringify({
  header: { id: 'x', ifcxVersion: 'ifcx_alpha', dataVersion: '1.0.0', author: 'a', timestamp: '2026-01-01T00:00:00Z' },
  imports: [],
  schemas: {},
  data: [],
});

beforeEach(() => vi.clearAllMocks());

describe('apertura de archivos', () => {
  it('fileName takes the last segment of Windows and POSIX paths', () => {
    expect(fileName('C:\\a\\b\\muro.ifcx')).toBe('muro.ifcx');
    expect(fileName('/a/b/muro.ifcx')).toBe('muro.ifcx');
  });

  it('openPath reads with read_text_file; a generic IFCx is opened editable as a ForeignSession', async () => {
    tauri.invoke.mockResolvedValue(MODELO);
    const { model: m, session, studioUnreadable } = await openPath('C:\\x\\muro.ifcx');
    expect(tauri.invoke).toHaveBeenCalledWith('read_text_file', { path: 'C:\\x\\muro.ifcx' });
    expect(m.name).toBe('muro.ifcx');
    expect(m.path).toBe('C:\\x\\muro.ifcx');
    expect(session).toBeInstanceOf(ForeignSession);
    expect(session!.path).toBe('C:\\x\\muro.ifcx');
    expect(session!.dirty).toBe(false);
    expect(studioUnreadable).toBe(false);
    // the model is only the minimal layer: the base is composed by the controller
    expect([...m.result.byPath.keys()].filter(Boolean)).toEqual([]);
  });

  it('openPath of a Studio file returns a clean session with the path', async () => {
    const s = newSession();
    s.addWall([0, 0], [4, 0]);
    tauri.invoke.mockResolvedValue(await s.serialize());
    const { model, session } = await openPath('C:/x/casa.ifcx');
    expect(model.name).toBe('casa.ifcx');
    expect(session).not.toBeNull();
    expect(session!.path).toBe('C:/x/casa.ifcx');
    expect(session!.dirty).toBe(false);
    expect(session!.doc.walls).toHaveLength(1);
  });

  it('studioUnreadable: true si es de Studio pero ilegible; false en el resto', async () => {
    const s = newSession();
    s.addWall([0, 0], [4, 0]);
    const sano = await s.serialize();
    tauri.invoke.mockResolvedValue(sano);
    expect((await openPath('C:/x/a.ifcx')).studioUnreadable).toBe(false);

    const sinMuro = JSON.parse(sano);
    for (const n of sinMuro.data) if (n.attributes) delete n.attributes['ifcx-studio::wall'];
    tauri.invoke.mockResolvedValue(JSON.stringify(sinMuro));
    const dañado = await openPath('C:/x/b.ifcx');
    expect(dañado.session).toBeNull();
    expect(dañado.studioUnreadable).toBe(true);

    const futuro6 = JSON.parse(sano);
    for (const n of futuro6.data) if (n.attributes?.['ifcx-studio::document']) n.attributes['ifcx-studio::document'].version = 6;
    tauri.invoke.mockResolvedValue(JSON.stringify(futuro6));
    const futuro = await openPath('C:/x/c.ifcx');
    expect(futuro.session).toBeNull();
    expect(futuro.studioUnreadable).toBe(true);

    tauri.invoke.mockResolvedValue(MODELO);
    expect((await openPath('C:/x/d.ifcx')).studioUnreadable).toBe(false);
  });

  it('un contenido que no es IFCx lanza InvalidModelError', async () => {
    tauri.invoke.mockResolvedValue('hola');
    await expect(openPath('C:\\x\\hola.ifcx')).rejects.toBeInstanceOf(InvalidModelError);
  });

  it('un error de lectura (cadena de Tauri) se convierte en Error con el mensaje', async () => {
    tauri.invoke.mockRejectedValue('Could not read C:\\x: access denied');
    await expect(openPath('C:\\x')).rejects.toThrow('Could not read C:\\x: access denied');
  });

  it('pickPath returns null if the dialog is cancelled and filters to .ifcx', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect(await pickPath()).toBeNull();
    expect(tauri.invoke).toHaveBeenCalledWith('pick_open_file', { filters: [{ name: 'IFCx Model', extensions: ['ifcx'] }] });
  });
});

describe('guardado de archivos', () => {
  it('pickSavePath adds .ifcx if missing and filters to .ifcx', async () => {
    tauri.invoke.mockResolvedValue('C:\\x\\casa');
    expect(await pickSavePath('casa.ifcx')).toBe('C:\\x\\casa.ifcx');
    expect(tauri.invoke).toHaveBeenCalledWith('pick_save_path', {
      suggested: 'casa.ifcx',
      filters: [{ name: 'IFCx Model', extensions: ['ifcx'] }],
    });
  });

  it('pickSavePath respects an existing .IFCX extension', async () => {
    tauri.invoke.mockResolvedValue('C:\\x\\casa.IFCX');
    expect(await pickSavePath('casa.ifcx')).toBe('C:\\x\\casa.IFCX');
  });

  it('pickSavePath devuelve null si se cancela', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect(await pickSavePath('casa.ifcx')).toBeNull();
  });

  it('writeTextFile invoca write_text_file con path y contents', async () => {
    tauri.invoke.mockResolvedValue(undefined);
    await writeTextFile('C:\\x\\a.ifcx', 'texto');
    expect(tauri.invoke).toHaveBeenCalledWith('write_text_file', { path: 'C:\\x\\a.ifcx', contents: 'texto' });
  });

  it('writeTextFile convierte un rechazo de cadena en Error', async () => {
    tauri.invoke.mockRejectedValue('Could not save C:\\x: denied');
    await expect(writeTextFile('C:\\x', 't')).rejects.toThrow('Could not save C:\\x: denied');
  });
});
