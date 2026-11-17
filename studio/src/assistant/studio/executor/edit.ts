import { fail, reqString } from './args';
import { Command } from './types';
import type { ExecutorContext } from './context';

export function installEdit(ctx: ExecutorContext): void {
  const editCommands: Command[] = [
    {
      name: 'delete_elements',
      args: 'paths? (default: the selection)',
      description:
        'Delete walls, floors, stairs and placed library pieces of the open model (one undo step). Deleting a wall ' +
        'deletes the pieces hosted in it.',
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const nodes = ctx.targets('delete_elements', a);
        const paths = nodes.map((n) => n.path);
        const count = await ctx.host.deleteElements(paths);
        ctx.host.clearHighlight(paths);
        return { count };
      },
    },
    {
      name: 'open_model',
      args: 'path (absolute .ifcx)',
      description: 'Open an .ifcx model. Refused if the open model has unsaved changes.',
      run: async (a) => {
        const path = reqString('open_model', a, 'path');
        if (!path.toLowerCase().endsWith('.ifcx')) return fail("open_model: 'path' must be an .ifcx file");
        await ctx.host.openModel(path);
        return { name: ctx.host.model()?.name ?? null };
      },
    },
  ];
  ctx.editCommands = editCommands;
}
