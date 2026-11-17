import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TourChapter } from '../src/tour/chapters';
import { loadProgress, markDone, markOffered, TOUR_STORAGE_KEY } from '../src/tour/progress';
import { offerTourOnce, openTour } from '../src/tour/tour';

const CHAPTERS: TourChapter[] = [
  { id: 'one', title: 'One', summary: 'First.', steps: [{ id: 'a', title: 'A', text: ['a'] }] },
  { id: 'two', title: 'Two', summary: 'Second.', steps: [{ id: 'b', title: 'B', text: ['b'] }] },
];
const OPTS = { chapters: CHAPTERS, engine: { rectOf: () => ({ left: 0, top: 0, width: 10, height: 10 }) } };

const menu = () => document.querySelector<HTMLElement>('.tour-menu');
const card = () => document.querySelector<HTMLElement>('.tour-card');
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;
const chapterButton = (title: string) =>
  [...menu()!.querySelectorAll<HTMLButtonElement>('.tour-chapter')].find((b) => b.querySelector('.tour-chapter-title')!.textContent === title)!;
/** Lets the awaits between the list and the engine run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

afterEach(async () => {
  if (card()) button(card()!, 'Skip tour').click();
  await settle();
  if (menu()) button(menu()!, 'Close').click();
  await settle();
});

describe('tour progress', () => {
  it('starts empty, and survives broken or foreign data', () => {
    expect(loadProgress()).toEqual({ offered: false, done: [] });
    localStorage.setItem(TOUR_STORAGE_KEY, '{not json');
    expect(loadProgress()).toEqual({ offered: false, done: [] });
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ offered: 'yes', done: ['a', 3] }));
    expect(loadProgress()).toEqual({ offered: false, done: ['a'] });
  });

  it('remembers the offer and each finished chapter once', () => {
    markOffered();
    markDone('one');
    markDone('one');
    markDone('two');
    expect(loadProgress()).toEqual({ offered: true, done: ['one', 'two'] });
  });
});

describe('openTour', () => {
  it('lists the chapters in a modal dialog', () => {
    void openTour(OPTS);
    expect(menu()!.getAttribute('aria-modal')).toBe('true');
    expect(menu()!.textContent).toContain('Dream BIM tour');
    expect([...menu()!.querySelectorAll('.tour-chapter-title')].map((t) => t.textContent)).toEqual(['One', 'Two']);
    expect(document.activeElement).toBe(button(menu()!, 'Start the tour'));
  });

  it('runs the chosen chapter, remembers it when finished and comes back to the list', async () => {
    void openTour(OPTS);
    chapterButton('Two').click();
    await settle();
    expect(menu()).toBeNull();
    expect(card()!.querySelector('.tour-title')!.textContent).toBe('B');
    button(card()!, 'Finish').click();
    await settle();
    expect(loadProgress().done).toEqual(['two']);
    expect(chapterButton('Two').classList.contains('tour-chapter-done')).toBe(true);
    expect(chapterButton('One').classList.contains('tour-chapter-done')).toBe(false);
  });

  it('the main button goes to the first chapter that is not finished', async () => {
    markDone('one');
    void openTour(OPTS);
    button(menu()!, 'Continue').click();
    await settle();
    expect(card()!.querySelector('.tour-title')!.textContent).toBe('B');
  });

  it('offers to start over once every chapter is finished', async () => {
    markDone('one');
    markDone('two');
    void openTour(OPTS);
    expect(menu()!.textContent).toContain('You finished every chapter');
    button(menu()!, 'Start over').click();
    await settle();
    expect(card()!.querySelector('.tour-title')!.textContent).toBe('A');
  });

  it('a chapter left halfway is not remembered and the list does not come back', async () => {
    const p = openTour(OPTS);
    chapterButton('One').click();
    await settle();
    button(card()!, 'Skip tour').click();
    await p;
    expect(loadProgress().done).toEqual([]);
    expect(menu()).toBeNull();
  });

  it('Esc closes the list without reaching the app', async () => {
    let reached = false;
    const spy = () => (reached = true);
    window.addEventListener('keydown', spy);
    const p = openTour(OPTS);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await p;
    window.removeEventListener('keydown', spy);
    expect(menu()).toBeNull();
    expect(reached).toBe(false);
  });

  it('does not open twice', () => {
    void openTour(OPTS);
    void openTour(OPTS);
    expect(document.querySelectorAll('.tour-menu').length).toBe(1);
  });
});

describe('offerTourOnce', () => {
  it('greets the first time and stays quiet afterwards', async () => {
    offerTourOnce(OPTS);
    expect(menu()!.textContent).toContain('Welcome to Dream BIM');
    expect(loadProgress().offered).toBe(true);
    button(menu()!, 'Not now').click();
    await settle();
    offerTourOnce(OPTS);
    expect(menu()).toBeNull();
  });
});
