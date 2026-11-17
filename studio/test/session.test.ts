import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { EditSession, newSession, sessionFromFile, sessionModel } from '../src/modeling/session';
import { newDocument, toIfcx, wallBaseZ, wallHeight } from '../src/modeling/document';
import { applyBuild, parseBuildRequest } from '../src/modeling/build';
import { FLOOR_THICKNESS, UNTITLED, WALL_HEIGHT, WALL_THICKNESS } from '../src/modeling/constants';
import { polygonArea } from '../src/modeling/footprint';

beforeEach(() => vi.clearAllMocks());

describe('EditSession', () => {
  it('a new session has no path or changes and is called Untitled', () => {
    const s = newSession();
    expect(s.path).toBeNull();
    expect(s.dirty).toBe(false);
    expect(s.name).toBe(UNTITLED);
  });

  it('addWall rejects a wall shorter than JOIN_TOLERANCE without dirtying', () => {
    const s = newSession();
    expect(s.addWall([0, 0], [0.0005, 0])).toBeNull();
    expect(s.doc.walls).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });

  it('addWall adds a wall with default values and marks dirty', () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    expect(s.doc.walls).toEqual([w]);
    expect(w.thickness).toBe(WALL_THICKNESS);
    expect(w.height).toBe(WALL_HEIGHT);
    expect(w.baseOffset).toBe(0);
    expect(new Set([w.id, w.bodyId, w.axisId]).size).toBe(3);
    expect(s.dirty).toBe(true);
    expect(s.hasWall(w.id)).toBe(true);
  });

  it('removeWall devuelve false con un id inexistente y no ensucia', () => {
    const s = newSession();
    expect(s.removeWall('nada')).toBe(false);
    expect(s.dirty).toBe(false);
  });

  it('removeWall borra y marca dirty', () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    s.dirty = false;
    expect(s.removeWall(w.id)).toBe(true);
    expect(s.doc.walls).toHaveLength(0);
    expect(s.dirty).toBe(true);
  });

  it('saveTo escribe, fija la ruta y limpia dirty', async () => {
    tauri.invoke.mockResolvedValue(undefined);
    const s = newSession();
    s.addWall([0, 0], [4, 0]);
    await s.saveTo('C:/x/casa.ifcx');
    expect(tauri.invoke).toHaveBeenCalledWith('write_text_file', expect.objectContaining({ path: 'C:/x/casa.ifcx' }));
    expect(s.path).toBe('C:/x/casa.ifcx');
    expect(s.name).toBe('casa.ifcx');
    expect(s.dirty).toBe(false);
  });

  it('saveTo que falla no cambia path ni dirty y relanza', async () => {
    tauri.invoke.mockRejectedValue('denied');
    const s = newSession();
    s.addWall([0, 0], [4, 0]);
    await expect(s.saveTo('C:/x/casa.ifcx')).rejects.toThrow('denied');
    expect(s.path).toBeNull();
    expect(s.dirty).toBe(true);
  });

  it('serialize uses an indentation of 2 and the given date', async () => {
    const text = await newSession().serialize(new Date('2026-01-02T03:04:05.000Z'));
    expect(text).toContain('\n  "header"');
    expect(JSON.parse(text).header.timestamp).toBe('2026-01-02T03:04:05.000Z');
  });

  it('sessionModel de dos muros da dos nodos IfcWall', async () => {
    const s = newSession();
    s.addWall([0, 0], [4, 0]);
    s.addWall([4, 0], [4, 3]);
    const m = await sessionModel(s);
    const walls = [...m.result.byPath.values()].filter(
      (n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall',
    );
    expect(walls).toHaveLength(2);
    expect(m.name).toBe(UNTITLED);
  });

  it('sessionFromFile devuelve null con un archivo que no es de Studio y no lanza', async () => {
    expect(sessionFromFile({} as never, 'a.ifcx')).toBeNull();
  });

  it('sessionFromFile reconstruye el documento con path y sin cambios', async () => {
    const doc = newSession();
    doc.addWall([0, 0], [4, 0]);
    const s = sessionFromFile(await toIfcx(doc.doc, 't'), 'C:/x/a.ifcx')!;
    expect(s).toBeInstanceOf(EditSession);
    expect(s.doc.walls).toHaveLength(1);
    expect(s.path).toBe('C:/x/a.ifcx');
    expect(s.dirty).toBe(false);
    expect(s.composerDamaged).toBe(false);
    void newDocument;
  });

  it('sessionFromFile marks a session whose composer could not be read (the document still opens)', async () => {
    const file = await toIfcx(newSession().doc, 't');
    const project = file.data.find((n) => n.attributes?.['ifcx-studio::composer'] !== undefined)!;
    project.attributes!['ifcx-studio::composer'] = { layers: 'garbage' };
    const s = sessionFromFile(file, 'C:/x/a.ifcx')!;
    expect(s).toBeInstanceOf(EditSession);
    expect(s.composerDamaged).toBe(true);
    expect(s.doc.composer).toEqual({ layers: [], placements: [] });
  });
});

