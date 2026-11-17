import { cut, plain, optString, optInt } from './args';
import { walk, levelOf } from './tree';
import { Command } from './types';
import { classCode, displayName } from '../../../ifcx/names';
import { parseBuildRequest, summarizeBuild } from '../../../modeling/build';
import { parsePlaceFurniture, parsePlaceInWall } from '../../../modeling/place';
import type { ExecutorContext } from './context';

export function installBuilding(ctx: ExecutorContext): void {
  const buildingCommands: Command[] = [
    {
      name: 'build_model',
      args:
        "new? (default true), levels [{name, elevation, height?, layout}], layouts " +
        '{id: {walls? [{from [x,y], to [x,y], thickness?}], floors? [[[x,y],…]]}}',
      description:
        'Build levels, walls and floors in one step (one undo step). With new=true it replaces the open model with ' +
        'a new one and is refused if there are unsaved changes. Lengths in meters. Describe a floor once in layouts ' +
        'and reuse it in several levels.',
      preview: (a) => summarizeBuild(parseBuildRequest(a)),
      run: async (a) => {
        const req = parseBuildRequest(a);
        await ctx.host.buildModel(req);
        ctx.host.openView({ kind: '3d' });
        ctx.host.fit(null);
        return {
          ...summarizeBuild(req),
          level_paths: ctx.host.levels().map((l) => ({ name: l.name, path: l.path })),
        };
      },
    },
    {
      name: 'walls',
      args: 'level? (name), limit? (default 200, max 500)',
      description:
        'The walls of a model built in Dream BIM: axis start and end, length, thickness, height and the library pieces ' +
        'hosted in each. Use it to compute positions.',
      run: (a) => {
        const { root } = ctx.model();
        const level = optString('walls', a, 'level');
        const wanted = level === undefined ? undefined : ctx.levelName(level).toLowerCase();
        const items: {
          path: string; level: string | null; start: number[]; end: number[]; length: number; thickness: number;
          height: number; pieces: { path: string; name: string; ifc_class: string | null }[];
        }[] = [];
        walk(root, (n) => {
          if (classCode(n) !== 'IfcWall') return;
          const data = n.attributes['ifcx-studio::wall'];
          if (!plain(data)) return;
          const start = Array.isArray(data.start) ? (data.start as number[]) : null;
          const end = Array.isArray(data.end) ? (data.end as number[]) : null;
          const thickness = data.thickness;
          const height = n.attributes['bsi::ifc::prop::Height'];
          if (!start || !end || typeof thickness !== 'number' || typeof height !== 'number') return;
          const lvl = levelOf(n);
          if (wanted && lvl?.toLowerCase() !== wanted) return;
          const pieces: { path: string; name: string; ifc_class: string | null }[] = [];
          for (const child of n.children) {
            walk(child, (d) => {
              const cls = classCode(d);
              if (cls !== null) pieces.push({ path: cut(d.path), name: cut(displayName(d)), ifc_class: cls });
            });
          }
          items.push({
            path: cut(n.path), level: lvl, start: [...start], end: [...end],
            length: Math.hypot(end[0] - start[0], end[1] - start[1]), thickness, height, pieces,
          });
        });
        const limit = optInt('walls', a, 'limit', { default: 200, max: 500 });
        return { total: items.length, items: items.slice(0, limit) };
      },
    },
    {
      name: 'place_in_wall',
      args:
        "items [{asset (library .ifcx path), wall (path), offset (m from the wall start to the center of the piece), " +
        "sill? (m above the wall base; default 0, windows 0.9)}] or level (name) + at [x, y] (a point on the wall axis) " +
        'instead of wall + offset',
      description:
        'Put doors and windows from the library into walls; each wall is cut open around its piece (one undo step). ' +
        'Up to 200 pieces.',
      preview: async (a) => (await ctx.host.placePieces(parsePlaceInWall(a), true)).summary,
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const out = await ctx.host.placePieces(parsePlaceInWall(a), false);
        return { ...out.summary, paths: ctx.piecePaths(out.ids) };
      },
    },
    {
      name: 'place_furniture',
      args:
        'items [{asset (library .ifcx path), level (name), at [x, y] (center of the piece), ' +
        'rotation? (degrees counterclockwise, default 0)}]',
      description:
        'Stand furniture and equipment from the library on the floor of a level (one undo step). Up to 200 pieces.',
      preview: async (a) => (await ctx.host.placePieces(parsePlaceFurniture(a), true)).summary,
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const out = await ctx.host.placePieces(parsePlaceFurniture(a), false);
        return { ...out.summary, paths: ctx.piecePaths(out.ids) };
      },
    },
  ];
  ctx.buildingCommands = buildingCommands;
}
