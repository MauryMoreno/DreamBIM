import { FIND, LIBRARY, SELECTION_MAX } from './limits';
import { fail, cut, reqString, optInt } from './args';
import { walk, isElement, summary } from './tree';
import { Command } from './types';
import type { ComposedNode } from '../../../ifcx/types';
import { classCode } from '../../../ifcx/names';
import type { ExecutorContext } from './context';

export function installQuery(ctx: ExecutorContext): void {
    const queryCommands: Command[] = [
    {
      name: 'help',
      args: '',
      description: 'List the Studio commands and their arguments.',
      run: () => ({ commands: ctx.commands.map(({ name, args, description }) => ({ name, args, description })) }),
    },
    {
      name: 'model_info',
      args: '',
      description: 'Name, path, unsaved changes, levels and element counts of the open model.',
      run: () => {
        const m = ctx.model();
        const classes: Record<string, number> = {};
        let elements = 0;
        walk(m.root, (n) => {
          if (!isElement(n)) return;
          elements += 1;
          const c = classCode(n) as string;
          classes[c] = (classes[c] ?? 0) + 1;
        });
        return { name: m.name, path: m.path, dirty: m.dirty, editable: m.editable, levels: ctx.host.levels(), elements, classes };
      },
    },
    {
      name: 'find_elements',
      args: 'ifc_class?, name?, level?, limit? (default 50, max 200)',
      description: 'Find elements by IFC class, name substring and level name. Returns the total and the first items.',
      run: (a) => {
        const found = ctx.matching('find_elements', a);
        const limit = optInt('find_elements', a, 'limit', FIND);
        return { total: found.length, items: found.slice(0, limit).map(summary) };
      },
    },
    {
      name: 'element',
      args: 'path',
      description: 'Details of one element: class, level, number of children and its simple attributes.',
      run: (a) => {
        const n = ctx.byPath(reqString('element', a, 'path'));
        const attributes: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(n.attributes)) {
          if (typeof v === 'string') attributes[k] = cut(v);
          else if (typeof v === 'number' || typeof v === 'boolean') attributes[k] = v;
        }
        return { ...summary(n), children: n.children.length, attributes };
      },
    },
    {
      name: 'selection',
      args: '',
      description: 'The elements the user has selected (the last one is the primary), or none.',
      run: () => {
        const sel = ctx.host.model() ? ctx.host.selection() : [];
        const found = sel.length ? ctx.lookup(sel) : new Map<string, ComposedNode>();
        const items = sel.slice(0, SELECTION_MAX).flatMap((p) => (found.has(p) ? [summary(found.get(p) as ComposedNode)] : []));
        return { total: sel.length, primary: sel.at(-1) ?? null, items };
      },
    },
    {
      name: 'layers',
      args: '',
      description: 'The linked files (layers) of the open model with their enabled and hidden state.',
      run: () => ctx.host.layers(),
    },
    {
      name: 'library_search',
      args: 'query, limit? (default 20, max 100)',
      description: 'Search the Library folder for .ifcx assets by file name. Adds class and size when the Collection has indexed them.',
      run: async (a) => {
        const query = reqString('library_search', a, 'query');
        const folder = ctx.host.libraryFolder() ?? fail('No library folder is open in the Library panel');
        const found = await ctx.host.searchLibrary(query, optInt('library_search', a, 'limit', LIBRARY));
        const items = await Promise.all(
          found.map(async (f) => {
            const info = await ctx.host.cardInfo(f.path);
            return { path: f.path, name: f.name, ifc_class: info?.ifcClass ?? null, dims: info?.dims ?? null };
          }),
        );
        return { folder, items };
      },
    },
  ];
  ctx.queryCommands = queryCommands;
}
