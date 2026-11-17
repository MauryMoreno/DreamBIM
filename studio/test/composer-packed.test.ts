// an edit on top (transformation) does not touch the packed mesh
// debe componer y dibujar igual que la misma capa sin empaquetar.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { packMeshes } from '../src/ifcx/packed';
import { buildObject } from '../src/render/geometry';
import type { IfcxFile, IfcxNode } from '../src/ifcx/types';
import type { Layer } from '../src/ifcx/layers';
import { composeStack, LAYER_COLORS, type ComposerLayer } from '../src/composer/stack';
import { flattenAttributes } from '../src/ifcx/compose';
import { meshFaceCount, meshVertexCount } from '../src/ifcx/packed';

const MESH = 'usd::usdgeom::mesh';
const mk = (data: IfcxNode[]): IfcxFile =>
  ({ header: { id: 'f', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data }) as IfcxFile;
const mesh = () => ({
  points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  faceVertexIndices: [0, 1, 2, 3],
  faceVertexCounts: [4],
});
const linked = () =>
  mk([
    { path: 'root', children: { wall: 'wall' } },
    { path: 'wall', attributes: { [MESH]: mesh(), 'bsi::ifc::class': { code: 'IfcWall' } } },
  ]);
const doc: Layer = { id: 'doc', name: 'doc', file: mk([{ path: 'wall', attributes: { 'x::note': 'hola' } }]), enabled: true };
const layer: ComposerLayer = { id: 'a', uri: './a.ifcx', name: 'a', color: LAYER_COLORS[0], enabled: true, editsEnabled: true, edits: [] };

async function wallAttrs(file: IfcxFile) {
  const m = await composeStack('doc', 'C:/p/doc.ifcx', doc, [layer], new Map([['./a.ifcx', file]]));
  const wall = m.result.byPath.get('/root/wall')!;
  return { wall, m };
}

describe('capa enlazada con mallas empaquetadas', () => {
  it('Test node hanging from `parent` (the path follows that of the composed tree).', async () => {
    const plain = linked();
    const packed = linked();
    packMeshes(packed);
    const a = await wallAttrs(plain);
    const b = await wallAttrs(packed);
    expect((b.wall.attributes[MESH] as any).points).toBeInstanceOf(Float32Array);
    expect(b.wall.attributes['x::note']).toBe('hola'); // el documento sigue encima
    expect(a.m.warnings).toEqual(b.m.warnings);
    const ga = (buildObject(a.wall, 'mesh') as THREE.Mesh).geometry;
    const gb = (buildObject(b.wall, 'mesh') as THREE.Mesh).geometry;
    expect([...gb.index!.array]).toEqual([...ga.index!.array]);
    expect([...gb.attributes.position.array]).toEqual([...ga.attributes.position.array]);
    expect([...gb.attributes.normal.array]).toEqual([...ga.attributes.normal.array]);
  });

  it('a model update keeps what is expanded', async () => {
    const packed = linked();
    packMeshes(packed);
    const pts = (packed.data[1].attributes![MESH] as any).points;
    const edited: ComposerLayer = {
      ...layer,
      edits: [{ path: 'wall', attributes: { 'usd::xformop': { transform: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [5, 0, 0, 1]] } } }],
    };
    const m = await composeStack('doc', 'C:/p/doc.ifcx', doc, [edited], new Map([['./a.ifcx', packed]]));
    const wall = m.result.byPath.get('/root/wall')!;
    expect((wall.attributes[MESH] as any).points).toBe(pts);
    expect(wall.attributes['usd::xformop']).toBeDefined();
  });

  it('los contadores y el aplanado de atributos aceptan arrays tipados', async () => {
    const packed = linked();
    packMeshes(packed);
    const { wall } = await wallAttrs(packed);
    expect(meshVertexCount(wall.attributes[MESH])).toBe(4);
    expect(meshFaceCount(wall.attributes[MESH])).toBe(1);
    const flat = flattenAttributes(wall.attributes);
    expect(flat[`${MESH}::points`]).toBeInstanceOf(Float32Array);
    expect(flat[`${MESH}::faceVertexCounts`]).toBeInstanceOf(Uint32Array);
  });
});