describe('EditSession: niveles', () => {
  it('addLevel creates Level 2 3 m above the highest one and dirties', () => {
    const s = newSession();
    const l2 = s.addLevel();
    expect(l2).toMatchObject({ name: 'Level 2', elevation: 3 });
    expect(s.doc.levels.map((l) => l.id)).toEqual([s.doc.levels[0].id, l2.id]);
    expect(s.dirty).toBe(true);
    expect(s.addLevel()).toMatchObject({ name: 'Level 3', elevation: 6 });
  });

  it('addLevel uses the lowest free number and is placed above the highest one even if it is not the last', () => {
    const s = newSession();
    const l2 = s.addLevel();
    expect(s.renameLevel(l2.id, 'Roof')).toEqual({ ok: true });
    expect(s.addLevel().name).toBe('Level 2');
    expect(s.setLevelElevation(s.doc.levels[0].id, 10)).toEqual({ ok: true });
    expect(s.addLevel().elevation).toBe(13);
  });

  it('renameLevel trims, rejects empty and repeated, and accepts its own name', () => {
    const s = newSession();
    const l2 = s.addLevel();
    s.dirty = false;
    expect(s.renameLevel(l2.id, '   ')).toEqual({ ok: false, error: 'empty-name' });
    expect(s.renameLevel(l2.id, '')).toEqual({ ok: false, error: 'empty-name' });
    expect(s.renameLevel(l2.id, 'Level 1')).toEqual({ ok: false, error: 'duplicate-name' });
    expect(s.renameLevel('nada', 'X')).toEqual({ ok: false, error: 'unknown' });
    expect(l2.name).toBe('Level 2');
    expect(s.dirty).toBe(false);
    expect(s.renameLevel(l2.id, 'Level 2')).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
    expect(s.renameLevel(l2.id, '  Ground ')).toEqual({ ok: true });
    expect(l2.name).toBe('Ground');
    expect(s.dirty).toBe(true);
  });

  it('setLevelElevation changes, validates the number and does not dirty if nothing changes', () => {
    const s = newSession();
    const l = s.doc.levels[0];
    expect(s.setLevelElevation(l.id, NaN)).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setLevelElevation(l.id, Infinity)).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setLevelElevation('nada', 1)).toEqual({ ok: false, error: 'unknown' });
    expect(s.setLevelElevation(l.id, 0)).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
    expect(s.setLevelElevation(l.id, -1.5)).toEqual({ ok: true });
    expect(l.elevation).toBe(-1.5);
    expect(s.dirty).toBe(true);
  });

  it('an elevation change that would leave a wall with height <= 0 is rejected whole', () => {
    const s = newSession();
    const l1 = s.doc.levels[0];
    const l2 = s.addLevel(); // 3 m
    const w = s.addWall([0, 0], [4, 0])!;
    w.topLevelId = l2.id; // atado: altura 3
    s.dirty = false;
    expect(s.setLevelElevation(l1.id, 3)).toEqual({ ok: false, error: 'wall-height' });
    expect(s.setLevelElevation(l1.id, 4)).toEqual({ ok: false, error: 'wall-height' });
    expect(l1.elevation).toBe(0);
    expect(s.dirty).toBe(false);
    expect(s.setLevelElevation(l2.id, 5)).toEqual({ ok: true });
    expect(wallHeight(s.doc.levels, w)).toBe(5);
  });
});

