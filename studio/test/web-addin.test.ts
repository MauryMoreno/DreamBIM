// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pickAddin, type ZipFile } from '../scripts/web/addin';

const z = (name: string, mtimeMs = 1, size = 78_643_200): ZipFile => ({ name, mtimeMs, size });

describe('pickAddin', () => {
  it('it takes the zip and its sources zip; size in MB rounded', () => {
    expect(pickAddin([z('IFCx-Revit-2026-2026.11.16-35408eb.zip'), z('IFCx-Revit-2026-2026.11.16-35408eb-src.zip', 1, 5)])).toEqual({
      file: 'IFCx-Revit-2026-2026.11.16-35408eb.zip',
      version: '2026.11.16-35408eb',
      sizeMB: 75,
      source: 'IFCx-Revit-2026-2026.11.16-35408eb-src.zip',
    });
  });

  it('with several versions, the most recent by modification date', () => {
    const r = pickAddin([z('IFCx-Revit-2026-a.zip', 1), z('IFCx-Revit-2026-a-src.zip'), z('IFCx-Revit-2026-b.zip', 2), z('IFCx-Revit-2026-b-src.zip')]);
    expect(r?.version).toBe('b');
  });

  it('un zip sin sus fuentes no se publica (LGPL)', () => {
    expect(pickAddin([z('IFCx-Revit-2026-a.zip')])).toBeNull();
  });

  it('if the most recent has no sources, it takes the previous one that does', () => {
    expect(pickAddin([z('IFCx-Revit-2026-a.zip', 1), z('IFCx-Revit-2026-a-src.zip'), z('IFCx-Revit-2026-b.zip', 2)])?.version).toBe('a');
  });

  it('it ignores other files and the empty folder', () => {
    expect(pickAddin([z('otra-cosa.zip'), z('stage')])).toBeNull();
    expect(pickAddin([])).toBeNull();
  });
});
