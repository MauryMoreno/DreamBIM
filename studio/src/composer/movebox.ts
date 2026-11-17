// Transform box, at the foot of the right column: position of the origin of the element in the world (X/Y/Z),
// desplazamiento (ΔX/ΔY/ΔZ), giro en grados y escala. Enter confirma; un Δ vuelve a 0.00 tras confirmar.
import { parseLength } from '../properties/studio';
import { toast } from '../shell/toast';
import type { Vec3 } from './xform';

export type Axes = { x: boolean; y: boolean; z: boolean };

export interface MoveBox {
  /** Sin `rot`/`scale` (o sin sus ejes) esas filas quedan desactivadas. */
  show(
    t: { title: string; pos: Vec3; axes: Axes; rot?: Vec3; rotAxes?: Axes; scale?: Vec3; scaleAxes?: Axes } | null,
  ): void;
  /** Shows a provisional position (e.g. while dragging) without confirming anything. */
  preview(pos: Vec3): void;
}

export interface MoveBoxCallbacks {
  moveTo(p: Vec3): void;
  moveBy(d: Vec3): void;
  /** Giro absoluto en grados (Euler XYZ). */
  rotateTo?(r: Vec3): void;
  /** Escala absoluta por eje. */
  scaleTo?(s: Vec3): void;
}

/** The same text as the Properties notice for an invalid number. */
const BAD_NUMBER = 'Enter a valid number';
const BAD_SCALE = 'Scale cannot be 0';
const ZERO = '0.00';
const NONE: Axes = { x: false, y: false, z: false };

/** `d` decimales; nunca "-0.00". */
const fixed = (d: number) => (v: number): string => {
  const s = v.toFixed(d);
  return Number(s) === 0 ? s.replace('-', '') : s;
};
/** Metros y grados con dos decimales; la escala con tres. */
const fmt = fixed(2);
const fmtScale = fixed(3);

/** Number without units (degrees or factor): it accepts a decimal comma and the ° sign. */
const parsePlain = (text: string): number | null => {
  const t = text.trim().replace(/°$/, '').replace(',', '.');
  const v = t === '' ? NaN : Number(t);
  return Number.isFinite(v) ? v : null;
};

const AXES = ['x', 'y', 'z'] as const;
const ROWS = ['Position', 'Offset', 'Rotation', 'Scale'] as const;

export function mountMoveBox(host: HTMLElement, cb: MoveBoxCallbacks): MoveBox {
  const root = document.createElement('section');
  root.className = 'movebox';
  root.setAttribute('aria-label', 'Transform');
  root.hidden = true;
  // collapsible header, like the sections of Properties
  const title = document.createElement('header');
  title.className = 'movebox-title';
  title.tabIndex = 0;
  title.setAttribute('role', 'button');
  title.setAttribute('aria-expanded', 'true');
  const subject = document.createElement('span');
  subject.className = 'movebox-name';
  title.append('Transform', subject);
  const toggle = () => {
    const open = root.classList.toggle('is-collapsed') === false;
    title.setAttribute('aria-expanded', String(open));
  };
  title.addEventListener('click', toggle);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  // row labels on the left; one column per axis with its color bar
  const grid = document.createElement('div');
  grid.className = 'movebox-grid';
  const rows = document.createElement('div');
  rows.className = 'movebox-rows';
  for (const h of ROWS) {
    const c = document.createElement('div');
    c.className = 'movebox-rowhead';
    c.textContent = h;
    rows.append(c);
  }
  grid.append(rows);
  root.append(title, grid);
  host.append(root);

  /** What is shown (the last of show or preview). */
  let pos: Vec3 = [0, 0, 0];
  let rot: Vec3 = [0, 0, 0];
  let scale: Vec3 = [1, 1, 1];

  const input = (
    stack: HTMLElement,
    label: string,
    parse: (text: string) => number | null,
    value: () => string,
    commit: (v: number) => void,
  ): HTMLInputElement => {
    const i = document.createElement('input');
    i.className = 'movebox-input';
    i.type = 'text';
    i.spellcheck = false;
    i.title = label;
    i.setAttribute('aria-label', label);
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = parse(i.value);
        i.value = value(); // el valor confirmado llega con el modelo recompuesto
        if (v === null) return toast(BAD_NUMBER, 'error');
        commit(v);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); // no deselecciona el elemento
        i.value = value();
      }
    });
    stack.append(i);
    return i;
  };

  /** `base` con el eje `k` cambiado a `v`. */
  const withAxis = (base: Vec3, k: number, v: number): Vec3 => {
    const r: Vec3 = [...base];
    r[k] = v;
    return r;
  };

  // one column per axis: X, ΔX, rotation and scale from top to bottom
  const abs: HTMLInputElement[] = [];
  const rel: HTMLInputElement[] = [];
  const rots: HTMLInputElement[] = [];
  const scales: HTMLInputElement[] = [];
  const groups: HTMLElement[] = [];
  AXES.forEach((a, k) => {
    const name = a.toUpperCase();
    const group = document.createElement('div');
    group.className = `movebox-axisgroup movebox-${a}`;
    const bar = document.createElement('span');
    bar.className = 'movebox-bar';
    bar.textContent = name;
    bar.setAttribute('aria-hidden', 'true');
    const stack = document.createElement('div');
    stack.className = 'movebox-stack';
    group.append(bar, stack);
    grid.append(group);
    groups.push(group);
    abs.push(input(stack, name, parseLength, () => fmt(pos[k]), (v) => cb.moveTo(withAxis(pos, k, v))));
    rel.push(
      input(stack, `Δ${name}`, parseLength, () => ZERO, (v) => {
        if (v !== 0) cb.moveBy(withAxis([0, 0, 0], k, v));
      }),
    );
    rots.push(input(stack, `Rotation ${name}`, parsePlain, () => fmt(rot[k]), (v) => cb.rotateTo?.(withAxis(rot, k, v))));
    scales.push(
      input(stack, `Scale ${name}`, parsePlain, () => fmtScale(scale[k]), (v) => {
        if (v === 0) return toast(BAD_SCALE, 'error');
        cb.scaleTo?.(withAxis(scale, k, v));
      }),
    );
  });

  const paint = () => abs.forEach((i, k) => (i.value = fmt(pos[k])));

  return {
    show(t) {
      root.hidden = !t;
      if (!t) return;
      subject.textContent = ` · ${t.title}`;
      title.title = t.title;
      pos = [...t.pos];
      rot = [...(t.rot ?? [0, 0, 0])];
      scale = [...(t.scale ?? [1, 1, 1])];
      paint();
      const rotAxes = t.rot && cb.rotateTo ? (t.rotAxes ?? NONE) : NONE;
      const scaleAxes = t.scale && cb.scaleTo ? (t.scaleAxes ?? NONE) : NONE;
      AXES.forEach((a, k) => {
        abs[k].disabled = !t.axes[a];
        rel[k].disabled = !t.axes[a];
        rel[k].value = ZERO;
        rots[k].disabled = !rotAxes[a];
        rots[k].value = fmt(rot[k]);
        scales[k].disabled = !scaleAxes[a];
        scales[k].value = fmtScale(scale[k]);
        groups[k].classList.toggle('is-disabled', !t.axes[a] && !rotAxes[a] && !scaleAxes[a]);
      });
    },
    preview(p) {
      pos = [...p];
      paint();
    },
  };
}