describe('EditSession: restricciones del muro', () => {
  /** Documento con Level 1 (0 m), Level 2 (3 m) y un muro libre de 3 m en Level 1. */
  function conMuro() {
    const s = newSession();
    const l1 = s.doc.levels[0];
    const l2 = s.addLevel();
    const w = s.addWall([0, 0], [4, 0], l1.id)!;
    s.dirty = false;
    return { s, l1, l2, w };
  }

  it('addWall hangs the wall from the given level; without a level, from the lowest one', () => {
    const s = newSession();
    const l1 = s.doc.levels[0];
    const l2 = s.addLevel();
    expect(s.addWall([0, 0], [4, 0], l2.id)!.baseLevelId).toBe(l2.id);
    s.setLevelElevation(l1.id, 10); // now the lowest is Level 2, which is not levels[0]
    expect(s.addWall([0, 1], [4, 1])!.baseLevelId).toBe(l2.id);
  });

  it('addWall con un nivel inexistente devuelve null sin ensuciar; el muro nace libre', () => {
    const s = newSession();
    expect(s.addWall([0, 0], [4, 0], 'nada')).toBeNull();
    expect(s.dirty).toBe(false);
    const w = s.addWall([0, 0], [4, 0])!;
    expect(w).toMatchObject({ topLevelId: null, topOffset: 0, height: WALL_HEIGHT, baseOffset: 0 });
  });

  it('cambiar Base Constraint mueve el muro y conserva Base Offset; el desfase puede ser negativo', () => {
    const { s, l2, w } = conMuro();
    expect(s.setWallConstraints(w.id, { baseOffset: -0.5 })).toEqual({ ok: true });
    expect(s.setWallConstraints(w.id, { baseLevelId: l2.id })).toEqual({ ok: true });
    expect(w.baseLevelId).toBe(l2.id);
    expect(w.baseOffset).toBe(-0.5);
    expect(wallBaseZ(s.doc.levels, w)).toBe(2.5);
    expect(s.dirty).toBe(true);
  });

  it('libre → atado empieza con Top Offset 0 (o el del parche)', () => {
    const { s, l2, w } = conMuro();
    expect(s.setWallConstraints(w.id, { topLevelId: l2.id })).toEqual({ ok: true });
    expect(w.topOffset).toBe(0);
    expect(wallHeight(s.doc.levels, w)).toBe(3);
    s.setWallConstraints(w.id, { topLevelId: null });
    expect(s.setWallConstraints(w.id, { topLevelId: l2.id, topOffset: 0.5 })).toEqual({ ok: true });
    expect(w.topOffset).toBe(0.5);
    expect(wallHeight(s.doc.levels, w)).toBe(3.5);
  });

  it('attached → free keeps the height it had', () => {
    const { s, l2, w } = conMuro();
    s.setLevelElevation(l2.id, 5);
    s.setWallConstraints(w.id, { topLevelId: l2.id, topOffset: -1 }); // altura 4
    expect(s.setWallConstraints(w.id, { topLevelId: null })).toEqual({ ok: true });
    expect(w.topLevelId).toBeNull();
    expect(w.height).toBe(4);
    expect(s.setWallConstraints(w.id, { topLevelId: l2.id, topOffset: 0 })).toEqual({ ok: true });
    expect(s.setWallConstraints(w.id, { topLevelId: null, height: 7 })).toEqual({ ok: true }); // el parche manda
    expect(w.height).toBe(7);
  });

  it('a patch that would leave height <= 0 is rejected and the wall stays intact', () => {
    const { s, l2, w } = conMuro();
    s.setWallConstraints(w.id, { topLevelId: l2.id }); // atado a 3 m, altura 3
    s.dirty = false;
    const antes = { ...w };
    expect(s.setWallConstraints(w.id, { baseLevelId: l2.id })).toEqual({ ok: false, error: 'wall-height' });
    expect(s.setWallConstraints(w.id, { topOffset: -3 })).toEqual({ ok: false, error: 'wall-height' });
    expect(w).toEqual(antes);
    expect(s.dirty).toBe(false);
  });

  it('invalid numbers and references', () => {
    const { s, l2, w } = conMuro();
    expect(s.setWallConstraints(w.id, { height: 0 })).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setWallConstraints(w.id, { height: NaN })).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setWallConstraints(w.id, { baseOffset: Infinity })).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setWallConstraints('nada', { height: 2 })).toEqual({ ok: false, error: 'unknown' });
    expect(s.setWallConstraints(w.id, { baseLevelId: 'x' })).toEqual({ ok: false, error: 'unknown' });
    expect(s.setWallConstraints(w.id, { topLevelId: 'x' })).toEqual({ ok: false, error: 'unknown' });
    expect(w.baseLevelId).not.toBe(l2.id);
    expect(s.dirty).toBe(false);
  });

  it('an empty or unchanged patch does not dirty', () => {
    const { s, w } = conMuro();
    expect(s.setWallConstraints(w.id, {})).toEqual({ ok: true });
    expect(s.setWallConstraints(w.id, { height: w.height, baseOffset: 0 })).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
    expect(s.setWallConstraints(w.id, { height: 2.5 })).toEqual({ ok: true });
    expect(s.dirty).toBe(true);
  });
});

