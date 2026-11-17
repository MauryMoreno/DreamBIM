// Elevation ruler below the ViewCube: a vertical axis with one tick per meter (true scale) and each
// level at its exact elevation, with its name; hovering a level shows its elevation and a click selects it.
import type { LevelInfo } from '../render/levels';

/** Margin above the highest tick and below the lowest (px). */
const PAD = 10;
/** Height taken by the ruler's range (px); with few meters MAX_PX_PER_M decides. */
const SPAN = 150;
/** Maximum scale: with a short range the ruler does not stretch past this (px per meter). */
const MAX_PX_PER_M = 40;
/** Minimum gap between ruler numbers and between level names (px). */
const MIN_GAP = 14;
/** Minimum gap between unlabeled ticks (px). */
const MIN_TICK_GAP = 3;
/** "Round" ruler steps, in meters. */
const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

export interface ScaleLayout {
  /** Total ruler height (px). */
  height: number;
  /** Meter ticks from top to bottom; `label` is null on unlabeled ticks. */
  ticks: { meters: number; y: number; label: string | null }[];
  /** Levels from top to bottom: `y` is their position on the ruler; `labelY`, where their name goes. */
  items: { level: LevelInfo; y: number; labelY: number }[];
}

const stepFor = (pxPerM: number, minPx: number) => STEPS.find((s) => s * pxPerM >= minPx) ?? STEPS[STEPS.length - 1];
const multiple = (m: number, step: number) => ((m % step) + step) % step === 0;

/** `levels` arrives sorted bottom to top. */
export function layoutScale(levels: LevelInfo[]): ScaleLayout {
  if (!levels.length) return { height: 0, ticks: [], items: [] };
  const lo = Math.floor(levels[0].minZ);
  let hi = Math.ceil(levels[levels.length - 1].minZ);
  if (hi === lo) hi = lo + 1;
  const pxPerM = Math.min(MAX_PX_PER_M, SPAN / (hi - lo));
  const y = (z: number) => PAD + (hi - z) * pxPerM;

  const labelStep = stepFor(pxPerM, MIN_GAP);
  const tickStep = stepFor(pxPerM, MIN_TICK_GAP);
  const ticks: ScaleLayout['ticks'] = [];
  for (let m = hi; m >= lo; m--) {
    if (multiple(m, tickStep)) ticks.push({ meters: m, y: y(m), label: multiple(m, labelStep) ? String(m) : null });
  }

  const items: ScaleLayout['items'] = [];
  for (const level of [...levels].reverse()) {
    const prev = items[items.length - 1];
    const at = y(level.minZ);
    items.push({ level, y: at, labelY: prev ? Math.max(at, prev.labelY + MIN_GAP) : at });
  }
  const bottom = Math.max(y(lo), items[items.length - 1].labelY);
  return { height: bottom + PAD, ticks, items };
}

export interface LevelList {
  /** `levels` arrives sorted bottom to top; `highlighted` are the paths to highlight. */
  update(levels: LevelInfo[], highlighted: string[]): void;
}

export function mountLevelList(host: HTMLElement, onSelect?: (path: string) => void): LevelList {
  const list = document.createElement('ul');
  list.className = 'level-list';
  list.setAttribute('aria-label', 'Levels');
  list.hidden = true;
  host.append(list);
  list.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('.level-item')) e.stopPropagation(); // does not start the orbit
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('.level-item');
    if (item?.dataset.path) onSelect?.(item.dataset.path);
  });

  const span = (cls: string, text: string): HTMLElement => {
    const e = document.createElement('span');
    e.className = cls;
    e.textContent = text;
    return e;
  };

  return {
    update(levels, highlighted) {
      const on = new Set(highlighted);
      const layout = layoutScale(levels);
      const ticks = layout.ticks.map(({ y, label }) => {
        const li = document.createElement('li');
        li.className = label === null ? 'level-tick' : 'level-tick major';
        li.setAttribute('aria-hidden', 'true');
        li.style.top = `${y}px`;
        li.textContent = label ?? '';
        return li;
      });
      const rows = layout.items.map(({ level, y, labelY }) => {
        const exact = `${level.minZ.toFixed(3)} m`;
        const li = document.createElement('li');
        li.className = 'level-item';
        li.dataset.path = level.path;
        li.setAttribute('aria-label', `${level.name}: ${exact}`); // no title: the elevation already shows in its own bubble
        li.style.top = `${y}px`;
        li.classList.toggle('active', on.has(level.path));
        const name = span('level-item-name', level.name);
        if (labelY !== y) name.style.transform = `translateY(${labelY - y}px)`; // level very close to the one above
        li.append(name, span('level-item-z', exact));
        return li;
      });
      list.replaceChildren(...ticks, ...rows);
      list.style.height = `${layout.height}px`;
      list.hidden = levels.length === 0;
    },
  };
}
