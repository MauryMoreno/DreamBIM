import { editPath } from '../../composer/edits';
import type { ScheduleModeContext } from './context';

export function installPaths(ctx: ScheduleModeContext): void {
  ctx.toComposed = toComposed;
  ctx.elementLabel = elementLabel;
  ctx.selectionKeys = selectionKeys;
  // --- Paths: from edit (what is saved) to composed (what the viewer draws) and back ---------------
  function toComposed(key: string): string | null {
    const m = ctx.d.model();
    if (!m) return null;
    const direct = m.result.byOrigin.get(key);
    if (direct?.length === 1) return direct[0].path;
    const i = key.lastIndexOf('/');
    if (i > 0) {
      for (const p of m.result.byOrigin.get(key.slice(0, i)) ?? []) {
        const c = p.children.find((ch) => ch.name === key.slice(i + 1));
        if (c) return c.path;
      }
    }
    return direct?.[0]?.path ?? null;
  }

  /** How an element is named in the lists: its name and, in parentheses, its IFC class. */
  function elementLabel(path: string): string {
    const node = ctx.d.model()?.result.byPath.get(path);
    if (!node) return path;
    const cls = (node.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;
    return cls ? `${node.name} (${cls})` : node.name;
  }

  /** The elements selected in the model as edit keys, with their name. */
  function selectionKeys(): { key: string; label: string }[] {
    const paths = ctx.d.selection?.() ?? [];
    const all = paths.length ? paths : ctx.d.selected() ? [ctx.d.selected()!] : [];
    const out = new Map<string, string>();
    for (const p of all) {
      const key = editKey(p);
      if (key) out.set(key, elementLabel(p));
    }
    return [...out].map(([key, label]) => ({ key, label }));
  }

  function editKey(path: string): string | null {
    const m = ctx.d.model();
    const node = m?.result.byPath.get(path);
    return m && node ? editPath(node, m.result) : null;
  }
}
