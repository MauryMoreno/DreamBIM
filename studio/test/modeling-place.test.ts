import { describe, expect, it } from 'vitest';
import { newDocument, type StudioDoc, type WallParams } from '../src/modeling/document';
import {
  DEFAULT_SILL, MAX_PIECES, applyPlace, parsePlaceFurniture, parsePlaceInWall, resolveWallPiece, summarizePlace, type AssetRef,
} from '../src/modeling/place';

const muro = (d: StudioDoc): WallParams => ({
  id: 'w', start: [0, 0], end: [4, 0], thickness: 0.2,
  bodyId: 'wb', axisId: 'wa', baseLevelId: d.levels[0].id, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
});
const doc = () => {
  const d = newDocument();
  d.walls.push(muro(d));
  return d;
};

const door: AssetRef = { layerUri: './door.ifcx', roots: ['D'], name: 'Door', ifcClass: 'IfcDoor', width: 1, height: 2.1 };
const window_: AssetRef = { layerUri: './window.ifcx', roots: ['W'], name: 'Window', ifcClass: 'IfcWindow', width: 1.2, height: 1.5 };
const chair: AssetRef = { layerUri: './chair.ifcx', roots: ['C'], name: 'Chair', ifcClass: 'IfcFurniture', width: 0.5, depth: 0.5, height: 0.9 };
const assets = new Map<string, AssetRef>([
  ['/lib/door.ifcx', door], ['/lib/window.ifcx', window_], ['/lib/chair.ifcx', chair],
]);

describe('Assistant placement request', () => {
  it('lee y normaliza place_in_wall', () => {
    const req = parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 'w', offset: 1.23456 }] });
    const first = req.items[0];
    expect('wall' in first && first.offset).toBe(1.235);
    expect(req.items[0]).not.toHaveProperty('sill');
    const withSill = parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 'w', offset: 1, sill: 0.1234 }] });
    expect(withSill.items[0].sill).toBe(0.123);
    expect(parsePlaceFurniture({ items: [{ asset: '/lib/chair.ifcx', level: 'Level 1', at: [1.2345, 2] }] }).items[0]).toEqual({
      asset: '/lib/chair.ifcx', level: 'Level 1', at: [1.235, 2], rotation: 0,
    });
  });

  it('it rejects empty items, more than 200 or with wrong fields', () => {
    expect(() => parsePlaceInWall({ items: [] })).toThrow("place_in_wall: 'items' must be an array of 1 to 200 pieces");
    const many = Array.from({ length: MAX_PIECES + 1 }, () => ({ asset: '/lib/door.ifcx', wall: 'w', offset: 1 }));
    expect(() => parsePlaceInWall({ items: many })).toThrow(/place_in_wall: 'items'/);
    expect(() => parsePlaceInWall({ items: [{ asset: 'door.txt', wall: 'w', offset: 1 }] })).toThrow(/asset/);
    expect(() => parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 3, offset: 1 }] })).toThrow(/wall/);
    expect(() => parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 'w', offset: 'x' }] })).toThrow(/offset/);
    expect(() => parsePlaceFurniture({ items: [{ asset: '/lib/chair.ifcx', level: 'L', at: [1, 2, 3] }] })).toThrow(/'at'/);
    expect(() => parsePlaceFurniture({ items: [{ asset: '/lib/chair.ifcx', level: 'L', at: [20000, 0] }] })).toThrow(/±10000/);
  });

  it('una puerta queda a cota 0 y una ventana a 0.9', () => {
    const d = doc();
    applyPlace(d, parsePlaceInWall({
      items: [
        { asset: '/lib/door.ifcx', wall: 'w', offset: 1 },
        { asset: '/lib/window.ifcx', wall: 'w', offset: 3 },
      ],
    }), assets);
    expect(DEFAULT_SILL).toBe(0.9);
    expect(d.composer.placements[0].host).toEqual({ along: 1, sill: 0, width: 1, height: 2.1 });
    expect(d.composer.placements[1].host).toEqual({ along: 3, sill: 0.9, width: 1.2, height: 1.5 });
  });

  it('dos piezas iguales son dos colocaciones del mismo archivo', () => {
    const d = doc();
    const ids = applyPlace(d, parsePlaceInWall({
      items: [
        { asset: '/lib/door.ifcx', wall: 'w', offset: 1 },
        { asset: '/lib/door.ifcx', wall: 'w', offset: 3 },
      ],
    }), assets);
    expect(new Set(ids).size).toBe(2);
    expect(d.composer.placements.map((p) => p.layerUri)).toEqual(['./door.ifcx', './door.ifcx']);
  });

  it('the second piece of the request cannot overlap the first', () => {
    const d = doc();
    expect(() => applyPlace(d, parsePlaceInWall({
      items: [
        { asset: '/lib/door.ifcx', wall: 'w', offset: 1.5 },
        { asset: '/lib/door.ifcx', wall: 'w', offset: 2 },
      ],
    }), assets)).toThrow('place_in_wall: items[1]: overlaps another piece in the same wall');
  });

  it('si un item falla, el documento no cambia', () => {
    const d = doc();
    const before = JSON.stringify(d);
    expect(() => applyPlace(d, parsePlaceInWall({
      items: [
        { asset: '/lib/door.ifcx', wall: 'w', offset: 1 },
        { asset: '/lib/door.ifcx', wall: 'nope', offset: 3 },
      ],
    }), assets)).toThrow("place_in_wall: items[1]: no wall 'nope' in the model");
    expect(JSON.stringify(d)).toBe(before);
  });

  it('muro inexistente y asset sin medidas', () => {
    const d = doc();
    expect(() => applyPlace(d, parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 'nope', offset: 1 }] }), assets))
      .toThrow("no wall 'nope'");
    const sinMedidas = new Map(assets).set('/lib/blob.ifcx', { layerUri: './blob.ifcx', roots: ['B'], name: 'Blob', ifcClass: null });
    expect(() => applyPlace(d, parsePlaceInWall({ items: [{ asset: '/lib/blob.ifcx', wall: 'w', offset: 1 }] }), sinMedidas))
      .toThrow("'Blob' has no Width/Height, it cannot cut an opening");
  });

  it('mueble: offset en el nivel y giro', () => {
    const d = doc();
    applyPlace(d, parsePlaceFurniture({
      items: [
        { asset: '/lib/chair.ifcx', level: 'Level 1', at: [2, 3], rotation: 90 },
        { asset: '/lib/chair.ifcx', level: ' level 1 ', at: [1, 1] },
      ],
    }), assets);
    const [a, b] = d.composer.placements;
    expect(a).toMatchObject({ offset: [2, 3, 0], rotation: [0, 0, 90], parentId: d.levels[0].id });
    expect(b).toMatchObject({ offset: [1, 1, 0], parentId: d.levels[0].id });
    expect(b).not.toHaveProperty('rotation');
  });

  it('a nonexistent level lists the ones that exist', () => {
    const d = doc();
    expect(() => applyPlace(d, parsePlaceFurniture({ items: [{ asset: '/lib/chair.ifcx', level: 'N9', at: [0, 0] }] }), assets))
      .toThrow("place_furniture: items[0]: no level named 'N9' (levels: Level 1)");
  });

  it('resumen por pieza', () => {
    const req = parsePlaceInWall({
      items: [
        { asset: '/lib/door.ifcx', wall: 'w', offset: 1 },
        { asset: '/lib/door.ifcx', wall: 'w', offset: 3 },
        { asset: '/lib/chair.ifcx', wall: 'w', offset: 1 },
      ],
    });
    expect(summarizePlace(req, assets)).toEqual({
      total: 3,
      targets: 1,
      pieces: [
        { name: 'Door', ifc_class: 'IfcDoor', count: 2, width: 1, height: 2.1 },
        { name: 'Chair', ifc_class: 'IfcFurniture', count: 1, width: 0.5, depth: 0.5, height: 0.9 },
      ],
    });
  });
});

