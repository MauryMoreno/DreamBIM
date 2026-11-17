import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const TOKENS = join(SRC, 'styles/tokens.css');

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = (p: string) => stripComments(readFileSync(p, 'utf8'));

/** Bodies of the innermost `{ ... }` rules (the declarations), without selectors. */
function declarationBodies(css: string): string[] {
  return [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/;

/** Variables that do not depend on the theme (typography, measures and colors equal in light and dark). */
const THEME_INVARIANT = [
  '--font',
  '--font-size',
  '--titlebar-height',
  '--radius',
  '--titlebar-close-hover', // rojo de «cerrar» igual en ambos temas
  '--titlebar-close-fg',
  '--brand', // brand icon over the title bar, which is dark in both themes
  '--focus-on-dark',
  '--thumb-bg', // the thumbnails of recents stay as they are
  '--cube-shade', // dark veil of the ViewCube faces (opacity computed in viewcube.ts)
  '--cube-ring', // grey ring of the compass: visible on a light and dark background
  '--cube-face-bg', // the faces use the grey of the ring
  '--axis-x', // axis bars of the Move box: the same tones as the gizmo in both themes
  '--axis-y',
  '--axis-z',
  '--axis-fg',
  '--cube-face-border',
  '--cube-face-fg',
  '--cube-compass-fg',
  '--cube-compass-hover-fg',
];

function tokenBlocks() {
  const css = read(TOKENS);
  const block = (re: RegExp) => {
    const m = re.exec(css);
    expect(m, String(re)).not.toBeNull();
    return new Map([...m![1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  };
  return {
    light: block(/:root\s*\{([^}]*)\}/),
    dark: block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/),
  };
}

const otherCss = walk(SRC, '.css').filter((p) => p !== TOKENS);

describe('tokens de color', () => {
  it('there is CSS to review', () => {
    expect(otherCss.length).toBeGreaterThanOrEqual(6);
  });

  it('no CSS except tokens.css has color literals (#hex, rgb, rgba, hsl)', () => {
    const offenders: string[] = [];
    for (const p of otherCss) {
      for (const body of declarationBodies(read(p))) {
        for (const line of body.split(';')) if (COLOR_LITERAL.test(line)) offenders.push(`${relative(SRC, p)}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no .ts in src has color literals in strings (#hex, rgb(...))', () => {
    const offenders: string[] = [];
    for (const p of walk(SRC, '.ts')) {
      const src = readFileSync(p, 'utf8');
      const m = /(['"`])[^'"`\n]*(?:#[0-9a-fA-F]{3,8}\b|\brgba?\()[^'"`\n]*\1/.exec(src);
      if (m) offenders.push(`${relative(SRC, p)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every var(--x) used in the CSS files is defined in the light theme', () => {
    const { light } = tokenBlocks();
    const missing: string[] = [];
    // those that carry a fallback value (var(--depth, 0), var(--shade, 0)) are set by the code on each element
    for (const p of otherCss) {
      for (const m of read(p).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) if (!light.has(m[1])) missing.push(`${relative(SRC, p)}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it('every token of the light theme has a dark pair, except the listed invariants', () => {
    const { light, dark } = tokenBlocks();
    const unpaired = [...light.keys()].filter((k) => !dark.has(k) && !THEME_INVARIANT.includes(k));
    expect(unpaired).toEqual([]);
    const stale = THEME_INVARIANT.filter((k) => !light.has(k) || dark.has(k));
    expect(stale, 'la lista de invariantes debe ser exacta').toEqual([]);
    const orphans = [...dark.keys()].filter((k) => !light.has(k));
    expect(orphans).toEqual([]);
  });

  it('all the defined tokens are used in some CSS', () => {
    const { light } = tokenBlocks();
    const used = new Set(otherCss.flatMap((p) => [...read(p).matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])));
    const tokensCss = read(TOKENS);
    for (const m of tokensCss.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]); // tokens definidos con otros tokens
    expect([...light.keys()].filter((k) => !used.has(k))).toEqual([]);
  });
});

// --- Contrast (WCAG 2.x) of the text/background pairs, in each theme -------------------------------
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [text, background]: pairs painted together with normal text; minimum AA 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ['--text', '--app-bg'],
  ['--text', '--panel-bg'],
  ['--text', '--panel-header-bg'],
  ['--text', '--ribbon-bg'],
  ['--text', '--card-bg'],
  ['--text', '--input-bg'],
  ['--text', '--selection'],
  ['--text', '--hover-bg'],
  ['--text', '--tab-bg'],
  ['--text', '--tab-active-bg'],
  ['--text', '--tab-hover-bg'],
  ['--text', '--accent-hover-bg'],
  ['--text-muted', '--app-bg'],
  ['--text-muted', '--panel-bg'],
  ['--text-muted', '--panel-header-bg'],
  ['--text-muted', '--ribbon-bg'],
  ['--text-muted', '--card-bg'],
  ['--text-muted', '--input-bg'],
  ['--text-muted', '--chip-bg'],
  ['--link', '--panel-bg'], // "Show more" and expanders on hover
  ['--link', '--card-bg'],
  ['--accent-fg', '--accent-solid'],
  ['--accent-fg', '--accent-solid-hover'],
  ['--titlebar-fg', '--titlebar-bg'],
  ['--titlebar-fg', '--titlebar-hover'],
  ['--titlebar-close-fg', '--titlebar-close-hover'],
  ['--home-side-fg', '--home-side-bg'],
  ['--home-side-fg', '--home-side-hover'],
  ['--home-side-muted', '--home-side-bg'],
  ['--toast-fg', '--toast-bg'],
  ['--level-label-fg', '--level-label-bg'], // etiquetas de nivel en 3D
  ['--accent', '--level-label-bg'], // la etiqueta del nivel seleccionado
  ['--error-fg', '--error-bg'],
  ['--error-fg', '--card-missing-bg'],
];

/** Light theme pairs that were already below 4.5:1 before dark mode (the light one does not change). */
const LIGHT_LEGACY = ['--text-muted/--panel-header-bg'];

describe('contraste AA de los tokens de texto', () => {
  const { light, dark } = tokenBlocks();
  for (const [name, theme] of [['claro', (k: string) => light.get(k)], ['oscuro', (k: string) => dark.get(k) ?? light.get(k)]] as const) {
    it(`tema ${name}: todos los pares cumplen 4.5:1`, () => {
      const bad: string[] = [];
      for (const [fg, bg] of TEXT_PAIRS) {
        if (name === 'claro' && LIGHT_LEGACY.includes(`${fg}/${bg}`)) continue;
        const [f, b] = [theme(fg), theme(bg)];
        if (!f || !b || !/^#[0-9a-f]{6}$/i.test(f) || !/^#[0-9a-f]{6}$/i.test(b)) {
          bad.push(`${fg}/${bg}: valor no hexadecimal o ausente (${f} / ${b})`);
          continue;
        }
        const r = contrast(f, b);
        if (r < 4.5) bad.push(`${fg} ${f} sobre ${bg} ${b}: ${r.toFixed(2)}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
