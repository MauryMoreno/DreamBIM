// Un visor que valida (el de buildingSMART) rechaza el archivo entero si un atributo no tiene
// schema, neither in the file itself nor in its imports. Studio must not write any like that.
import { describe, expect, it } from 'vitest';
import type { IfcxFile } from '../src/ifcx/types';
import { BUNDLED_SCHEMAS } from '../src/model/schemas';
import { newSession } from '../src/modeling/session';
import { BASE_URI, foreignFromFile } from '../src/modeling/foreign';
import { translation } from '../src/composer/xform';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';

/** Attributes of the file without their own schema or one in their standard imports. */
function unschemed(file: IfcxFile): string[] {
  const known = new Set(Object.keys(file.schemas ?? {}));
  for (const i of file.imports ?? []) {
    const text = BUNDLED_SCHEMAS[i.uri];
    if (text) for (const k of Object.keys(JSON.parse(text).schemas ?? {})) known.add(k);
  }
  const keys = new Set(file.data.flatMap((n) => Object.keys(n.attributes ?? {})));
  return [...keys].filter((k) => !known.has(k));
}

describe('every attribute Studio writes has a schema', () => {
  it('a Studio document with a wall, a floor and a placement', async () => {
    const s = newSession();
    const l = s.doc.levels[0];
    s.addWall([0, 0], [4, 0], l.id);
    s.addFloor([[0, 0], [4, 0], [4, 3], [0, 3]], l.id);
    s.doc.composer.layers.push({ uri: './a.ifcx', name: 'a.ifcx', color: '#e6550d', enabled: true, editsEnabled: true, edits: [] });
    s.place('./a.ifcx', l.id, ['R']);
    expect(unschemed(JSON.parse(await s.serialize()))).toEqual([]);
  });

  it('a Studio document with a stair, its flights and its railings', async () => {
    const s = newSession();
    applyBuild(s.doc, parseBuildRequest({
      levels: [
        { name: 'Level 1', elevation: 0, layout: 'a' },
        { name: 'Level 2', elevation: 3, layout: 'a' },
      ],
      layouts: {
        a: {
          walls: [
            { from: [0, 0], to: [10, 0], thickness: 0.3 },
            { from: [10, 0], to: [10, 8], thickness: 0.3 },
            { from: [10, 8], to: [0, 8], thickness: 0.3 },
            { from: [0, 8], to: [0, 0], thickness: 0.3 },
          ],
          floors: [[[0, 0], [10, 0], [10, 8], [0, 8]]],
        },
      },
    }));
    s.doc.stairs.push({
      id: 's', baseLevelId: s.doc.levels[0].id, topLevelId: s.doc.levels[1].id,
      shape: 'u', origin: [3, 3], angle: 0, width: 1.1, turn: 'left',
    });
    expect(unschemed(JSON.parse(await s.serialize()))).toEqual([]);
  });

  it('an IFCx that is not from Studio, saved with a move and a placement, even without standard imports', async () => {
    const f: IfcxFile = {
      header: { id: 'p', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' },
      imports: [],
      schemas: { 'x::kind': { value: { dataType: 'String' } } },
      data: [{ path: 'P', children: { w: 'W' }, attributes: { 'x::kind': 'project' } }, { path: 'W' }],
    };
    const s = foreignFromFile(f, 'C:/p/a.ifcx');
    s.baseEdits = [{ path: 'W', attributes: { 'usd::xformop': { transform: translation([1, 0, 0]) } } }];
    s.doc.composer.layers.push({ uri: './d.ifcx', name: 'd.ifcx', color: '', enabled: true, editsEnabled: true, edits: [] });
    s.doc.composer.placements.push({ id: 'C', layerUri: './d.ifcx', parentId: 'W', parentLayerUri: BASE_URI, roots: ['D'], offset: [0, 0, 0] });
    expect(unschemed(JSON.parse(await s.serialize()))).toEqual([]);
  });
});
