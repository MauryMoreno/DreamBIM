import { TOGGLES, VIEWS, SELECTION_MAX, SHOT_DEFAULT, SHOT_MAX } from './limits';
import { fail, cut, optString, reqString, reqBool, optInt, colorArgs } from './args';
import { Command } from './types';
import { displayName } from '../../../ifcx/names';
import type { ViewRequest, Toggle } from '../host';
import type { ExecutorContext } from './context';

export function installView(ctx: ExecutorContext): void {
  const viewCommands: Command[] = [
    {
      name: 'screenshot',
      args: 'max_size? (default 1024)',
      description: 'Capture the current view as a PNG image.',
      run: async (a) => {
        const max = optInt('screenshot', a, 'max_size', { default: SHOT_DEFAULT, max: SHOT_MAX });
        const shot = (await ctx.host.screenshot(max)) ?? fail('No view to capture');
        return { image: shot.dataUrl, width: shot.width, height: shot.height };
      },
    },
    {
      name: 'open_view',
      args: "kind ('3d' | 'plan' | 'front' | 'side'), level? (for plan)",
      description: 'Open a view: 3D, the floor plan of a level, or an elevation.',
      run: (a) => {
        ctx.model();
        const kind = optString('open_view', a, 'kind');
        if (!kind || !(VIEWS as readonly string[]).includes(kind)) {
          return fail(`open_view: 'kind' must be one of ${VIEWS.join(', ')}`);
        }
        const level = optString('open_view', a, 'level');
        const v: ViewRequest =
          kind === '3d' ? { kind: '3d' }
          : kind === 'plan' ? { kind: 'plan', level: level === undefined ? null : ctx.levelName(level) }
          : { kind: 'elevation', side: kind as 'front' | 'side' };
        ctx.host.openView(v);
        return { ok: true };
      },
    },
    {
      name: 'fit',
      args: 'path?',
      description: 'Frame the view on an element, or on the whole model.',
      run: (a) => {
        ctx.model();
        const path = optString('fit', a, 'path');
        ctx.host.fit(path === undefined ? null : ctx.byPath(path).path);
        return { ok: true };
      },
    },
    {
      name: 'select',
      args: 'path | paths | ifc_class?, name?, level?; add? (path null clears)',
      description:
        'Select elements by path, by a list of paths, or by the same filters as find_elements. With add the result joins the current selection.',
      run: (a) => {
        ctx.model();
        if (a.path === null) {
          ctx.host.select(null);
          return { total: 0, primary: null };
        }
        const add = a.add === undefined ? false : reqBool('select', a, 'add');
        let list: string[];
        if (a.paths !== undefined) {
          const p = a.paths;
          if (!Array.isArray(p) || p.length === 0 || !p.every((x) => typeof x === 'string')) {
            return fail("select: 'paths' must be a non-empty array of strings");
          }
          list = ctx.nodesAt(p as string[]).map((n) => n.path);
        } else if (a.path !== undefined) {
          list = [ctx.byPath(reqString('select', a, 'path')).path];
        } else if (a.ifc_class !== undefined || a.name !== undefined || a.level !== undefined) {
          list = ctx.matching('select', a).map((n) => n.path);
          if (list.length === 0) return fail('select: nothing matches the filter');
        } else {
          return fail("select: give 'path', 'paths' or a filter");
        }
        if (!add && a.path !== undefined && list.length === 1) ctx.host.select(list[0]);
        else {
          const merged = add ? [...ctx.host.selection().filter((p) => !list.includes(p)), ...list] : list;
          ctx.host.selectMany(merged);
          list = merged;
        }
        return { total: list.length, primary: list.at(-1) ?? null };
      },
    },
    {
      name: 'set_toggle',
      args: 'name (xray | section | shadows | grid), on',
      description: 'Turn a view option on or off.',
      run: (a) => {
        const name = optString('set_toggle', a, 'name');
        if (!name || !(TOGGLES as readonly string[]).includes(name)) {
          return fail(`set_toggle: 'name' must be one of ${TOGGLES.join(', ')}`);
        }
        const on = reqBool('set_toggle', a, 'on');
        ctx.host.setToggle(name as Toggle, on);
        return { name, on };
      },
    },
    {
      name: 'set_layer_hidden',
      args: 'id, hidden',
      description: 'Hide or show a layer in the view (it stays in the composition). Ids come from `layers`.',
      run: (a) => {
        const id = reqString('set_layer_hidden', a, 'id');
        const hidden = reqBool('set_layer_hidden', a, 'hidden');
        if (!ctx.host.setLayerHidden(id, hidden)) {
          return fail(`Unknown layer '${id}'. Layers: ${ctx.host.layers().map((l) => l.id).join(', ')}`);
        }
        return { id, hidden };
      },
    },
    {
      name: 'provenance',
      args: 'paths? (default: the selection)',
      description: 'Where each attribute of the elements comes from: the file or layer that defines it, and the inheritance chain if any.',
      run: (a) => {
        const nodes = ctx.targets('provenance', a);
        const items = nodes.slice(0, SELECTION_MAX).map((n) => ({
          path: cut(n.path),
          name: cut(displayName(n)),
          ...(ctx.host.provenance(n.path) ?? { sources: [], attributes: {} }),
        }));
        return { total: nodes.length, items };
      },
    },
    {
      name: 'highlight',
      args: 'paths? (default: the selection), color (#rrggbb), opacity? (0-1)',
      description: 'Paint elements with a temporary color in the view only. The model is not changed. Use clear_highlight to remove it.',
      run: (a) => {
        const nodes = ctx.targets('highlight', a);
        ctx.host.highlight(nodes.map((n) => n.path), colorArgs('highlight', a));
        return { count: nodes.length };
      },
    },
    {
      name: 'clear_highlight',
      args: 'paths? (default: all)',
      description: 'Remove the temporary colors the assistant put on the view: of every element, or only of the given paths.',
      run: (a) => {
        const p = a.paths;
        if (p !== undefined && (!Array.isArray(p) || !p.every((x) => typeof x === 'string'))) {
          return fail("clear_highlight: 'paths' must be an array of strings");
        }
        ctx.host.clearHighlight(p as string[] | undefined);
        return { ok: true };
      },
    },
  ];
  ctx.viewCommands = viewCommands;
}
