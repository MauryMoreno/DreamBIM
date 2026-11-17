import { Args } from './types';
import { fail, optString } from './args';
import { walk, isElement, levelOf, labels } from './tree';
import type { ComposedNode } from '../../../ifcx/types';
import { classCode } from '../../../ifcx/names';
import type { ExecutorContext } from './context';

export function installHelpers(ctx: ExecutorContext): void {
  const model = () => ctx.host.model() ?? fail('No model is open');
  ctx.model = model;

  const byPath = (path: string): ComposedNode => {
    let found: ComposedNode | null = null;
    walk(model().root, (n) => {
      if (n.path === path) found = n;
    });
    return found ?? fail(`No element at '${path}'`);
  };
  ctx.byPath = byPath;

  /** The nodes of those paths in a single walk of the tree; those that do not exist are omitted. */
  const lookup = (paths: string[]): Map<string, ComposedNode> => {
    const want = new Set(paths);
    const found = new Map<string, ComposedNode>();
    walk(model().root, (n) => {
      if (want.has(n.path)) found.set(n.path, n);
    });
    return found;
  };
  ctx.lookup = lookup;

  const nodesAt = (paths: string[]): ComposedNode[] => {
    const found = lookup(paths);
    return paths.map((p) => found.get(p) ?? fail(`No element at '${p}'`));
  };
  ctx.nodesAt = nodesAt;

  /** Composed paths of the pieces just placed: the first child with an IFC class of each container. */
  const piecePaths = (ids: string[]): string[] => {
    const found = new Map<string, string>();
    walk(model().root, (n) => {
      if (!ids.includes(n.origin)) return;
      const child = n.children.find((c) => classCode(c) !== null);
      if (child) found.set(n.origin, child.path);
    });
    return ids.flatMap((id) => (found.has(id) ? [found.get(id) as string] : []));
  };
  ctx.piecePaths = piecePaths;

  /** Composed paths of the stairs just created. */
  const stairPaths = (ids: string[]): string[] => {
    const found = new Map<string, string>();
    walk(model().root, (n) => {
      if (ids.includes(n.origin) && classCode(n) === 'IfcStair') found.set(n.origin, n.path);
    });
    return ids.flatMap((id) => (found.has(id) ? [found.get(id) as string] : []));
  };
  ctx.stairPaths = stairPaths;

  /** Target of a command that edits or queries: `paths` if given, otherwise the selection. */
  const targets = (cmd: string, a: Args): ComposedNode[] => {
    model();
    if (a.paths !== undefined) {
      const p = a.paths;
      if (!Array.isArray(p) || p.length === 0 || !p.every((x) => typeof x === 'string')) {
        return fail(`${cmd}: 'paths' must be a non-empty array of strings`);
      }
      return nodesAt(p as string[]);
    }
    const sel = ctx.host.selection();
    return sel.length ? nodesAt(sel) : fail('Nothing is selected');
  };
  ctx.targets = targets;

  /** Las escrituras no corren en un modelo de solo lectura. */
  const writable = (): void => {
    if (model().editable === 'readonly') fail('The model is read-only');
  };
  ctx.writable = writable;

  /** Elements that satisfy the filters of `find_elements` and `select`, in walk order. */
  const matching = (cmd: string, a: Args): ComposedNode[] => {
    const { root } = model(); // sin modelo la causa es esa, no que el nivel pedido no exista
    const cls = optString(cmd, a, 'ifc_class')?.toLowerCase();
    const name = optString(cmd, a, 'name')?.toLowerCase();
    const level = optString(cmd, a, 'level');
    const wanted = level === undefined ? undefined : levelName(level).toLowerCase();
    const out: ComposedNode[] = [];
    walk(root, (n) => {
      if (!isElement(n)) return;
      if (cls && classCode(n)?.toLowerCase() !== cls) return;
      if (name && !labels(n).some((l) => l.toLowerCase().includes(name))) return;
      if (wanted && levelOf(n)?.toLowerCase() !== wanted) return;
      out.push(n);
    });
    return out;
  };
  ctx.matching = matching;

  /** Canonical name of the level (case-insensitive) or an error with the levels that exist. */
  const levelName = (name: string): string => {
    const levels = ctx.host.levels();
    return (
      levels.find((l) => l.name.toLowerCase() === name.toLowerCase())?.name ??
      fail(
        levels.length
          ? `Unknown level '${name}'. Levels: ${levels.map((l) => l.name).join(', ')}`
          : `Unknown level '${name}'. The model has no levels`,
      )
    );
  };
  ctx.levelName = levelName;
}
