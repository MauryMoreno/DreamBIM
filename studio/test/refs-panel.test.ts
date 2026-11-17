import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../src/ifcx/compose';
import type { ComposedNode, IfcxFile, IfcxNode, ProvenanceSource } from '../src/ifcx/types';
import { mountReferencesPanel } from '../src/composer/refspanel';

const file = (data: IfcxNode[], id = 'f'): IfcxFile => ({
  header: { id, ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: '', timestamp: '' },
  imports: [],
  schemas: {},
  data,
});
const imp = (location: string): ProvenanceSource => ({ role: 'import', name: location, uri: location, location });
const doc = (location?: string): ProvenanceSource => ({ role: 'layer', name: 'model', uri: null, layerId: 'doc', ...(location && { location }) });

const DOC = 'C:/p/model.ifcx';
const FICHA = 'C:/p/lib/ficha.ifcx';
const MAT = 'C:/p/lib/mat.ifcx';
const URL = 'https://ifcx.dev/x/ifc@v5a.ifcx';

const result = () =>
  compose(
    [
      file([{ path: 'std', attributes: { s: 1 } }], 'std'),
      file([{ path: 'mat', attributes: { g: 1 } }], 'mat'),
      file([{ path: 'ficha', inherits: { material: 'mat' } }], 'ficha'),
      file([{ path: 'pile', inherits: { ficha: 'ficha' } }, { path: 'beam', attributes: { d: 1 } }], 'model'),
    ],
    { sources: [imp(URL), imp(MAT), imp(FICHA), doc(DOC)] },
  );
const node = (r: ReturnType<typeof result>, name: string): ComposedNode => r.root.children.find((c) => c.name === name)!;

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});
const rows = () => [...host.querySelectorAll<HTMLElement>('.refs-row')];
const rowOf = (name: string) => rows().find((r) => r.querySelector('.refs-name')!.textContent!.startsWith(name))!;
const btn = (row: HTMLElement, label: string) => row.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe('ReferencesPanel', () => {
  it('it paints one row per file with its role, name, folder and uses', () => {
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: result(), path: DOC });
    expect(rows().map((r) => r.querySelector('.refs-role')!.textContent)).toEqual(['Document', 'Import', 'Import', 'Import']);
    const ficha = rowOf('ficha.ifcx');
    expect(ficha.querySelector('.refs-dir')!.textContent).toBe('lib');
    expect(ficha.querySelector('.refs-count')!.textContent).toBe('1');
    expect(ficha.title).toBe(FICHA);
    expect(rowOf('model.ifcx').querySelector('.refs-count')).toBeNull();
  });

  it('the filter reduces the rows by path, case-insensitive, and warns if there are none', () => {
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: result(), path: DOC });
    const input = host.querySelector<HTMLInputElement>('.refs-filter')!;
    input.value = 'MAT';
    input.dispatchEvent(new Event('input'));
    expect(rows().map((r) => r.querySelector('.refs-name')!.textContent)).toEqual(['mat.ifcx']);
    input.value = 'zzz';
    input.dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(0);
    expect(host.querySelector('.refs-empty')!.textContent).toBe('No files match');
  });

  it('the selected element highlights the files it references', () => {
    const r = result();
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: r, path: DOC });
    p.select(node(r, 'pile'));
    const active = rows().filter((x) => x.classList.contains('refs-active')).map((x) => x.querySelector('.refs-name')!.textContent!.split(' ')[0]);
    expect(active.sort()).toEqual(['ficha.ifcx', 'mat.ifcx']);
    p.select(node(r, 'beam'));
    expect(host.querySelectorAll('.refs-active')).toHaveLength(0);
    p.select(null);
    expect(host.querySelectorAll('.refs-active')).toHaveLength(0);
  });

  it('Copy path and Open call with the exact location; the document and the urls are not opened', () => {
    const open = vi.fn();
    const copy = vi.fn();
    const p = mountReferencesPanel(host, { open, copy });
    p.setModel({ result: result(), path: DOC });
    btn(rowOf('ficha.ifcx'), 'Open')!.click();
    expect(open).toHaveBeenCalledWith(FICHA);
    btn(rowOf('ficha.ifcx'), 'Copy path')!.click();
    expect(copy).toHaveBeenCalledWith(FICHA);
    expect(btn(rowOf('model.ifcx'), 'Open')).toBeNull();
    expect(btn(rowOf('model.ifcx'), 'Copy path')).not.toBeNull();
    expect(btn(rowOf('ifc@v5a.ifcx'), 'Open')).toBeNull();
    expect(btn(rowOf('ifc@v5a.ifcx'), 'Copy path')).not.toBeNull();
  });

  it('un documento sin guardar no tiene acciones', () => {
    const r = compose([file([{ path: 'a' }])], { sources: [doc()] });
    const p = mountReferencesPanel(host, { open: vi.fn(), copy: vi.fn() });
    p.setModel({ result: r, path: null });
    expect(host.querySelectorAll('.refs-action')).toHaveLength(0);
  });

  it('solo el documento: avisa de que no enlaza otros archivos', () => {
    const r = compose([file([{ path: 'a' }])], { sources: [doc(DOC)] });
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: r, path: DOC });
    expect(rows()).toHaveLength(1);
    expect(host.querySelector('.refs-empty')!.textContent).toBe('This document links to no other files');
  });

  it('sin modelo no hay filas', () => {
    const p = mountReferencesPanel(host, {});
    p.setModel(null);
    expect(rows()).toHaveLength(0);
    expect(host.querySelector('.refs-empty')!.textContent).toBe('No document open');
  });

  it('with the tab hidden it does not paint until it is shown', () => {
    host.hidden = true;
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: result(), path: DOC });
    expect(rows()).toHaveLength(0);
    host.hidden = false;
    p.shown();
    expect(rows()).toHaveLength(4);
  });

  it('the file names enter as text, never as HTML', () => {
    const evil = 'C:/p/<img src=x onerror=alert(1)>.ifcx';
    const r = compose([file([{ path: 'e' }]), file([{ path: 'a' }])], { sources: [imp(evil), doc(DOC)] });
    const p = mountReferencesPanel(host, {});
    p.setModel({ result: r, path: DOC });
    expect(host.querySelector('img')).toBeNull();
    expect(rows().some((x) => x.textContent!.includes('<img'))).toBe(true);
  });
});
