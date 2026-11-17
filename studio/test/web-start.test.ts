import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform/env', () => ({ isWeb: () => true }));
const store = vi.hoisted(() => ({ load: vi.fn(async () => ({})) }));
vi.mock('@tauri-apps/plugin-store', () => store);

import { mountDocsScreen } from '../src/app/docs-screen';
import { saveLibraryFolder, savedLibraryFolder } from '../src/library/disk';
import { setFiles, type Files } from '../src/platform/files';
import { mountShell } from '../src/shell/screens';
import { openRecentsSafe } from '../src/home/safe-recents';
import { mountDemoBanner } from '../src/shell/demo-banner';
import { mountTitlebar } from '../src/shell/titlebar';
import { openModelWindow } from '../src/shell/windows';

const qat = { onOpen: vi.fn(), onHome: vi.fn(), on3D: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onHelp: vi.fn() };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('modo web', () => {
  it('the demo warning says that changes are not saved', () => {
    const el = mountDemoBanner(document.body);
    expect(el.textContent).toBe('Demo: your changes are not saved');
    expect(el.getAttribute('role')).toBe('status');
    expect(document.body.contains(el)).toBe(true);
  });

  it('the title bar has no window buttons', () => {
    document.body.innerHTML = '<div id="titlebar"></div>';
    const el = document.getElementById('titlebar') as HTMLElement;
    mountTitlebar(el, qat);
    for (const t of ['Minimize', 'Maximize', 'Close']) expect(el.querySelector(`button[title="${t}"]`)).toBeNull();
    expect(el.querySelector('button[title="Undo"]')).not.toBeNull();
  });

  it('opening a reference of the example project uses a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openModelWindow('/Snowdon Towers Example/01_WIP/EST/a.ifcx');
    expect(open).toHaveBeenCalledWith('?open=%2FSnowdon%20Towers%20Example%2F01_WIP%2FEST%2Fa.ifcx', '_blank');
  });

  it('a visitor file cannot be opened in another tab (its memory belongs to this one)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(openModelWindow('/local/mio.ifcx')).rejects.toThrow('only be opened in this tab');
    expect(open).not.toHaveBeenCalled();
  });

  it('the library starts in the example project, remembers the choice in memory and does not touch localStorage', () => {
    expect(savedLibraryFolder()).toBe('/Snowdon Towers Example');
    saveLibraryFolder('/Snowdon Towers Example/biblioteca');
    expect(savedLibraryFolder()).toBe('/Snowdon Towers Example/biblioteca');
    expect(localStorage.getItem('ifcx-studio.library')).toBeNull();
  });

  it('Documentos arranca en el proyecto de ejemplo aunque localStorage guarde otra carpeta, y no la recuerda', async () => {
    localStorage.setItem('studio.docs.folder', '/proyecto');
    setFiles({ defaultLibraryFolder: () => '/Snowdon Towers Example', listAll: async () => [] } as unknown as Files);
    document.body.innerHTML = '<div id="root"></div>';
    const shell = mountShell(document.getElementById('root')!);
    const screen = mountDocsScreen({ host: shell.docs, onBack: vi.fn(), onOpenModel: vi.fn(), pickFolder: async () => '/Snowdon Towers Example/01_WIP' });
    await screen.show();
    expect(shell.docs.querySelector('.docs-folder')?.textContent).toBe('/Snowdon Towers Example');
    shell.docs.querySelector<HTMLButtonElement>('button[title="Choose the project folder"]')!.click();
    await vi.waitFor(() => expect(shell.docs.querySelector('.docs-folder')?.textContent).toBe('/Snowdon Towers Example/01_WIP'));
    expect(localStorage.getItem('studio.docs.folder')).toBe('/proyecto');
  });

  it('the recents live only in memory: the on-disk store is not opened', async () => {
    const r = await openRecentsSafe();
    await r.add({ path: '/Snowdon Towers Example/a.ifcx', name: 'a', openedAt: 1, thumbnail: null });
    expect(r.list()).toHaveLength(1);
    expect(store.load).not.toHaveBeenCalled();
  });
});