describe('EditSession: suelos', () => {
  const rect: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];

  it('addFloor adds a 300 mm floor on the level, counterclockwise, and marks dirty', () => {
    const s = newSession();
    const lv = s.doc.levels[0].id;
    const f = s.addFloor(rect, lv)!;
    expect(s.doc.floors).toEqual([f]);
    expect(f.levelId).toBe(lv);
    expect(f.thickness).toBe(FLOOR_THICKNESS);
    expect(f.offset).toBe(0);
    expect(f.boundary).toEqual(rect);
    expect(f.id).not.toBe(f.bodyId);
    expect(s.dirty).toBe(true);
    expect(s.hasFloor(f.id)).toBe(true);
  });

  it('addFloor guarda en sentido antihorario un contorno dibujado en sentido horario', () => {
    const s = newSession();
    const f = s.addFloor([...rect].reverse(), s.doc.levels[0].id)!;
    expect(polygonArea(f.boundary)).toBeCloseTo(12);
  });

  it('addFloor rejects fewer than 3 points, zero area or a nonexistent level without dirtying', () => {
    const s = newSession();
    const lv = s.doc.levels[0].id;
    expect(s.addFloor([[0, 0], [1, 0]], lv)).toBeNull();
    expect(s.addFloor([[0, 0], [1, 0], [2, 0]], lv)).toBeNull();
    expect(s.addFloor(rect, 'nope')).toBeNull();
    expect(s.doc.floors).toHaveLength(0);
    expect(s.dirty).toBe(false);
  });

  it('setFloorConstraints cambia de nivel y de offset', () => {
    const s = newSession();
    const l2 = s.addLevel();
    const f = s.addFloor(rect, s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.setFloorConstraints(f.id, { levelId: l2.id, offset: -0.1 })).toEqual({ ok: true });
    expect(f.levelId).toBe(l2.id);
    expect(f.offset).toBe(-0.1);
    expect(s.dirty).toBe(true);
  });

  it('setFloorConstraints rejects nonexistent ids and non-finite numbers without changing anything', () => {
    const s = newSession();
    const f = s.addFloor(rect, s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.setFloorConstraints('nope', { offset: 1 })).toEqual({ ok: false, error: 'unknown' });
    expect(s.setFloorConstraints(f.id, { levelId: 'nope' })).toEqual({ ok: false, error: 'unknown' });
    expect(s.setFloorConstraints(f.id, { offset: NaN })).toEqual({ ok: false, error: 'bad-number' });
    expect(f.offset).toBe(0);
    expect(s.dirty).toBe(false);
  });

  it('setFloorConstraints sin cambios no ensucia', () => {
    const s = newSession();
    const f = s.addFloor(rect, s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.setFloorConstraints(f.id, { offset: 0 })).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
  });

  it('removeFloor', () => {
    const s = newSession();
    const f = s.addFloor(rect, s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.removeFloor('nope')).toBe(false);
    expect(s.dirty).toBe(false);
    expect(s.removeFloor(f.id)).toBe(true);
    expect(s.doc.floors).toEqual([]);
    expect(s.dirty).toBe(true);
  });

  it('el suelo sobrevive a guardar y reabrir', async () => {
    const s = newSession();
    const f = s.addFloor(rect, s.doc.levels[0].id)!;
    const s2 = sessionFromFile(JSON.parse(await s.serialize()), 'C:/a/x.ifcx')!;
    expect(s2.doc.floors).toEqual([f]);
  });
});

