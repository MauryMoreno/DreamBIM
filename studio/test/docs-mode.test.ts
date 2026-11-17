// Docs mode over the real folder: tree and table of the disk, creating folders, uploading files and opening them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocsMode, type DocsActions, type DocsMode } from '../src/docs/mode';
import type { DiskTree } from '../src/docs/scan';

const ROOT = 'C:/p/Casa';
const DISK: DiskTree = {
  folders: ['Planos', 'Planos/Estructura'],
  files: [
    { path: 'Planos/Plano A.pdf', mtime: 0, size: 0 },
    { path: 'Planos/Suelta.dwg', mtime: Date.UTC(2026, 0, 5), size: 0 },
    { path: 'Memoria.docx', mtime: 0, size: 0 },
  ],
};

interface Setup {
  mode: DocsMode;
  actions: DocsActions;
  askName: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
}

function setup(disk: DiskTree = DISK, folder: string | null = ROOT): Setup {
  const actions: DocsActions = {
    folder: vi.fn(() => folder),
    scan: vi.fn(async () => disk),
    pickFile: vi.fn(async () => 'C:/tmp/Nuevo.pdf'),
    addFile: vi.fn(async () => undefined),
    makeFolder: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
    openModel: vi.fn(async () => undefined),
  };
  const askName = vi.fn(async () => 'Estructura2');
  const toast = vi.fn();
  const mode = createDocsMode({ actions, toast, askName });
  return { mode, actions, askName, toast };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const rows = (mode: DocsMode): string[] => [...mode.panel(3)!.querySelectorAll('.doc-name')].map((n) => n.textContent!);
const folderRows = (mode: DocsMode): string[] => [...mode.panel(0)!.querySelectorAll('.doc-tree-name')].map((n) => n.textContent!);

async function enter(s: Setup): Promise<void> {
  s.mode.enter();
  await flush();
}

/** Enters the folder of the file (through the tree) and chooses it in the list. */
const pick = (mode: DocsMode, path: string): void => {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  mode.panel(0)!.querySelector<HTMLElement>(`[data-folder="${dir}"]`)!.click();
  const name = path.slice(path.lastIndexOf('/') + 1);
  [...mode.panel(3)!.querySelectorAll<HTMLElement>('.doc-row')].find((r) => r.querySelector('.doc-name')!.textContent === name)!.click();
};

describe('createDocsMode: la carpeta real', () => {
  it('antes de entrar no pide nada a las acciones', () => {
    const { actions } = setup();
    expect(actions.scan).not.toHaveBeenCalled();
  });

  it('it shows the subfolders and the files of the disk', async () => {
    const s = setup();
    await enter(s);
    expect(folderRows(s.mode)).toEqual(['Casa', 'Planos']);
    expect(rows(s.mode)).toEqual(['Planos', 'Memoria.docx']);
  });

  it('choosing a folder filters the files', async () => {
    const s = setup();
    await enter(s);
    s.mode.panel(0)!.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    expect(rows(s.mode)).toEqual(['Estructura', 'Plano A.pdf', 'Suelta.dwg']);
  });

  it('without a project folder it does not scan and the table stays empty', async () => {
    const s = setup(DISK, null);
    await enter(s);
    expect(s.actions.scan).not.toHaveBeenCalled();
    expect(rows(s.mode)).toEqual([]);
  });

  it('si el escaneo falla avisa y no rompe', async () => {
    const s = setup();
    vi.mocked(s.actions.scan).mockRejectedValue(new Error('denied'));
    await enter(s);
    expect(s.toast).toHaveBeenCalledWith('Could not read the project folder: denied', 'error');
  });

  it('if the folder that was being viewed disappears it goes back to the project one', async () => {
    const s = setup();
    await enter(s);
    s.mode.panel(0)!.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    vi.mocked(s.actions.scan).mockResolvedValue({ folders: [], files: [] });
    s.mode.refresh();
    await flush();
    expect(rows(s.mode)).toEqual([]);
  });
});

describe('createDocsMode: acciones', () => {
  it('New Folder crea la carpeta en el disco dentro de la elegida', async () => {
    const s = setup();
    await enter(s);
    s.mode.panel(0)!.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    await s.mode.newFolder();
    expect(s.actions.makeFolder).toHaveBeenCalledWith('Planos/Estructura2');
  });

  it('New Folder rechaza nombres con separadores y cancelar no hace nada', async () => {
    const s = setup();
    await enter(s);
    s.askName.mockResolvedValueOnce('a/b');
    await s.mode.newFolder();
    expect(s.toast).toHaveBeenCalledWith(expect.stringContaining('cannot contain'), 'info');
    s.askName.mockResolvedValueOnce(null);
    await s.mode.newFolder();
    expect(s.actions.makeFolder).not.toHaveBeenCalled();
  });

  it('Upload copia al proyecto, en la carpeta elegida', async () => {
    const s = setup();
    await enter(s);
    s.mode.panel(0)!.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    await s.mode.upload();
    expect(s.actions.addFile).toHaveBeenCalledWith('C:/tmp/Nuevo.pdf', 'Planos/Nuevo.pdf');
  });

  it('Upload of a name that is already in the folder warns and does not copy', async () => {
    const s = setup();
    vi.mocked(s.actions.pickFile).mockResolvedValue('C:/tmp/Suelta.dwg');
    await enter(s);
    s.mode.panel(0)!.querySelector<HTMLElement>('[data-folder="Planos"]')!.click();
    await s.mode.upload();
    expect(s.toast).toHaveBeenCalledWith('Suelta.dwg is already in this folder', 'info');
    expect(s.actions.addFile).not.toHaveBeenCalled();
  });

  it('cancelar el selector no copia nada', async () => {
    const s = setup();
    await enter(s);
    vi.mocked(s.actions.pickFile).mockResolvedValueOnce(null);
    await s.mode.upload();
    expect(s.actions.addFile).not.toHaveBeenCalled();
  });

  it('si la copia falla avisa y no rompe', async () => {
    const s = setup();
    vi.mocked(s.actions.addFile).mockRejectedValue(new Error('disk full'));
    await enter(s);
    await s.mode.upload();
    expect(s.toast).toHaveBeenCalledWith('Could not store the file: disk full', 'error');
  });

  it('opening a normal file opens it with the system application', async () => {
    const s = setup();
    await enter(s);
    pick(s.mode, 'Planos/Suelta.dwg');
    await s.mode.open();
    expect(s.actions.openFile).toHaveBeenCalledWith('Planos/Suelta.dwg');
    expect(s.actions.openModel).not.toHaveBeenCalled();
  });

  it('doble clic en un archivo lo abre; en una carpeta no abre nada', async () => {
    const s = setup();
    await enter(s);
    const dbl = (el: Element) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    dbl(s.mode.panel(3)!.querySelector('[data-folder="Planos"]')!);
    expect(s.actions.openFile).not.toHaveBeenCalled();
    expect(rows(s.mode)).toEqual(['Estructura', 'Plano A.pdf', 'Suelta.dwg']);
    dbl([...s.mode.panel(3)!.querySelectorAll('.doc-row')].find((r) => r.textContent!.includes('Suelta'))!);
    await flush();
    expect(s.actions.openFile).toHaveBeenCalledWith('Planos/Suelta.dwg');
  });

  it('an IFCx is opened as a model in Studio, not with another application', async () => {
    const disk: DiskTree = { folders: ['Modelos'], files: [{ path: 'Modelos/Casa.IFCX', mtime: 0, size: 5 }] };
    const s = setup(disk);
    await enter(s);
    pick(s.mode, 'Modelos/Casa.IFCX');
    await s.mode.open();
    expect(s.actions.openModel).toHaveBeenCalledWith('Modelos/Casa.IFCX');
    expect(s.actions.openFile).not.toHaveBeenCalled();
  });

  it('si el modelo no se puede abrir avisa con el motivo', async () => {
    const disk: DiskTree = { folders: [], files: [{ path: 'Casa.ifcx', mtime: 0, size: 5 }] };
    const s = setup(disk);
    vi.mocked(s.actions.openModel).mockRejectedValue(new Error('A model is already opening'));
    await enter(s);
    pick(s.mode, 'Casa.ifcx');
    await s.mode.open();
    expect(s.toast).toHaveBeenCalledWith('Could not open Casa.ifcx: A model is already opening', 'error');
  });

  it('si el sistema no puede abrirlo avisa con el motivo', async () => {
    const s = setup();
    vi.mocked(s.actions.openFile).mockRejectedValue(new Error('For safety, Studio does not open programs or scripts'));
    await enter(s);
    pick(s.mode, 'Planos/Suelta.dwg');
    await s.mode.open();
    expect(s.toast).toHaveBeenCalledWith('Could not open Suelta.dwg: For safety, Studio does not open programs or scripts', 'error');
  });

  it('open sin archivo elegido avisa', async () => {
    const s = setup();
    await enter(s);
    await s.mode.open();
    expect(s.toast).toHaveBeenCalledWith('Select a file first', 'info');
    expect(s.actions.openFile).not.toHaveBeenCalled();
  });

  it('sin carpeta de proyecto avisa antes de subir o crear carpetas', async () => {
    const s = setup(DISK, null);
    await s.mode.upload();
    await s.mode.newFolder();
    expect(s.toast).toHaveBeenCalledWith('Choose the project folder first', 'info');
    expect(s.actions.pickFile).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    document.body.innerHTML = '';
  });
});
