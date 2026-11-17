// @vitest-environment node
// Dependency rules between layers (see the architecture section of the README):
//   ifcx/     IFCx core: plain TypeScript, no three.js and no other layer
//   render/   3D engine: only ifcx/ and three.js
//   shell/    shell (screens, title bar, dialogs): no features
//   modeling/ pure model domain: no UI, no three.js, no workspace or render
//   app/      composition root: nobody imports it except main.ts
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Layer of a path under src/ (its first folder, or '.' for main.ts). */
const layer = (abs: string) => {
  const parts = relative(SRC, abs).split(sep);
  return parts.length > 1 ? parts[0] : '.';
};

interface Edge {
  from: string;
  /** Target layer, or the package name when the import is not relative. */
  to: string;
  spec: string;
}

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const f of files(SRC)) {
    const text = readFileSync(f, 'utf8');
    const specs = [
      ...text.matchAll(/^\s*import\b[^'"]*?['"]([^'"]+)['"]/gm),
      ...text.matchAll(/^\s*export\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm),
      ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const from = relative(SRC, f).split(sep).join('/');
      if (!spec.startsWith('.')) {
        out.push({ from, to: spec.split('/')[0], spec });
        continue;
      }
      const target = resolve(dirname(f), spec);
      out.push({ from, to: target.startsWith(SRC) ? layer(target) : '<outside>', spec });
    }
  }
  return out;
}

const all = edges();
const bad = (pred: (e: Edge) => boolean) => all.filter(pred).map((e) => `${e.from} -> ${e.spec}`);

describe('architecture', () => {
  it('reads the imports (otherwise the rules would pass without looking at anything)', () => {
    expect(all.some((e) => e.from === 'main.ts' && e.to === 'app')).toBe(true);
    expect(all.some((e) => e.from === 'render/viewer.ts' && e.to === 'ifcx')).toBe(true);
    expect(all.some((e) => e.from === 'render/viewer.ts' && e.to === 'three')).toBe(true);
  });

  it('nothing imports from outside src/ (studio does not depend on other folders of the repo)', () => {
    expect(bad((e) => e.to === '<outside>' || e.to.startsWith('@viewer'))).toEqual([]);
  });

  it('ifcx/ only depends on itself', () => {
    expect(bad((e) => e.from.startsWith('ifcx/') && e.to !== 'ifcx')).toEqual([]);
  });

  it('render/ only depends on ifcx/ and three.js', () => {
    const ok = new Set(['render', 'ifcx', 'three', 'three-mesh-bvh']);
    expect(bad((e) => e.from.startsWith('render/') && !ok.has(e.to))).toEqual([]);
  });

  it('shell/ does not depend on the features', () => {
    const ok = new Set(['shell', 'render', 'ifcx', 'platform']);
    expect(bad((e) => e.from.startsWith('shell/') && e.spec.startsWith('.') && !ok.has(e.to))).toEqual([]);
  });

  it('modeling/ stays free of UI, rendering and three.js', () => {
    const forbidden = new Set(['workspace', 'render', 'shell', 'app', 'three', 'three-mesh-bvh']);
    // Known exceptions, to be removed: levels.ts and
    // walltool.ts still reach into render/ and three.js.
    const exempt = new Set(['modeling/levels.ts', 'modeling/walltool.ts']);
    expect(bad((e) => e.from.startsWith('modeling/') && !exempt.has(e.from) && forbidden.has(e.to))).toEqual([]);
  });

  it('outside document/, only its facade, its types and its move helpers are imported', () => {
    expect(bad((e) => !e.from.startsWith('document/') && e.to === 'document' && !/\/(controller|types|move-target)$/.test(e.spec))).toEqual([]);
  });

  it('platform/ only depends on itself and on packages', () => {
    expect(bad((e) => e.from.startsWith('platform/') && e.spec.startsWith('.') && e.to !== 'platform')).toEqual([]);
  });

  it('only main.ts imports app/', () => {
    expect(bad((e) => e.to === 'app' && !e.from.startsWith('app/') && e.from !== 'main.ts')).toEqual([]);
  });
});