describe('EditSession: girar muros y suelos, girar y escalar colocaciones', () => {
  it('rotateWall keeps the start point and the length', () => {
    const s = newSession();
    const w = s.addWall([1, 0], [4, 0])!;
    s.dirty = false;
    expect(s.rotateWall(w.id, 90)).toEqual({ ok: true });
    expect(w.start).toEqual([1, 0]);
    expect(w.end[0]).toBeCloseTo(1, 9);
    expect(w.end[1]).toBeCloseTo(3, 9);
    expect(s.dirty).toBe(true);
    s.dirty = false;
    expect(s.rotateWall(w.id, 90)).toEqual({ ok: true }); // it is already like that
    expect(s.dirty).toBe(false);
    expect(s.rotateWall(w.id, NaN)).toEqual({ ok: false, error: 'bad-number' });
    expect(s.rotateWall('nope', 0)).toEqual({ ok: false, error: 'unknown' });
  });

  it('rotateFloor turns the boundary around its first vertex', () => {
    const s = newSession();
    const f = s.addFloor([[1, 1], [3, 1], [3, 2]], s.doc.levels[0].id)!;
    expect(s.rotateFloor(f.id, 180)).toEqual({ ok: true });
    expect(f.boundary[0]).toEqual([1, 1]);
    expect(f.boundary[1][0]).toBeCloseTo(-1, 9);
    expect(f.boundary[1][1]).toBeCloseTo(1, 9);
    s.dirty = false;
    expect(s.rotateFloor(f.id, 0)).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
  });

  it('setPlacementRotScale rejects a zero scale and unknown ids; neutral values are not kept', () => {
    const s = newSession();
    s.doc.composer.layers.push({ uri: './a.ifcx', name: 'a', color: '', enabled: true, editsEnabled: true, edits: [] });
    s.doc.composer.placements.push({ id: 'P', layerUri: './a.ifcx', parentId: s.doc.ids.project, roots: ['R'], offset: [0, 0, 0] });
    expect(s.setPlacementRotScale('P', { scale: [0, 1, 1] })).toEqual({ ok: false, error: 'bad-number' });
    expect(s.setPlacementRotScale('nope', { rotation: [0, 0, 1] })).toEqual({ ok: false, error: 'unknown' });
    expect(s.setPlacementRotScale('P', { rotation: [0, 0, 45] })).toEqual({ ok: true });
    expect(s.doc.composer.placements[0].rotation).toEqual([0, 0, 45]);
    expect(s.doc.composer.placements[0]).not.toHaveProperty('scale');
  });
});

