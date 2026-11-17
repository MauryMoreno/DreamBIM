// Helpers for the convention ratchets (test/conventions.test.ts): file walking, line counts and a
// small heuristic that tells Spanish prose from English prose in comments and test titles.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDIO = fileURLToPath(new URL('../../', import.meta.url));

const SKIPPED_DIRS = new Set(['node_modules', 'target', 'gen', 'dist', 'builtbot', 'public', 'schemas']);

/** Every file under `dir` (relative to studio/), skipping build output and vendored folders. */
export function walk(dir: string): string[] {
  const abs = join(STUDIO, dir);
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIPPED_DIRS.has(e.name) ? [] : walk(join(dir, e.name));
    return [join(dir, e.name).split(sep).join('/')];
  });
}

export const read = (file: string): string => readFileSync(join(STUDIO, file), 'utf8');

export const lineCount = (file: string): number => read(file).split('\n').length - (read(file).endsWith('\n') ? 1 : 0);

/** Source files subject to the size rule: .ts under src/ and .rs under src-tauri/src/. */
export function sourceFiles(): string[] {
  return [...walk('src').filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')), ...walk('src-tauri/src').filter((f) => f.endsWith('.rs'))];
}

/** Files whose comments and test titles must be English. */
export function proseFiles(): string[] {
  const exts = ['.ts', '.css', '.mjs', '.rs'];
  return ['src', 'test', 'scripts', 'src-tauri/src'].flatMap(walk).filter((f) => exts.some((x) => f.endsWith(x)));
}

const ACCENTS = /[áéíóúñ¿¡]/;
const STOPWORDS = new Set(['que', 'para', 'los', 'las', 'una', 'del', 'por', 'cada', 'cuando', 'pero', 'esto', 'como', 'hay']);

/** Does this prose look Spanish: an accented letter, or two different Spanish function words. */
export function looksSpanish(text: string): boolean {
  if (ACCENTS.test(text)) return true;
  const found = new Set((text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => STOPWORDS.has(w)));
  return found.size >= 2;
}

const FULL_COMMENT = /^\s*(\/\/|\/\*|\*)/;
const TRAILING_COMMENT = /\s\/\/ (.*)$/;
const TEST_TITLE = /^\s*(?:it|describe|test)(?:\.\w+)?\(\s*(['"`])(.*)$/;

/** The Spanish comment lines and test titles of a file, as `line: text` (empty when it is clean). */
export function spanishProse(file: string): string[] {
  const out: string[] = [];
  read(file).split('\n').forEach((line, i) => {
    const comment = FULL_COMMENT.test(line) ? line : TRAILING_COMMENT.exec(line)?.[1];
    const title = TEST_TITLE.exec(line)?.[2];
    if (comment && looksSpanish(comment)) out.push(`${i + 1}: ${comment.trim()}`);
    else if (title && looksSpanish(title)) out.push(`${i + 1}: ${title.trim()}`);
  });
  return out;
}

