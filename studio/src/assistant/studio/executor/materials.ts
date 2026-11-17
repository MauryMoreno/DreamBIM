import { fail, reqString, colorArgs } from './args';
import { Command } from './types';
import type { ExecutorContext } from './context';

export function installMaterials(ctx: ExecutorContext): void {
  const materialsCommands: Command[] = [
    {
      name: 'list_materials',
      args: '',
      description: 'The material catalog of the open model: code, name, color, opacity and how many elements use each.',
      run: () => {
        ctx.model();
        return { materials: ctx.host.materials() };
      },
    },
    {
      name: 'set_color',
      args: 'paths? (default: the selection), color (#rrggbb, or null to remove it), opacity? (0-1)',
      description: 'Save a color on the elements in the model (one undo step). For a view-only color use highlight.',
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const nodes = ctx.targets('set_color', a);
        const color = a.color === null ? null : colorArgs('set_color', a);
        const paths = nodes.map((n) => n.path);
        await ctx.host.setColor(paths, color);
        ctx.host.clearHighlight(paths); // a temporary highlight would cover the saved color
        return { count: nodes.length };
      },
    },
    {
      name: 'assign_material',
      args: 'paths? (default: the selection), code (a material code from list_materials, or null to remove it)',
      description: 'Assign a catalog material to the elements (one undo step).',
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const nodes = ctx.targets('assign_material', a);
        const code = a.code === null ? null : reqString('assign_material', a, 'code');
        if (code !== null) {
          const known = ctx.host.materials();
          if (!known.some((m) => m.code === code)) {
            return fail(
              known.length
                ? `Unknown material '${code}'. Materials: ${known.map((m) => m.code).join(', ')}`
                : `Unknown material '${code}'. The model has no materials`,
            );
          }
        }
        const paths = nodes.map((n) => n.path);
        await ctx.host.assignMaterial(paths, code);
        ctx.host.clearHighlight(paths);
        return { count: nodes.length, code };
      },
    },
    {
      name: 'create_material',
      args: 'code, name, color (#rrggbb), opacity? (0-1)',
      description: 'Add a material to the catalog of the open model (one undo step).',
      run: async (a) => {
        ctx.model();
        ctx.writable();
        const code = reqString('create_material', a, 'code');
        const name = reqString('create_material', a, 'name');
        const { color, opacity } = colorArgs('create_material', a);
        if (ctx.host.materials().some((m) => m.code === code)) return fail(`Material '${code}' already exists`);
        await ctx.host.createMaterial({ code, name, color, opacity });
        return { code };
      },
    },
  ];
  ctx.materialsCommands = materialsCommands;
}
