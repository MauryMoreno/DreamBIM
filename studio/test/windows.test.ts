import { describe, expect, it, vi } from 'vitest';
import { modelWindowLabel, openModelWindow, startupPath, type WindowApi } from '../src/shell/windows';

function fakeApi(existing: string[] = []): WindowApi & { created: { label: string; url: string; title: string }[] } {
  const created: { label: string; url: string; title: string }[] = [];
  return {
    created,
    exists: vi.fn(async (label: string) => existing.includes(label)),
    focus: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    create: vi.fn(async (label: string, url: string, title: string) => {
      created.push({ label, url, title });
    }),
  };
}

describe('ventanas de modelo', () => {
  it('the label is the same for a path written with other slashes or case', () => {
    const a = modelWindowLabel('C:\\Proyectos\\Torre.ifcx');
    expect(a).toMatch(/^model-[a-z0-9]+$/);
    expect(modelWindowLabel('c:/proyectos/torre.IFCX')).toBe(a);
    expect(modelWindowLabel('C:\\Proyectos\\Otra.ifcx')).not.toBe(a);
  });

  it('it opens a new window with the path of the model in the URL', async () => {
    const api = fakeApi();
    await openModelWindow('C:\\Proyectos\\Torre #2.ifcx', api);
    expect(api.created).toHaveLength(1);
    const { label, url, title } = api.created[0];
    expect(label).toBe(modelWindowLabel('C:\\Proyectos\\Torre #2.ifcx'));
    expect(startupPath(url.slice(url.indexOf('?')))).toBe('C:\\Proyectos\\Torre #2.ifcx');
    expect(title).toBe('Dream BIM — Torre #2');
    expect(api.focus).not.toHaveBeenCalled();
  });

  it('si el modelo ya tiene ventana, la trae al frente y no crea otra', async () => {
    const path = 'C:\\Proyectos\\Torre.ifcx';
    const api = fakeApi([modelWindowLabel(path)]);
    await openModelWindow(path, api);
    expect(api.created).toHaveLength(0);
    expect(api.focus).toHaveBeenCalledWith(modelWindowLabel(path));
    // in case that window moved to another model with File › Open
    expect(api.send).toHaveBeenCalledWith(modelWindowLabel(path), path);
  });

  it('startupPath reads ?open= and gives null without it', () => {
    expect(startupPath('?open=' + encodeURIComponent('D:\\a b\\c.ifcx'))).toBe('D:\\a b\\c.ifcx');
    expect(startupPath('')).toBeNull();
    expect(startupPath('?open=')).toBeNull();
    expect(startupPath('?x=1')).toBeNull();
  });
});
