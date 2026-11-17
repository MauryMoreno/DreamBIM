// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildSample } from '../scripts/web/sample';

const ifcx = (imports: string[] = [], data: unknown[] = []) =>
  JSON.stringify({ header: { id: 'x' }, imports: imports.map((uri) => ({ uri })), schemas: {}, data });

let src: string;
let out: string;
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(src, rel)), { recursive: true });
  writeFileSync(join(src, rel), text);
};
const cfg = (models: string[], maxModelMB = 10) => ({ source: '.', maxModelMB, models });

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'sample-'));
  src = join(root, 'src');
  out = join(root, 'out');
  mkdirSync(src);
});

describe('buildSample', () => {
  it('it copies the model and everything it imports, even if it is outside the list; it excludes .test* and .antes-de-*', () => {
    put('A/m.ifcx', ifcx(['../B/z.ifcx', 'https://ifcx.dev/x.ifcx']));
    put('B/z.ifcx', ifcx());
    put('A/m.test1.ifcx', ifcx());
    put('A/m.ifcx.antes-de-x', 'viejo');
    const r = buildSample(cfg(['A/m.ifcx']), src, out);
    expect(r.files).toEqual(['A/m.ifcx', 'B/z.ifcx']);
    expect(r.missing).toEqual([]);
    expect(existsSync(join(out, 'B/z.ifcx'))).toBe(true);
    expect(existsSync(join(out, 'A/m.test1.ifcx'))).toBe(false);
  });

  it('index.json lista carpetas y archivos con rutas /Snowdon Towers Example/... y la fecha del origen', () => {
    put('A/m.ifcx', ifcx(['../B/z.ifcx']));
    put('B/z.ifcx', ifcx());
    buildSample(cfg(['A/m.ifcx']), src, out);
    const idx = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(idx.entries.map((e: { path: string; isDir: boolean }) => [e.path, e.isDir])).toEqual([
      ['/Snowdon Towers Example/A', true],
      ['/Snowdon Towers Example/A/m.ifcx', false],
      ['/Snowdon Towers Example/B', true],
      ['/Snowdon Towers Example/B/z.ifcx', false],
    ]);
    expect(idx.entries[1].mtime).toBeGreaterThan(0);
  });

  it('index.json marks as featured only the models of the list that exist, not their imports', () => {
    put('A/m.ifcx', ifcx(['../B/z.ifcx']));
    put('B/z.ifcx', ifcx());
    buildSample(cfg(['A/m.ifcx', 'A/nada.ifcx']), src, out);
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).featured).toEqual(['/Snowdon Towers Example/A/m.ifcx']);
  });

  it('index.json carries the closure of each model of the list (imports, indirect ones and siblings) to preload it', () => {
    put('A/m.ifcx', ifcx(['../B/z.ifcx']));
    put('B/z.ifcx', ifcx(['../C/y.ifcx']));
    put('C/y.ifcx', ifcx());
    put('A/m.costos.ifcx', ifcx());
    put('A/m.test1.ifcx', ifcx());
    buildSample(cfg(['A/m.ifcx']), src, out);
    const idx = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(idx.closure).toEqual({ '/Snowdon Towers Example/A/m.ifcx': ['/Snowdon Towers Example/A/m.costos.ifcx', '/Snowdon Towers Example/B/z.ifcx', '/Snowdon Towers Example/C/y.ifcx'] });
  });

  it('an import that does not exist appears in missing', () => {
    put('A/m.ifcx', ifcx(['../B/falta.ifcx']));
    expect(buildSample(cfg(['A/m.ifcx']), src, out).missing).toEqual(['B/falta.ifcx']);
  });

  it('un modelo de la lista que no existe aparece en missing', () => {
    expect(buildSample(cfg(['A/nada.ifcx']), src, out).missing).toEqual(['A/nada.ifcx']);
  });

  it('sigue las capas de un documento de Studio y sus archivos hermanos de cronograma/costos', () => {
    const composer = { layers: [{ uri: '../B/capa.ifcx' }], placements: [] };
    put('A/m.ifcx', ifcx([], [{ path: 'p', attributes: { 'ifcx-studio::composer': composer } }]));
    put('B/capa.ifcx', ifcx());
    put('A/m.costos-asignacion.ifcx', ifcx());
    const r = buildSample(cfg(['A/m.ifcx']), src, out);
    expect(r.files).toEqual(['A/m.costos-asignacion.ifcx', 'A/m.ifcx', 'B/capa.ifcx']);
  });

  it('a .test2 model of the list carries its own siblings (schedule, costs), not those of another version or the copies', () => {
    put('A/m.test2.ifcx', ifcx());
    put('A/m.test2.cronograma.ifcx', ifcx());
    put('A/m.test2.antes-de-x.ifcx', ifcx());
    put('A/m.cronograma.ifcx', ifcx());
    put('A/m.test2.ifcx.antes-de-y', 'copia');
    const r = buildSample(cfg(['A/m.test2.ifcx']), src, out);
    expect(r.files).toEqual(['A/m.test2.cronograma.ifcx', 'A/m.test2.ifcx']);
  });

  it('index.json lists all the folders of the source, also the empty ones, except hidden ones and skipFolders', () => {
    put('A/m.ifcx', ifcx());
    mkdirSync(join(src, '03_PUBLISHED'));
    mkdirSync(join(src, 'B/vacia'), { recursive: true });
    mkdirSync(join(src, '.builtbot/memory'), { recursive: true });
    mkdirSync(join(src, 'A/__pycache__'), { recursive: true });
    put('B/notas.md', 'no se publica');
    buildSample({ ...cfg(['A/m.ifcx']), skipFolders: ['__pycache__'] }, src, out);
    const idx = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(idx.entries.map((e: { path: string }) => e.path)).toEqual([
      '/Snowdon Towers Example/03_PUBLISHED',
      '/Snowdon Towers Example/A',
      '/Snowdon Towers Example/A/m.ifcx',
      '/Snowdon Towers Example/B',
      '/Snowdon Towers Example/B/vacia',
    ]);
  });

  it('fullFolders copies all its content (also .test*) except .antes-de-* copies, .py scripts and caches', () => {
    put('A/m.ifcx', ifcx());
    put('lib/x/x.tipo.test2.ifcx', ifcx(['../../C/dep.ifcx']));
    put('lib/x/x.ifcx.antes-de-y', 'copia');
    put('lib/textures/t.jpg', 'jpg');
    put('lib/README.md', '# lib');
    put('lib/gen.py', 'print()');
    put('lib/__pycache__/gen.pyc', 'x');
    put('C/dep.ifcx', ifcx());
    const r = buildSample({ ...cfg(['A/m.ifcx']), skipFolders: ['__pycache__'], fullFolders: ['lib'] }, src, out);
    expect(r.files).toEqual(['A/m.ifcx', 'C/dep.ifcx', 'lib/README.md', 'lib/textures/t.jpg', 'lib/x/x.tipo.test2.ifcx']);
    expect(r.missing).toEqual([]);
    const idx = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
    expect(idx.featured).toEqual(['/Snowdon Towers Example/A/m.ifcx']);
  });

  it('a model of the list bigger than maxModelMB goes to tooBig (warning, it is copied anyway)', () => {
    put('A/grande.ifcx', ifcx([], [{ path: 'x'.repeat(2 * 1024 * 1024) }]));
    const r = buildSample(cfg(['A/grande.ifcx'], 1), src, out);
    expect(r.tooBig).toEqual(['A/grande.ifcx']);
    expect(r.files).toEqual(['A/grande.ifcx']);
  });
});
