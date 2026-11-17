import { describe, it, expect } from 'vitest';
import { offlineFetcher } from '../src/model/schemas';
import { loadModel } from '../src/model/load';
import { newDocument, toIfcx, type StudioDoc } from '../src/modeling/document';
import { withDocumentLevels } from '../src/modeling/levels';
import { WALL_HEIGHT } from '../src/modeling/constants';
import type { LevelInfo } from '../src/render/levels';
import type { ComposedNode } from '../src/ifcx/types';

const raizDe = async (d: StudioDoc) => {
  const f = await toIfcx(d, '2026-10-23T00:00:00Z');
  const m = await loadModel('x', null, JSON.stringify(f), offlineFetcher);
  return m.result.root!;
};
const raiz = () => raizDe(newDocument());
const buscar = (n: ComposedNode, code: string): ComposedNode | null => {
  if ((n.attributes['bsi::ifc::class'] as any)?.code === code) return n;
  for (const c of n.children) { const r = buscar(c, code); if (r) return r; }
  return null;
};

describe('withDocumentLevels', () => {
  it('it adds the level of a new document without geometry', async () => {
    const r = await raiz();
    const out = withDocumentLevels(r, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Level 1', minZ: 0, maxZ: WALL_HEIGHT });
  });
  it('a storey that already comes from the viewer takes the saved elevation and the name of the node, without being duplicated', async () => {
    const r = await raiz();
    const st = buscar(r, 'IfcBuildingStorey')!;
    const dado: LevelInfo[] = [{ path: st.path, name: 'X', minZ: 1, maxZ: 2 }];
    expect(withDocumentLevels(r, dado)).toEqual([{ path: st.path, name: 'Level 1', minZ: 0, maxZ: 2 }]);
  });
  it('a wall with an offset does not move the elevation of the level and the box still covers the geometry', async () => {
    const r = await raiz();
    const st = buscar(r, 'IfcBuildingStorey')!;
    const dado: LevelInfo[] = [{ path: st.path, name: 'Level 1', minZ: 0.5, maxZ: 3.5 }];
    expect(withDocumentLevels(r, dado)).toEqual([{ path: st.path, name: 'Level 1', minZ: 0, maxZ: 3.5 }]);
  });
  it('at equal elevation the levels come out in creation order, not alphabetical', async () => {
    const d = newDocument();
    d.levels[0].name = 'Zeta';
    d.levels.push({ id: crypto.randomUUID(), name: 'Alpha', elevation: 0 });
    d.levels.push({ id: crypto.randomUUID(), name: 'Mid', elevation: -3 });
    const out = withDocumentLevels(await raizDe(d), []);
    expect(out.map((l) => l.name)).toEqual(['Mid', 'Zeta', 'Alpha']);
  });
  it('un modelo sin atributos de Studio devuelve fromViewer tal cual', async () => {
    const r = await raiz();
    const st = buscar(r, 'IfcBuildingStorey')!;
    delete st.attributes['ifcx-studio::level'];
    const dado: LevelInfo[] = [{ path: '/a', name: 'A', minZ: 0, maxZ: 3 }];
    expect(withDocumentLevels(r, dado)).toEqual(dado);
  });
  it('ignora elevaciones mal formadas', async () => {
    const r = await raiz();
    buscar(r, 'IfcBuildingStorey')!.attributes['ifcx-studio::level'] = { elevation: 'x' };
    expect(withDocumentLevels(r, [])).toEqual([]);
  });
});
