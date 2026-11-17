// Draggable splitter: changes the width (x axis) or height (y axis) of a neighboring panel.
import { svgIcon } from '../shell/icons';

export interface SplitterOptions {
  /** 'x': vertical splitter that changes the width; 'y': horizontal splitter that changes the height. */
  axis: 'x' | 'y';
  /** Panel whose size is adjusted (the one before the splitter). */
  target: HTMLElement;
  min: number;
  /** Maximum in px; if it is a function it is evaluated at the start of each drag (e.g. based on the container). */
  max: number | (() => number);
  /** Keyboard (arrow) step in px. */
  step?: number;
  /** The panel is after the splitter (right column): dragging left makes it larger. */
  after?: boolean;
  /** Collapses the panel: double click, click on the pill or release below `collapseBelow`. */
  onCollapse?: () => void;
  /** Snap threshold in px (default `min / 2`); only valid with `onCollapse`. */
  collapseBelow?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Sets the panel size in px (flex-basis, so it works inside a flex container). */
export function setPaneSize(target: HTMLElement, px: number): void {
  target.style.flex = `0 0 ${Math.round(px)}px`;
}

export function mountSplitter(handle: HTMLElement, o: SplitterOptions): void {
  const horizontal = o.axis === 'y';
  handle.classList.add('splitter', horizontal ? 'splitter-h' : 'splitter-v');
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', horizontal ? 'horizontal' : 'vertical');
  handle.tabIndex = 0;
  const maxOf = () => (typeof o.max === 'function' ? o.max() : o.max);
  const size = () => {
    const r = o.target.getBoundingClientRect();
    return horizontal ? r.height : r.width;
  };
  const sign = o.after ? -1 : 1;
  const coord = (e: PointerEvent) => sign * (horizontal ? e.clientY : e.clientX);

  const main = handle.closest('.ws-main');
  let start: { pos: number; size: number; max: number } | null = null;
  let requested = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { pos: coord(e), size: size(), max: maxOf() };
    requested = start.size;
    handle.classList.add('dragging');
    main?.classList.add('is-dragging');
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* no capture (e.g. in tests): it continues with the splitter's own events */
    }
  });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    requested = start.size + coord(e) - start.pos;
    setPaneSize(o.target, clamp(requested, o.min, start.max));
  });
  const end = () => {
    if (start && o.onCollapse && requested < (o.collapseBelow ?? o.min / 2)) {
      // On reopening the size from before the drag must come back, not the minimum it was clamped to.
      setPaneSize(o.target, start.size);
      o.onCollapse();
    }
    start = null;
    handle.classList.remove('dragging');
    main?.classList.remove('is-dragging');
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', (e) => {
    if (!o.onCollapse) return;
    e.preventDefault();
    o.onCollapse();
  });

  if (o.onCollapse) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'splitter-pill';
    pill.title = 'Collapse';
    pill.setAttribute('aria-label', 'Collapse');
    const icon = horizontal ? (o.after ? 'chevron-down' : 'chevron-up') : (o.after ? 'chevron-right' : 'chevron-left');
    pill.append(svgIcon(icon, 12));
    pill.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      o.onCollapse?.();
    });
    handle.append(pill);
  }

  handle.addEventListener('keydown', (e) => {
    const step = o.step ?? 16;
    const dec = horizontal ? 'ArrowUp' : o.after ? 'ArrowRight' : 'ArrowLeft';
    const inc = horizontal ? 'ArrowDown' : o.after ? 'ArrowLeft' : 'ArrowRight';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    setPaneSize(o.target, clamp(size() + (e.key === inc ? step : -step), o.min, maxOf()));
  });
}
