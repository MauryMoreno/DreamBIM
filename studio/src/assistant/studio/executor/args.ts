import type { ElementColor } from '../../../render/coloroverride';
import { Args } from './types';

export const TEXT_CHARS = 200;

export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export class CommandError extends Error {}

export const fail = (message: string): never => {
  throw new CommandError(message);
};

export const cut = (s: string): string => (s.length > TEXT_CHARS ? `${s.slice(0, TEXT_CHARS)}…` : s);

export const plain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// --- Argumentos --------------------------------------------------------------------------------
export function optString(cmd: string, a: Args, key: string): string | undefined {
  const v = a[key];
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : fail(`${cmd}: '${key}' must be string`);
}

export function reqString(cmd: string, a: Args, key: string): string {
  return optString(cmd, a, key) ?? fail(`${cmd}: '${key}' must be string`);
}

export function reqBool(cmd: string, a: Args, key: string): boolean {
  return typeof a[key] === 'boolean' ? (a[key] as boolean) : fail(`${cmd}: '${key}' must be boolean`);
}

export function optInt(cmd: string, a: Args, key: string, { default: d, max }: { default: number; max: number }): number {
  const v = a[key];
  if (v === undefined) return d;
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${cmd}: '${key}' must be number`);
  return Math.min(max, Math.max(1, Math.floor(v)));
}

/** Color `#rrggbb` (lowercase) and opacity in [0, 1] (1 if missing). */
export function colorArgs(cmd: string, a: Args, color: unknown = a.color): ElementColor {
  if (typeof color !== 'string' || !COLOR_RE.test(color)) return fail(`${cmd}: 'color' must be '#rrggbb'`);
  const o = a.opacity ?? 1;
  if (typeof o !== 'number' || !(o >= 0 && o <= 1)) return fail(`${cmd}: 'opacity' must be a number between 0 and 1`);
  return { color: color.toLowerCase(), opacity: o };
}
