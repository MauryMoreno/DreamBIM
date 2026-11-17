import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { MODES } from '../src/modes/definition';
import { mountModeTabs } from '../src/modes/modetabs';
import { CHAPTERS } from '../src/tour/chapters';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every .ts of the app except the tour: where the elements the tour points at are created. */
function appSource(dir = SRC): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return e.name === 'tour' ? '' : appSource(p);
      return e.name.endsWith('.ts') ? readFileSync(p, 'utf8') : '';
    })
    .join('\n');
}

const source = appSource();
const steps = CHAPTERS.flatMap((c) => c.steps.map((s) => ({ chapter: c.id, step: s })));
const selectorsOf = (s: { target?: string | string[]; task?: { click?: string } }): string[] =>
  [...(s.target === undefined ? [] : typeof s.target === 'string' ? [s.target] : s.target), ...(s.task?.click ? [s.task.click] : [])];

/** Ids the workspace builds from a label: `ws-ctab-${label.toLowerCase()}`. */
function builtId(name: string): boolean {
  const m = /^ws-ctab-(\w+)$/.exec(name);
  if (!m) return false;
  const label = m[1][0].toUpperCase() + m[1].slice(1);
  return source.includes('`ws-ctab-${label.toLowerCase()}`') && source.includes(`'${label}'`);
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete document.body.dataset.screen;
});

describe('tour chapters', () => {
  it('has chapters with unique ids, and steps with unique ids and something to say', () => {
    expect(CHAPTERS.length).toBeGreaterThan(0);
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(CHAPTERS.length);
    for (const c of CHAPTERS) {
      expect(c.title && c.summary, c.id).toBeTruthy();
      expect(new Set(c.steps.map((s) => s.id)).size, c.id).toBe(c.steps.length);
      for (const s of c.steps) expect(s.title && s.text.length > 0 && s.text.every((t) => t.length > 0), `${c.id}/${s.id}`).toBe(true);
    }
  });

  it('only points at classes and ids that the app creates', () => {
    const missing: string[] = [];
    for (const { chapter, step } of steps) {
      for (const selector of selectorsOf(step)) {
        for (const m of selector.replace(/\[[^\]]*\]/g, '').matchAll(/[.#]([\w-]+)/g)) {
          const found = new RegExp(`(^|[^\\w-])${m[1]}([^\\w-]|$)`).test(source) || builtId(m[1]);
          if (!found) missing.push(`${chapter}/${step.id}: ${m[0]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('only points at button titles that the app uses', () => {
    const missing: string[] = [];
    for (const { chapter, step } of steps) {
      for (const selector of selectorsOf(step)) {
        for (const m of selector.matchAll(/\[title="([^"]+)"\]/g)) if (!source.includes(`'${m[1]}'`)) missing.push(`${chapter}/${step.id}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every selector is valid CSS', () => {
    for (const { step } of steps) for (const selector of selectorsOf(step)) expect(() => document.querySelector(selector), selector).not.toThrow();
  });

  it('chapters about the workspace start by opening a model, and only when none is open', () => {
    for (const c of CHAPTERS.filter((x) => x.id !== 'start')) expect(c.steps[0].id, c.id).toBe('open-model');
    const open = CHAPTERS[1].steps[0];
    expect(open.when!()).toBe(true);
    expect(open.task!.until!()).toBe(false);
    document.body.dataset.screen = 'workspace';
    expect(open.when!()).toBe(false);
    expect(open.task!.until!()).toBe(true);
  });

  it('the mode steps follow the real mode tabs', () => {
    const tabs = mountModeTabs(document.body, MODES, () => {});
    const tasks = CHAPTERS.find((c) => c.id === 'modes')!.steps.filter((s) => s.id.endsWith('-switch') || s.id === 'model-back');
    expect(tasks.length).toBe(MODES.length);
    for (const mode of MODES) {
      tabs.setActive(mode.id);
      const done = tasks.filter((s) => s.task!.until!());
      expect(done.length, mode.label).toBe(1);
      expect(done[0].task!.hint, mode.label).toContain(mode.label);
    }
  });

  it('the Layer step follows the selected tab', () => {
    const until = CHAPTERS.find((c) => c.id === 'layers')!.steps.find((s) => s.id === 'layer-tab')!.task!.until!;
    document.body.innerHTML = '<button id="ws-ctab-layer" aria-selected="false"></button>';
    expect(until()).toBe(false);
    document.getElementById('ws-ctab-layer')!.setAttribute('aria-selected', 'true');
    expect(until()).toBe(true);
  });

  it('the Assistant step follows its column being open', () => {
    const until = CHAPTERS.find((c) => c.id === 'more')!.steps.find((s) => s.id === 'assistant')!.task!.until!;
    document.body.dataset.screen = 'workspace';
    document.body.innerHTML = '<div class="ws-assistant is-collapsed"></div>';
    expect(until()).toBe(false);
    document.querySelector('.ws-assistant')!.classList.remove('is-collapsed');
    expect(until()).toBe(true);
  });
});
