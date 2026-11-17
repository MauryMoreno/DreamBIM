import { StageData } from './types';
import { PAGE, PLUS, MINUS, el, matches } from './helpers';
import { K_CLASS_SYSTEM } from '../../classification/system';
import { K_WORK_SCHEDULE } from '../../schedule/nodes';
import { K_COST_PRICE, K_INSUMO } from '../../costs/prices';
import { K_COST_SYSTEM } from '../../costs/system';
import type { ComposedNode } from '../../ifcx/types';
import type { StageContext } from './context';

export function installRender(ctx: StageContext): void {
  /** The code attributes of the cost systems of the model (each root says its own), from the last composition. */
  let costAttrsOf: StageData | null = null;

  let costAttrs = new Set<string>();

  const costAttributes = (): Set<string> => {
    if (costAttrsOf !== ctx.data) {
      costAttrsOf = ctx.data;
      costAttrs = new Set(
        (ctx.data.root?.children ?? []).flatMap((c) => {
          const v = c.attributes[K_COST_SYSTEM] as { attribute?: unknown } | undefined;
          return v && typeof v.attribute === 'string' ? [v.attribute] : [];
        }),
      );
    }
    return costAttrs;
  };

  /**
   * An imported classification table (its root carries `system`), the schedule (IfcWorkSchedule) or the cost system (`prj::costos::sistema`): they are
   * catalogs, not part of the model.
   */
  const isCatalog = (n: ComposedNode): boolean => {
    if (n.parent !== ctx.data.root) return false;
    const a = n.attributes;
    if (a[K_CLASS_SYSTEM] !== undefined || a[K_WORK_SCHEDULE] !== undefined || a[K_COST_SYSTEM] !== undefined) return true;
    // the codes of the cost system and the APUs and inputs of their prices are flat nodes; an element (with a class) does not
    if (a['bsi::ifc::class'] !== undefined) return false;
    return a[K_COST_PRICE] !== undefined || a[K_INSUMO] !== undefined || [...costAttributes()].some((k) => a[k] !== undefined);
  };

  /** Paints the children of `n` (those of `keep` in a search), by pages. */
  const renderChildren = (n: ComposedNode, depth: number, into: Node, keep: Set<ComposedNode> | null, from = 0): void => {
    const shown = n === ctx.data.root ? n.children.filter((c) => !isCatalog(c)) : n.children;
    const kids = keep ? shown.filter((c) => keep.has(c)) : shown;
    const end = Math.min(kids.length, from + PAGE);
    for (let i = from; i < end; i++) {
      const c = kids[i];
      const hasKids = keep ? c.children.some((k) => keep.has(k)) : c.children.length > 0;
      const open = hasKids && (keep !== null || ctx.expanded.has(c.path));
      into.appendChild(ctx.row(c, depth, open, hasKids));
      if (open) {
        const group = el('div', 'pb-group');
        group.setAttribute('role', 'group');
        renderChildren(c, depth + 1, group, keep);
        into.appendChild(group);
      }
    }
    if (end < kids.length) {
      const rest = kids.length - end;
      const more = el('button', 'stage-more', `Show ${Math.min(PAGE, rest)} more of ${rest}`);
      more.type = 'button';
      more.style.setProperty('--depth', String(depth));
      more.addEventListener('click', () => {
        const frag = document.createDocumentFragment();
        renderChildren(n, depth, frag, keep, end);
        more.replaceWith(frag);
      });
      into.appendChild(more);
    }
  };

  /** Coincidencias y sus antepasados (lo que se ve al buscar). */
  const searchSet = (root: ComposedNode, q: string): Set<ComposedNode> => {
    const keep = new Set<ComposedNode>();
    const walk = (n: ComposedNode) => {
      for (const c of n.children) {
        if (isCatalog(c)) continue;
        if (matches(c, q)) {
          for (let a: ComposedNode | null = c; a && a !== root && !keep.has(a); a = a.parent) keep.add(a);
        }
        walk(c);
      }
    };
    walk(root);
    return keep;
  };

  const render = (): void => {
    ctx.rows.clear();
    ctx.nodes.clear();
    const root = ctx.data.root;
    if (!root) {
      ctx.tree.remove();
      ctx.host.append(ctx.empty);
      return;
    }
    ctx.empty.remove();
    ctx.host.append(ctx.tree);
    const scroll = ctx.tree.scrollTop;
    const frag = document.createDocumentFragment();
    if (ctx.query) {
      const keep = searchSet(root, ctx.query);
      if (keep.size === 0) frag.appendChild(el('div', 'stage-count', 'No results'));
      else renderChildren(root, 0, frag, keep);
    } else renderChildren(root, 0, frag, null);
    ctx.tree.replaceChildren(frag);
    ctx.tree.scrollTop = scroll;
  };
  ctx.render = render;

  /** Group of children painted right after the row (if it is expanded). */
  const groupOf = (r: HTMLElement): HTMLElement | null => {
    const g = r.nextElementSibling;
    return g instanceof HTMLElement && g.classList.contains('pb-group') ? g : null;
  };
  ctx.groupOf = groupOf;

  const paintToggle = (r: HTMLElement, open: boolean): void => {
    r.setAttribute('aria-expanded', String(open));
    const t = r.querySelector('.pb-toggle');
    if (t) t.textContent = open ? MINUS : PLUS;
  };

  /** Expands a painted row adding only its group of children. false if the row is not painted. */
  const openRow = (path: string): boolean => {
    const r = ctx.rows.get(path);
    const n = ctx.nodes.get(path);
    if (!r || !n) return false;
    ctx.expanded.add(path);
    if (n.children.length && !groupOf(r)) {
      const group = el('div', 'pb-group');
      group.setAttribute('role', 'group');
      renderChildren(n, Number(r.dataset.depth) + 1, group, null);
      r.after(group);
    }
    paintToggle(r, n.children.length > 0);
    return true;
  };
  ctx.openRow = openRow;

  /** Collapses a row: removes its group and forgets the rows it contained. */
  const closeRow = (path: string): void => {
    ctx.expanded.delete(path);
    const r = ctx.rows.get(path);
    if (!r) return;
    const g = groupOf(r);
    if (g) {
      for (const x of g.querySelectorAll<HTMLElement>('.stage-row')) {
        const p = x.dataset.path!;
        ctx.rows.delete(p);
        ctx.nodes.delete(p);
        if (p === ctx.selected) ctx.selected = null;
      }
      g.remove();
    }
    paintToggle(r, false);
  };

  const toggleOpen = (path: string): void => {
    if (ctx.query) return; // in a search everything that matches is already expanded
    if (ctx.expanded.has(path)) closeRow(path);
    else if (!openRow(path)) render();
  };
  ctx.toggleOpen = toggleOpen;

  const setSelected = (path: string | null): void => {
    if (ctx.selected) {
      const prev = ctx.rows.get(ctx.selected);
      prev?.classList.remove('selected');
      prev?.setAttribute('aria-selected', 'false');
    }
    ctx.selected = path;
    const cur = path ? ctx.rows.get(path) : undefined;
    cur?.classList.add('selected');
    cur?.setAttribute('aria-selected', 'true');
  };
  ctx.setSelected = setSelected;
}
