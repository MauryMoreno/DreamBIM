// Viewer colors in Costs mode. Numbers so as not to have color literals in strings (css-tokens.test.ts).
import { LAYER_COLORS } from '../composer/stack';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Rampa secuencial de 5 pasos, de barato a caro. */
export const COST_RAMP: string[] = [0xfee8c8, 0xfdbb84, 0xfc8d59, 0xe34a33, 0xb30000].map(hex);

/** Color of the BOQ item number `index`. */
export const itemColor = (index: number): string => LAYER_COLORS[index % LAYER_COLORS.length];

/** Step of the ramp by quantile: `sorted` are all the costs, from lowest to highest. The minimum gives the first and the maximum the last. */
export function rampColor(value: number, sorted: number[]): string {
  if (sorted.length < 2) return COST_RAMP[COST_RAMP.length - 1];
  let first = 0;
  while (first < sorted.length - 1 && sorted[first] < value) first++;
  const step = Math.floor((first / (sorted.length - 1)) * COST_RAMP.length);
  return COST_RAMP[Math.min(COST_RAMP.length - 1, step)];
}
