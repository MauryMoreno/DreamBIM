// @vitest-environment node
// Size budget of the web build. It runs against dist/ (npm run build:web) and is skipped when dist/ is missing.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ASSETS = join(__dirname, '..', 'dist', 'assets');
const BUDGET_KB = 850;

describe.skipIf(!existsSync(ASSETS))('bundle budget', () => {
  const chunks = existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith('.js') && !f.includes('.worker')) : [];

  it('no JavaScript chunk is bigger than the budget', () => {
    const big = chunks.map((f) => [f, Math.round(statSync(join(ASSETS, f)).size / 1000)] as const).filter(([, kb]) => kb > BUDGET_KB);
    expect(big.map(([f, kb]) => `${f}: ${kb} kB (budget ${BUDGET_KB} kB)`)).toEqual([]);
  });

  it('the 3D engine libraries have their own chunk', () => {
    expect(chunks.some((f) => f.startsWith('three-'))).toBe(true);
  });

  it('PDF and OCR code are loaded on demand, not in the entry chunk', () => {
    expect(chunks.some((f) => f.startsWith('pdf-'))).toBe(true);
    expect(chunks.some((f) => f.startsWith('ocr-'))).toBe(true);
  });
});
