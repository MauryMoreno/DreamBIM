// Filas editables de Properties para niveles y muros de un documento de Studio. Sin DOM.
import type { ComposedNode } from '../ifcx/types';
import { sortedLevels, wallHeight, type FloorParams, type LevelParams, type StairParams, type WallParams } from '../modeling/document';
import type { FloorPatch, WallPatch } from '../modeling/session';
import type { PropertyRow } from './groups';

/** What Properties needs from the open document (main.ts connects it to the controller). */
export interface StudioProps {
  levels(): LevelParams[];
  wall(id: string): WallParams | undefined;
  /** The walls of the document (Pick Walls of the floor sketch). */
  walls(): WallParams[];
  floor(id: string): FloorParams | undefined;
  /** A stair by its id or by a sub-id (flight, landing or rail). */
  stair?(id: string): StairParams | undefined;
  renameLevel(id: string, name: string): Promise<boolean>;
  setLevelElevation(id: string, elevation: number): Promise<boolean>;
  setWallConstraints(id: string, patch: WallPatch): Promise<boolean>;
  setFloorConstraints(id: string, patch: FloorPatch): Promise<boolean>;
}

/** Metros con tres decimales; nunca "-0.000". */
export function formatLength(m: number): string {
  const s = m.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
}

/** Accepts a decimal comma, spaces and a final `m`; null if it is not a number. */
export function parseLength(text: string): number | null {
  const t = text.trim().replace(/\s*m$/i, '').replace(',', '.');
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

const LOCATION_LINE = 'Wall Centerline';

export function studioGroups(
  node: ComposedNode,
  ctx: StudioProps,
): { constraints: PropertyRow[]; name?: PropertyRow } | null {
  const levels = ctx.levels();
  const level = levels.find((l) => l.id === node.origin);
  if (level) {
    return {
      constraints: [
        {
          label: 'Elevation',
          value: formatLength(level.elevation),
          key: 'ifcx-studio::elevation',
          edit: { kind: 'length', commit: (v) => ctx.setLevelElevation(level.id, v) },
        },
      ],
      name: {
        label: 'Name',
        value: level.name,
        key: 'ifcx::name',
        edit: { kind: 'text', commit: (v) => ctx.renameLevel(level.id, v) },
      },
    };
  }

  const ordered = sortedLevels(levels);
  const nameOf = (id: string | null) => ordered.find((l) => l.id === id)?.name ?? '';

  const floor = ctx.floor(node.origin);
  if (floor) {
    return {
      constraints: [
        {
          label: 'Level',
          key: 'ifcx-studio::floorLevel',
          value: nameOf(floor.levelId),
          edit: {
            kind: 'select',
            options: ordered.map((l) => ({ value: l.id, label: l.name })),
            selected: floor.levelId,
            commit: (v) => ctx.setFloorConstraints(floor.id, { levelId: v }),
          },
        },
        {
          label: 'Height Offset From Level',
          key: 'ifcx-studio::floorOffset',
          value: formatLength(floor.offset),
          edit: { kind: 'length', commit: (v) => ctx.setFloorConstraints(floor.id, { offset: v }) },
        },
      ],
    };
  }

  const w = ctx.wall(node.origin);
  if (!w) return null;
  const attached = w.topLevelId !== null;
  const patch = (p: WallPatch) => ctx.setWallConstraints(w.id, p);
  const length = (label: string, key: string, value: number, field: 'baseOffset' | 'topOffset' | 'height'): PropertyRow => ({
    label, key, value: formatLength(value), edit: { kind: 'length', commit: (v) => patch({ [field]: v }) },
  });

  return {
    constraints: [
      { label: 'Location Line', value: LOCATION_LINE, key: 'ifcx-studio::locationLine' },
      {
        label: 'Base Constraint',
        key: 'ifcx-studio::baseLevel',
        value: nameOf(w.baseLevelId),
        edit: {
          kind: 'select',
          options: ordered.map((l) => ({ value: l.id, label: l.name })),
          selected: w.baseLevelId,
          commit: (v) => patch({ baseLevelId: v }),
        },
      },
      length('Base Offset', 'ifcx-studio::baseOffset', w.baseOffset, 'baseOffset'),
      {
        label: 'Top Constraint',
        key: 'ifcx-studio::topLevel',
        value: attached ? `Up to level: ${nameOf(w.topLevelId)}` : 'Unconnected',
        edit: {
          kind: 'select',
          options: [
            { value: '', label: 'Unconnected' },
            ...ordered.map((l) => ({ value: l.id, label: `Up to level: ${l.name}` })),
          ],
          selected: w.topLevelId ?? '',
          commit: (v) => patch({ topLevelId: v || null }),
        },
      },
      attached
        ? { label: 'Unconnected Height', key: 'ifcx-studio::height', value: formatLength(wallHeight(levels, w)) }
        : length('Unconnected Height', 'ifcx-studio::height', w.height, 'height'),
      attached
        ? length('Top Offset', 'ifcx-studio::topOffset', w.topOffset, 'topOffset')
        : { label: 'Top Offset', key: 'ifcx-studio::topOffset', value: '' },
    ],
  };
}
