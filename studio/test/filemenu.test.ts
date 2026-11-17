import { describe, expect, it, vi } from 'vitest';
import { mountFileMenu, type FileMenuActions } from '../src/ribbon/filemenu';

function setup(extra: Partial<FileMenuActions> = {}) {
  document.body.innerHTML = '<button id="file">File</button>';
  const anchor = document.getElementById('file') as HTMLButtonElement;
  const acts = {
    onOpen: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onExit: vi.fn(),
    recents: vi.fn(() => []),
    onOpenRecent: vi.fn(),
    ...extra,
  };
  mountFileMenu(anchor, acts);
  const menu = () => document.querySelector<HTMLElement>('.file-menu')!;
  return { anchor, acts, menu };
}
const items = () => [...document.querySelectorAll<HTMLButtonElement>('.file-menu-commands > .file-menu-item')];
const item = (label: string) => items().find((b) => b.textContent === label)!;

describe('File menu: Save and Save As…', () => {
  it('aparecen tras Open…, en este orden', () => {
    setup();
    expect(items().map((b) => b.textContent)).toEqual(['Open…', 'Save', 'Save As…', 'Import IFC…', 'Close', 'Exit']);
  });

  it('they are active and call their action closing the menu', () => {
    const { anchor, acts, menu } = setup();
    anchor.click();
    expect(item('Save').disabled).toBe(false);
    expect(item('Save As…').disabled).toBe(false);
    item('Save').click();
    expect(acts.onSave).toHaveBeenCalledTimes(1);
    expect(menu().hidden).toBe(true);
    anchor.click();
    item('Save As…').click();
    expect(acts.onSaveAs).toHaveBeenCalledTimes(1);
    expect(acts.onSave).toHaveBeenCalledTimes(1);
  });

  it('with canSave() false they are disabled when the menu opens, with the read-only tooltip', () => {
    let can = false;
    const { anchor, acts } = setup({ canSave: () => can });
    anchor.click();
    expect(item('Save').disabled).toBe(true);
    expect(item('Save As…').disabled).toBe(true);
    expect(item('Save').title).toBe('Only models created in Dream BIM can be edited');
    item('Save').click();
    expect(acts.onSave).not.toHaveBeenCalled();
    anchor.click(); // cierra
    can = true;
    anchor.click();
    expect(item('Save').disabled).toBe(false);
    expect(item('Save').title).toBe('');
  });
});
