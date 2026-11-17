import { describe, expect, it, vi } from 'vitest';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import type { Layer } from '../src/ifcx/layers';
import {
  BASE_URI,
  LAYER_COLORS,
  composeStack,
  editsFile,
  layerTree,
  nextColor,
  notFoundWarning,
  unreportedWarnings,
  type ComposerLayer,
  type LinkedFiles,
} from '../src/composer/stack';
import { isSchemaWarning } from '../src/model/validate';

const file = (id: string, data: IfcxNode[], imports: { uri: string }[] = []): IfcxFile => ({
  header: { id, ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
  imports,
  schemas: {},
  data,
});
const baseLayer = (data: IfcxNode[], imports: { uri: string }[] = []): Layer => ({
  id: 'doc',
  name: 'doc',
  file: file('doc', data, imports),
  enabled: true,
});
const layer = (uri: string, over: Partial<ComposerLayer> = {}): ComposerLayer => ({
  id: uri,
  uri,
  name: uri,
  color: LAYER_COLORS[0],
  enabled: true,
  editsEnabled: true,
  edits: [],
  ...over,
});
const w = (v: number): IfcxNode => ({ path: 'w', attributes: { n: v } });
const nOf = (m: { result: { byOrigin: Map<string, { attributes: Record<string, unknown> }[]> } }) =>
  m.result.byOrigin.get('w')?.[0].attributes.n;

describe('composeStack', () => {
  it('the edits win over their file', async () => {
    const l = layer('./a.ifcx', { edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const m = await composeStack('x', null, baseLayer([]), [l], files);
    expect(nOf(m)).toBe(2);
  });

  it('the document wins over everything', async () => {
    const l = layer('./a.ifcx', { edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const m = await composeStack('x', null, baseLayer([w(3)]), [l], files);
    expect(nOf(m)).toBe(3);
  });

  it('linked imports in the base are not composed twice', async () => {
    const l = layer('./a.ifcx', { edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const fetcher = vi.fn(async (_uri: string) => file('a', [w(1)]));
    const m = await composeStack('x', null, baseLayer([], [{ uri: './a.ifcx' }]), [l], files, fetcher);
    expect(nOf(m)).toBe(2);
    expect(fetcher).not.toHaveBeenCalledWith('./a.ifcx');
  });

  it('relative imports resolve against the file that declares them, also nested', async () => {
    const disk: Record<string, IfcxFile> = {
      'C:/p/c/EST/s.ifcx': file('s', [{ path: 'lvl', children: { col: 'c1' } }], [{ uri: '../../c/FED/base.ifcx' }]),
      'C:/p/c/FED/base.ifcx': file('base', [{ path: 'lvl', attributes: { z: 3 } }]),
    };
    const fetcher = vi.fn(async (uri: string) => {
      if (!disk[uri]) throw new Error('missing ' + uri);
      return disk[uri];
    });
    const doc = baseLayer([], [{ uri: '../EST/s.ifcx' }, { uri: './base.ifcx' }]);
    const m = await composeStack('fed', 'C:/p/c/FED/fed.ifcx', doc, [], new Map(), fetcher);
    expect(m.warnings.filter((w) => !isSchemaWarning(w))).toEqual([]);
    expect(m.result.byOrigin.get('lvl')?.[0].attributes.z).toBe(3);
    expect(fetcher).toHaveBeenCalledTimes(2); // the base is read once
  });

  it('the imports of a linked file resolve against that file', async () => {
    const fetcher = vi.fn(async (_uri: string) => file('base', [w(1)]));
    const l = layer('../EST/s.ifcx');
    const files: LinkedFiles = new Map([['../EST/s.ifcx', file('s', [], [{ uri: './base.ifcx' }])]]);
    await composeStack('fed', 'C:/p/FED/fed.ifcx', baseLayer([]), [l], files, fetcher);
    expect(fetcher).toHaveBeenCalledWith('C:/p/EST/base.ifcx');
  });

  it('the base of a foreign file resolves its imports against the document', async () => {
    const fetcher = vi.fn(async (_uri: string) => file('base', [w(1)]));
    const l = layer(BASE_URI);
    const files: LinkedFiles = new Map([[BASE_URI, file('own', [], [{ uri: '../FED/base.ifcx' }])]]);
    await composeStack('s', 'C:/p/EST/s.ifcx', baseLayer([]), [l], files, fetcher);
    expect(fetcher).toHaveBeenCalledWith('C:/p/FED/base.ifcx');
  });

  it('a disabled layer takes its edits with it', async () => {
    const l = layer('./a.ifcx', { enabled: false, edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const m = await composeStack('x', null, baseLayer([]), [l], files);
    expect(m.result.byOrigin.get('w')).toBeUndefined();
  });

  it('editsEnabled false keeps the file without edits', async () => {
    const l = layer('./a.ifcx', { editsEnabled: false, edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const m = await composeStack('x', null, baseLayer([]), [l], files);
    expect(nOf(m)).toBe(1);
  });

  it('missing file: warning, no failure', async () => {
    const files: LinkedFiles = new Map([['./x.ifcx', null]]);
    const m = await composeStack('x', null, baseLayer([w(3)]), [layer('./x.ifcx')], files);
    expect(m.warnings).toContain('File not found: ./x.ifcx');
    expect(notFoundWarning('./x.ifcx')).toBe('File not found: ./x.ifcx');
    expect(nOf(m)).toBe(3);
  });

  it('the load warnings toast leaves out missing files (each one already has its own toast)', () => {
    expect(unreportedWarnings([notFoundWarning('./x.ifcx'), 'Unknown node: q', notFoundWarning('../y.ifcx')])).toEqual(['Unknown node: q']);
    expect(unreportedWarnings([])).toEqual([]);
  });

  it('shared UUIDs: the edits of a layer stay in its own editsFile', async () => {
    const l1 = layer('./a.ifcx', { edits: [{ path: 'p', children: { c1: 'l1only' } }] });
    const l2 = layer('./b.ifcx', { edits: [{ path: 'p', children: { c2: 'l2only' } }] });
    const files: LinkedFiles = new Map([
      ['./a.ifcx', file('a', [{ path: 'p', children: { x: 'xa' } }])],
      ['./b.ifcx', file('b', [{ path: 'p', children: { y: 'yb' } }])],
    ]);
    await composeStack('x', null, baseLayer([]), [l1, l2], files);
    const data = JSON.stringify(editsFile(l1).data);
    expect(data).toContain('l1only');
    expect(data).not.toContain('l2only');
    expect(editsFile(l1).header.id).toBe('ifcx-studio/edits/./a.ifcx');
  });
});

describe('nextColor / layerTree', () => {
  it('nextColor returns the first unused color', () => {
    expect(nextColor([])).toBe(LAYER_COLORS[0]);
    const used = [layer('a', { color: LAYER_COLORS[0] }), layer('b', { color: LAYER_COLORS[2] })];
    expect(nextColor(used)).toBe(LAYER_COLORS[1]);
  });

  it('layerTree composes a single file', () => {
    const t = layerTree(file('a', [w(1)]));
    expect(t.byOrigin.get('w')?.[0].attributes.n).toBe(1);
  });
});

describe('composeStack sources', () => {
  it('pasa a compose la procedencia de cada archivo de la pila', async () => {
    const l = layer('./a.ifcx', { edits: [w(2)] });
    const files: LinkedFiles = new Map([['./a.ifcx', file('a', [w(1)])]]);
    const fetcher = vi.fn(async (_uri: string) => file('lib', [{ path: 'q', attributes: { n: 1 } }]));
    const doc = baseLayer([], [{ uri: './lib.ifcx' }]);
    const m = await composeStack('doc', 'C:/p/doc.ifcx', doc, [l], files, fetcher, undefined, [file('mats', [])]);
    expect(m.result.provenance.sources).toEqual([
      { role: 'layer', name: './a.ifcx', uri: null, location: 'C:/p/a.ifcx', layerId: './a.ifcx' },
      { role: 'layer', name: './a.ifcx (edits)', uri: null, layerId: './a.ifcx:edits' },
      { role: 'import', name: './lib.ifcx', uri: './lib.ifcx', location: 'C:/p/lib.ifcx' },
      { role: 'layer', name: 'doc', uri: null, location: 'C:/p/doc.ifcx', layerId: 'doc' },
      { role: 'layer', name: 'mats', uri: null, layerId: 'overlay:mats' },
    ]);
  });
});
