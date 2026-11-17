import { PLUS, MINUS, el } from './helpers';
import type { ComposedNode } from '../../ifcx/types';
import { classCode, displayName } from '../../ifcx/names';
import type { StageContext } from './context';

export function installRows(ctx: StageContext): void {
  // --- Filas ---------------------------------------------------------------------------
  const row = (n: ComposedNode, depth: number, open: boolean, kids: boolean): HTMLElement => {
    const r = el('div', 'pb-node stage-row');
    r.setAttribute('role', 'treeitem');
    r.tabIndex = -1;
    r.dataset.path = n.path;
    r.dataset.origin = n.origin;
    r.style.setProperty('--depth', String(depth));
    r.dataset.depth = String(depth);
    r.setAttribute('aria-selected', String(n.path === ctx.selected));
    r.classList.toggle('selected', n.path === ctx.selected);
    r.classList.toggle('is-multi', ctx.multi.has(n.path));
    const toggle = el('span', 'pb-toggle', kids ? (open ? MINUS : PLUS) : '');
    if (kids) {
      r.classList.add('pb-branch');
      r.setAttribute('aria-expanded', String(open));
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        ctx.toggleOpen(n.path);
      });
    }
    const sw = el('span', 'layer-swatch');
    const color = ctx.data.colors.get(ctx.sourceFor(n));
    if (color) sw.style.setProperty('--layer-color', color);
    r.append(toggle, sw, el('span', 'pb-label', displayName(n)));
    const cls = classCode(n);
    if (cls) r.append(el('span', 'stage-class', cls.replace(/^Ifc/, '')));
    for (const m of ctx.data.marks.get(n.origin) ?? []) r.append(el('span', 'stage-mark', m));
    const eye = el('button', 'stage-eye');
    eye.type = 'button';
    eye.tabIndex = -1; // the tree is walked with the arrows
    ctx.paintEye(eye, ctx.hidden.has(n.path));
    eye.addEventListener('click', (e) => {
      e.stopPropagation(); // ocultar no selecciona
      ctx.toggleHidden(n.path);
    });
    eye.addEventListener('dblclick', (e) => e.stopPropagation());
    r.append(eye);
    r.classList.toggle('is-hidden', ctx.hidden.has(n.path));
    r.classList.toggle('in-hidden', ctx.underHidden(n));
    r.addEventListener('click', (e) => {
      ctx.setSelected(n.path);
      ctx.cb.onSelect(n.origin, n.path, e.ctrlKey || e.metaKey);
    });
    r.addEventListener('dblclick', () => ctx.cb.onFit?.(n.origin, n.path));
    r.draggable = true;
    r.addEventListener('dragstart', (e) => {
      ctx.dragging = n;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', n.path); // sin datos WebView2 no empieza el arrastre
        e.dataTransfer.effectAllowed = 'move';
      }
      r.classList.add('dragging');
    });
    r.addEventListener('dragend', () => {
      ctx.dragging = null;
      r.classList.remove('dragging');
      ctx.clearDrop();
    });
    ctx.rows.set(n.path, r);
    ctx.nodes.set(n.path, n);
    return r;
  };
  ctx.row = row;
}