describe('piezas en un muro por nivel y punto', () => {
  it('lee la forma level + at', () => {
    const req = parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', level: 'Level 1', at: [2, 0] }] });
    expect(req.items[0]).toEqual({ asset: '/lib/door.ifcx', level: 'Level 1', at: [2, 0] });
  });

  it('it requires exactly one of the two forms', () => {
    const both = { asset: '/lib/door.ifcx', wall: 'w', offset: 1, level: 'Level 1', at: [2, 0] };
    expect(() => parsePlaceInWall({ items: [both] })).toThrow(/give 'wall' with 'offset', or 'level' with 'at'/);
    expect(() => parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx' }] })).toThrow(/give 'wall' with 'offset', or 'level' with 'at'/);
  });

  it('resolveWallPiece finds the wall that passes through the point', () => {
    const d = doc();
    expect(resolveWallPiece(d, 'Level 1', [2, 0.05])).toEqual({ wallId: 'w', offset: 2 });
    expect(() => resolveWallPiece(d, 'Level 1', [2, 0.5])).toThrow('no wall of Level 1 passes through [2, 0.5]');
  });

  it('applyPlace by point creates the same placement as by wall', () => {
    const byWall = doc();
    const byPoint = doc();
    applyPlace(byWall, parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', wall: 'w', offset: 2 }] }), assets);
    applyPlace(byPoint, parsePlaceInWall({ items: [{ asset: '/lib/door.ifcx', level: 'Level 1', at: [2, 0] }] }), assets);
    expect(byPoint.composer.placements[0].host).toEqual(byWall.composer.placements[0].host);
  });
});
