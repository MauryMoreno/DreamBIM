// @vitest-environment node
// Conventions of the code base: no source file over 400 lines, and comments and test titles in English.
import { describe, expect, it } from 'vitest';
import { lineCount, proseFiles, sourceFiles, spanishProse } from './support/conventions';

const MAX_LINES = 400;

describe('conventions', () => {
  it('no source file exceeds 400 lines', () => {
    const tooBig = sourceFiles().map((f) => [f, lineCount(f)] as const).filter(([, lines]) => lines > MAX_LINES);
    expect(tooBig.map(([f, lines]) => `${f}: ${lines} lines (limit ${MAX_LINES})`)).toEqual([]);
  });

  it('comments and test titles are English', () => {
    const bad = proseFiles().flatMap((f) => spanishProse(f).slice(0, 2).map((l) => `${f}:${l}`));
    expect(bad).toEqual([]);
  });
});