describe('EditSession: mover muros y suelos', () => {
  it('moveWall moves start and end and marks dirty', () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    s.dirty = false;
    expect(s.moveWall(w.id, 1, -2)).toEqual({ ok: true });
    expect(w.start).toEqual([1, -2]);
    expect(w.end).toEqual([5, -2]);
    expect(s.dirty).toBe(true);
  });

  it('moveFloor moves the boundary and marks dirty', () => {
    const s = newSession();
    const f = s.addFloor([[0, 0], [4, 0], [4, 3], [0, 3]], s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.moveFloor(f.id, 0.5, 1)).toEqual({ ok: true });
    expect(f.boundary).toEqual([[0.5, 1], [4.5, 1], [4.5, 4], [0.5, 4]]);
    expect(s.dirty).toBe(true);
  });

  it('a zero move does not mark dirty; unknown ids and non-finite numbers are rejected', () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    const f = s.addFloor([[0, 0], [4, 0], [4, 3]], s.doc.levels[0].id)!;
    s.dirty = false;
    expect(s.moveWall(w.id, 0, 0)).toEqual({ ok: true });
    expect(s.moveFloor(f.id, 0, 0)).toEqual({ ok: true });
    expect(s.dirty).toBe(false);
    expect(s.moveWall('nope', 1, 0)).toEqual({ ok: false, error: 'unknown' });
    expect(s.moveFloor('nope', 1, 0)).toEqual({ ok: false, error: 'unknown' });
    expect(s.moveWall(w.id, NaN, 0)).toEqual({ ok: false, error: 'bad-number' });
    expect(s.moveFloor(f.id, 0, Infinity)).toEqual({ ok: false, error: 'bad-number' });
    expect(w.start).toEqual([0, 0]);
    expect(s.dirty).toBe(false);
  });
});

