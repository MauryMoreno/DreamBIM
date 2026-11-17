// Docs screen: without a folder it asks to choose one, with a folder it enables the commands, Back and Esc return to Home.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDocsScreen } from '../src/app/docs-screen';
import { renderHome } from '../src/home/home';
import { mountShell } from '../src/shell/screens';
import { setFiles, type Files } from '../src/platform/files';

const DIR = 'C:/proyectos/Casa';
let disk: Map<string, string>;

beforeEach(() => {
  localStorage.clear();
  disk = new Map();
  setFiles({
    readText: async (p: string) => disk.get(p) ?? '',
    exists: async (p: string) => disk.has(p),
    listAll: async () => [],
    writeText: async (p: string, t: string) => void disk.set(p, t),
  } as unknown as Files);
  document.body.innerHTML = '<div id="root"></div>';
});

function setup(pick: () => Promise<string | null> = async () => DIR) {
  const shell = mountShell(document.getElementById('root')!);
  const onBack = vi.fn();
  const onOpenModel = vi.fn();
  const screen = mountDocsScreen({ host: shell.docs, onBack, onOpenModel, pickFolder: pick });
  return { shell, screen, onBack, onOpenModel };
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.docs-tools button')];

describe('pantalla Docs', () => {
  it('show shows only the docs screen', async () => {
    const { shell, screen } = setup();
    await screen.show();
    expect(document.body.dataset.screen).toBe('docs');
    expect(shell.docs.hidden).toBe(false);
    expect(shell.home.hidden).toBe(true);
    expect(shell.workspace.hidden).toBe(true);
  });

  it('without a folder it shows the invitation to choose one and disables the commands', async () => {
    const { shell, screen } = setup();
    await screen.show();
    const empty = shell.docs.querySelector<HTMLElement>('.docs-empty')!;
    expect(empty.hidden).toBe(false);
    expect(buttons(shell.docs).length).toBe(3);
    expect(buttons(shell.docs).every((b) => b.disabled)).toBe(true);
  });

  it('choosing a folder hides the invitation, enables the commands and shows the path', async () => {
    const { shell, screen } = setup();
    await screen.show();
    shell.docs.querySelector<HTMLButtonElement>('.col-choose')!.click();
    await vi.waitFor(() => expect(localStorage.getItem('studio.docs.folder')).toBe(DIR));
    expect(shell.docs.querySelector<HTMLElement>('.docs-empty')!.hidden).toBe(true);
    expect(buttons(shell.docs).every((b) => !b.disabled)).toBe(true);
    expect(shell.docs.querySelector('.docs-folder')!.textContent).toBe(DIR);
  });

  it('cancelling the folder dialog changes nothing', async () => {
    const { shell, screen } = setup(async () => null);
    await screen.show();
    shell.docs.querySelector<HTMLButtonElement>('.col-choose')!.click();
    await Promise.resolve();
    expect(localStorage.getItem('studio.docs.folder')).toBeNull();
    expect(shell.docs.querySelector<HTMLElement>('.docs-empty')!.hidden).toBe(false);
  });

  it('al volver a abrir recuerda la carpeta', async () => {
    localStorage.setItem('studio.docs.folder', DIR);
    const { shell, screen } = setup();
    await screen.show();
    expect(shell.docs.querySelector<HTMLElement>('.docs-empty')!.hidden).toBe(true);
  });

  it('Back y Esc vuelven a Inicio', async () => {
    const { shell, screen, onBack } = setup();
    await screen.show();
    shell.docs.querySelector<HTMLButtonElement>('.col-back')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
    shell.docs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('Home: Documents button', () => {
  const actions = { onOpen: vi.fn(), onNew: vi.fn(), onOpenRecent: vi.fn(), onRemoveRecent: vi.fn() };

  it('aparece solo si hay onDocuments y lo llama', () => {
    const root = document.createElement('div');
    renderHome(root, [], actions);
    expect([...root.querySelectorAll('.home-action')].some((b) => b.textContent === 'Documents')).toBe(false);
    const onDocuments = vi.fn();
    renderHome(root, [], { ...actions, onDocuments });
    const b = [...root.querySelectorAll<HTMLButtonElement>('.home-action')].find((x) => x.textContent === 'Documents')!;
    b.click();
    expect(onDocuments).toHaveBeenCalledTimes(1);
  });
});

describe('pantalla Docs sobre una carpeta real (demo web en memoria)', () => {
  const PROJECT = '/C:/proyectos/Casa';

  async function open() {
    const { webFiles } = await import('../src/platform/web-files');
    const f = webFiles();
    f.memory.set(`${PROJECT}/Memoria.docx`, new Uint8Array([1]));
    f.memory.set(`${PROJECT}/Planos/A-0001.pdf`, new Uint8Array([2]));
    f.memory.set(`${PROJECT}/Planos/Estructura/E-01.dwg`, new Uint8Array([3]));
    setFiles(f);
    const { shell, screen } = setup(async () => 'C:/proyectos/Casa');
    await screen.show();
    shell.docs.querySelector<HTMLButtonElement>('.col-choose')!.click();
    await vi.waitFor(() => expect(shell.docs.querySelectorAll('.doc-row').length).toBe(2));
    return { shell, screen, f };
  }

  const names = (host: HTMLElement) => [...host.querySelectorAll('.doc-name')].map((n) => n.textContent);
  const dbl = (el: HTMLElement) => void el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

  it('choosing the folder shows its subfolders and its files, without having uploaded anything', async () => {
    const { shell } = await open();
    expect([...shell.docs.querySelectorAll('.doc-tree-name')].map((n) => n.textContent)).toEqual(['Casa', 'Planos']);
    expect(names(shell.docs)).toEqual(['Planos', 'Memoria.docx']);
    expect([...shell.docs.querySelectorAll('.doc-crumb')].map((n) => n.textContent)).toEqual(['Casa']);
    expect(shell.docs.querySelector('.doc-statusbar')!.textContent).toBe('2 items');
  });

  it('entrar en una subcarpeta con doble clic deja solo sus archivos y sube con Up', async () => {
    const { shell } = await open();
    dbl(shell.docs.querySelector<HTMLElement>('.doc-explorer [data-folder="Planos"]')!);
    expect(names(shell.docs)).toEqual(['Estructura', 'A-0001.pdf']);
    dbl(shell.docs.querySelector<HTMLElement>('.doc-explorer [data-folder="Planos/Estructura"]')!);
    expect(names(shell.docs)).toEqual(['E-01.dwg']);
    expect([...shell.docs.querySelectorAll('.doc-crumb')].map((n) => n.textContent)).toEqual(['Casa', 'Planos', 'Estructura']);
    shell.docs.querySelector<HTMLButtonElement>('.doc-up')!.click();
    expect(names(shell.docs)).toEqual(['Estructura', 'A-0001.pdf']);
  });

  it('doble clic en un .ifcx lo abre como modelo con su ruta absoluta', async () => {
    const { webFiles } = await import('../src/platform/web-files');
    const f = webFiles();
    f.memory.set(`${PROJECT}/Modelos/Casa.ifcx`, new Uint8Array([1]));
    setFiles(f);
    const { shell, screen, onOpenModel } = setup(async () => 'C:/proyectos/Casa');
    await screen.show();
    shell.docs.querySelector<HTMLButtonElement>('.col-choose')!.click();
    await vi.waitFor(() => expect(shell.docs.querySelectorAll('.doc-row').length).toBe(1));
    dbl(shell.docs.querySelector<HTMLElement>('.doc-explorer [data-folder="Modelos"]')!);
    dbl(shell.docs.querySelector<HTMLElement>('.doc-explorer [data-doc]')!);
    await vi.waitFor(() => expect(onOpenModel).toHaveBeenCalledWith('C:/proyectos/Casa/Modelos/Casa.ifcx'));
  });

  it('choosing a folder in the tree opens it in the center', async () => {
    const { shell } = await open();
    shell.docs.querySelector<HTMLElement>('.doc-tree [data-folder="Planos"]')!.click();
    expect(names(shell.docs)).toEqual(['Estructura', 'A-0001.pdf']);
    expect(shell.docs.querySelector('.doc-tree [data-folder="Planos"]')!.classList.contains('is-selected')).toBe(true);
  });
});
