import type { ComposedNode } from '../../ifcx/types';
import { svgIcon } from '../../shell/icons';
import type { StageContext } from './context';

export function installState(ctx: StageContext): void {
  ctx.data = { root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() };

  /** Node of each path of the model (the one that is expanded on reveal). */
  ctx.byPath = new Map<string, ComposedNode>();

  const expanded = new Set<string>();
  ctx.expanded = expanded;

  /** Ya se desplegaron los primeros niveles de este modelo (plegarlo todo no los vuelve a abrir). */
  ctx.seeded = false;

  ctx.selected = null;

  ctx.query = '';

  const rows = new Map<string, HTMLElement>();
  ctx.rows = rows;

  /** Paths of the multiple selection: they are repainted with the tree. */
  ctx.multi = new Set<string>();

  /** Node of each painted row, by path. */
  const nodes = new Map<string, ComposedNode>();
  ctx.nodes = nodes;

  /** Paths hidden with the eye; they survive a recomposition while the path exists. */
  const hidden = new Set<string>();
  ctx.hidden = hidden;

  /** Is it hidden by an ancestor? (the row is dimmed, but its eye keeps its own state) */
  const underHidden = (n: ComposedNode): boolean => {
    for (let a = n.parent; a; a = a.parent) if (hidden.has(a.path)) return true;
    return false;
  };
  ctx.underHidden = underHidden;

  const paintEye = (b: HTMLButtonElement, off: boolean): void => {
    if (b.firstChild && b.getAttribute('aria-pressed') === String(off)) return;
    b.replaceChildren(svgIcon(off ? 'eyeOff' : 'eye', 14));
    b.setAttribute('aria-pressed', String(off));
    b.setAttribute('aria-label', off ? 'Show' : 'Hide');
    b.title = off ? 'Show' : 'Hide';
  };
  ctx.paintEye = paintEye;

  const toggleHidden = (path: string): void => {
    if (hidden.has(path)) hidden.delete(path);
    else hidden.add(path);
    // only the row and its painted descendants change: the tree is not rebuilt
    const below = path + '/';
    for (const [p, r] of rows) {
      if (p !== path && !p.startsWith(below)) continue;
      const n = nodes.get(p)!;
      r.classList.toggle('is-hidden', hidden.has(p));
      r.classList.toggle('in-hidden', underHidden(n));
      const b = r.querySelector<HTMLButtonElement>('.stage-eye');
      if (b) paintEye(b, hidden.has(p));
    }
    ctx.cb.onHiddenChange?.(new Set(hidden));
  };
  ctx.toggleHidden = toggleHidden;

  /**
   * Origin layer of a node: its own, if not that of the nearest ancestor that has one (e.g. what
   * arrives through an import of the document); with none, the document.
   */
  const sourceFor = (n: ComposedNode): string => {
    for (let a: ComposedNode | null = n; a; a = a.parent) {
      const s = ctx.data.sourceOf.get(a.origin);
      if (s) return s;
    }
    return 'document';
  };
  ctx.sourceFor = sourceFor;
}