describe('EditSession: varias copias y piezas alojadas', () => {
  const U = './door.ifcx';
  const capa = (s: EditSession) =>
    s.doc.composer.layers.push({ uri: U, name: 'door', color: '', enabled: true, editsEnabled: true, edits: [] });
  /** Muro [0,0]→[4,0] y una puerta en su centro. */
  const preparar = () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    capa(s);
    const p = s.addPlacement(U, w.id, ['r'], { host: { along: 2, sill: 0, width: 1, height: 2 } })!;
    s.dirty = false;
    return { s, w, p };
  };

  it('addPlacement creates a copy every time', () => {
    const s = newSession();
    const level = s.doc.levels[0].id;
    const a = s.addPlacement(U, level, ['r'])!;
    const b = s.addPlacement(U, level, ['r'])!;
    expect(s.doc.composer.placements).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect(s.dirty).toBe(true);
    expect(s.addPlacement(U, level, [])).toBeNull();
    expect(s.addPlacement(U, 'nope', ['r'])).toBeNull();
  });

  it('addPlacement con host exige un muro', () => {
    const s = newSession();
    const host = { along: 2, sill: 0, width: 1, height: 2 };
    expect(s.addPlacement(U, s.doc.levels[0].id, ['r'], { host })).toBeNull();
    const w = s.addWall([0, 0], [4, 0])!;
    expect(s.addPlacement(U, w.id, ['r'], { host })).not.toBeNull();
  });

  it('recolocar a mano una pieza alojada bajo otro padre la saca de su muro', () => {
    const s = newSession();
    const w = s.addWall([0, 0], [4, 0])!;
    const p = s.addPlacement(U, w.id, ['r'], { host: { along: 2, sill: 0, width: 1, height: 2 } })!;
    // mismo padre: sigue alojada
    expect(s.place(U, w.id, ['r'])).toBe(false);
    expect(p.host).toBeDefined();
    expect(s.place(U, s.doc.levels[0].id, ['r'])).toBe(true);
    expect(p.parentId).toBe(s.doc.levels[0].id);
    expect(p.host).toBeUndefined();
  });

  it('deleting the wall takes its hosted pieces with it and leaves the others', () => {
    const { s, w } = preparar();
    const normal = s.addPlacement('./silla.ifcx', s.doc.levels[0].id, ['r'])!;
    expect(s.removeWall(w.id)).toBe(true);
    expect(s.doc.composer.placements).toEqual([normal]);
  });

  it('unplace removes all the copies of the file', () => {
    const { s, w } = preparar();
    s.addPlacement(U, w.id, ['r'], { host: { along: 3, sill: 0, width: 0.5, height: 2 } });
    const otra = s.addPlacement('./silla.ifcx', s.doc.levels[0].id, ['r'])!;
    expect(s.unplace(U)).toBe(true);
    expect(s.doc.composer.placements).toEqual([otra]);
    expect(s.unplace(U)).toBe(false);
  });

  it('moving a hosted piece slides it along the wall', () => {
    const { s, p } = preparar();
    expect(s.movePlacement(p.id, [0.5, 9, 0.2])).toEqual({ ok: true });
    expect(p.host).toEqual({ along: 2.5, sill: 0.2, width: 1, height: 2 });
    expect(p.offset).toEqual([0, 0, 0]);
    expect(s.dirty).toBe(true);
  });

  it('moving a hosted piece off the wall is rejected', () => {
    const { s, p } = preparar();
    expect(s.movePlacement(p.id, [10, 0, 0])).toEqual({ ok: false, error: 'opening' });
    expect(p.host!.along).toBe(2);
    expect(s.dirty).toBe(false);
  });

  it('una pieza alojada no gira ni escala', () => {
    const { s, p } = preparar();
    expect(s.setPlacementRotScale(p.id, { rotation: [0, 0, 45] })).toEqual({ ok: false, error: 'opening' });
    expect(s.setPlacementRotScale(p.id, { scale: [2, 2, 2] })).toEqual({ ok: false, error: 'opening' });
    expect(p.rotation).toBeUndefined();
    expect(p.scale).toBeUndefined();
  });

  it('removePlacement', () => {
    const { s, p } = preparar();
    expect(s.removePlacement('nope')).toBe(false);
    expect(s.removePlacement(p.id)).toBe(true);
    expect(s.doc.composer.placements).toEqual([]);
    expect(s.dirty).toBe(true);
  });
});

describe('EditSession: escaleras', () => {
  const conPlanta = () => {
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
    s.dirty = false;
    const stair = s.addStair({
      baseLevelId: s.doc.levels[0].id, topLevelId: s.doc.levels[1].id,
      shape: 'u', origin: [3, 3], angle: 0, width: 1.1, turn: 'left',
    })!;
    return { s, stair };
  };

  it('addStair a�ade y removeStair borra (tambi�n por un sub-id)', () => {
    const { s, stair } = conPlanta();
    expect(s.doc.stairs).toEqual([stair]);
    expect(s.hasStair(`${stair.id}-f1`)).toBe(true);
    expect(s.removeStair(`${stair.id}-f1`)).toBe(true);
    expect(s.doc.stairs).toEqual([]);
    expect(s.dirty).toBe(true);
  });

  it('moveStair mueve si el sitio sigue siendo v�lido', () => {
    const { s, stair } = conPlanta();
    const before = [...stair.origin];
    expect(s.moveStair(stair.id, 0.1, 0)).toEqual({ ok: true });
    expect(stair.origin).toEqual([before[0] + 0.1, before[1]]);
    expect(s.moveStair(`${stair.id}-f2`, 0, 0.1)).toEqual({ ok: true });
    expect(stair.origin[1]).toBeCloseTo(before[1] + 0.1);
  });

  it('moveStair contra un muro devuelve stair y no cambia', () => {
    const { s, stair } = conPlanta();
    const before = [...stair.origin];
    expect(s.moveStair(stair.id, -50, 0)).toEqual({ ok: false, error: 'stair' });
    expect(stair.origin).toEqual(before);
  });
});
