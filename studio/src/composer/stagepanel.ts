// Stage panel: the composed hierarchy as a single tree. Each row carries the color of its layer of
// origin (the strongest that defines the element) and its edit marks. Lazy rendering: only
// the rows of the expanded branches are created, in pages, for big models.
import type { ComposedNode } from '../ifcx/types';
import { installChrome } from './stage/chrome';
import { installState } from './stage/state';
import { installRows } from './stage/rows';
import { installDragReparent } from './stage/drag-reparent';
import { installRender } from './stage/render';
import { installKeyboard } from './stage/keyboard';
import type { StageContext } from './stage/context';
import { StageCallbacks, StagePanel } from './stage/types';
import { OPEN_DEPTH, OPEN_MAX_CHILDREN } from './stage/helpers';
export type { EditMark, StageData, ReparentAt, StageCallbacks, StagePanel } from './stage/types';

export function mountStagePanel(host: HTMLElement, cb: StageCallbacks): StagePanel {
  const ctx = { host, cb } as unknown as StageContext;
  installChrome(ctx);
  installState(ctx);
  installRows(ctx);
  installDragReparent(ctx);
  installRender(ctx);
  installKeyboard(ctx);

  return {
    setStage(next) {
      ctx.data = next;
      ctx.byPath = new Map();
      const walk = (n: ComposedNode) => {
        for (const c of n.children) {
          ctx.byPath.set(c.path, c);
          walk(c);
        }
      };
      if (next.root) walk(next.root);
      // what is expanded survives a recomposition; with another model it goes back to the starting state
      const before = ctx.expanded.size;
      for (const p of [...ctx.expanded]) if (!ctx.byPath.has(p)) ctx.expanded.delete(p);
      if (ctx.selected && !ctx.byPath.has(ctx.selected)) ctx.selected = null;
      const hadHidden = ctx.hidden.size;
      for (const p of [...ctx.hidden]) if (!ctx.byPath.has(p)) ctx.hidden.delete(p);
      if (ctx.hidden.size !== hadHidden) cb.onHiddenChange?.(new Set(ctx.hidden));
      if (!next.root || (before > 0 && ctx.expanded.size === 0)) ctx.seeded = false;
      if (next.root && !ctx.seeded) {
        ctx.seeded = true;
        const open = (n: ComposedNode, d: number) => {
          for (const c of n.children) {
            if (d > OPEN_DEPTH || !c.children.length || c.children.length > OPEN_MAX_CHILDREN) continue;
            ctx.expanded.add(c.path);
            open(c, d + 1);
          }
        };
        open(next.root, 1);
      }
      ctx.render();
    },
    markSelected(paths) {
      ctx.multi = new Set(paths);
      for (const [p, r] of ctx.rows) r.classList.toggle('is-multi', ctx.multi.has(p));
    },
    reveal(path) {
      const n = path !== null ? ctx.byPath.get(path) : undefined;
      if (!n) {
        ctx.setSelected(null);
        return;
      }
      const chain: ComposedNode[] = [];
      for (let a = n.parent; a && a.parent; a = a.parent) chain.unshift(a);
      if (ctx.query) {
        for (const a of chain) ctx.expanded.add(a.path);
        ctx.selected = n.path;
        ctx.render();
      } else {
        // de arriba abajo, cada antepasado plegado se despliega sin repintar el resto
        let painted = true;
        for (const a of chain) {
          if (painted && ctx.rows.has(a.path)) {
            if (!ctx.expanded.has(a.path) || !ctx.groupOf(ctx.rows.get(a.path)!)) ctx.openRow(a.path);
          } else {
            painted = false;
            ctx.expanded.add(a.path);
          }
        }
        if (!painted) {
          ctx.selected = n.path;
          ctx.render();
        } else ctx.setSelected(n.path);
      }
      ctx.rows.get(n.path)?.scrollIntoView?.({ block: 'nearest' });
    },
  };
}
