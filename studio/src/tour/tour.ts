// Entry to the tour: a list of chapters to pick from, which comes back after each finished chapter.
import { CHAPTERS, type TourChapter } from './chapters';
import { runTour, tourRunning, type TourOptions } from './engine';
import { loadProgress, markDone, markOffered } from './progress';

export interface OpenTourOptions {
  /** First run: greets instead of just listing. */
  welcome?: boolean;
  chapters?: readonly TourChapter[];
  /** Passed on to the engine (tests shorten its timers). */
  engine?: Partial<TourOptions>;
}

let open = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The chapter list as a modal dialog. Resolves with the chosen chapter, or null when it is closed. */
function pickChapter(chapters: readonly TourChapter[], welcome: boolean): Promise<TourChapter | null> {
  const done = new Set(loadProgress().done);
  const pending = chapters.find((c) => !done.has(c.id));
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal tour-menu');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'tour-menu-title');
  const title = el('div', 'modal-title', welcome ? 'Welcome to Dream BIM' : 'Dream BIM tour');
  title.id = 'tour-menu-title';
  const intro = el(
    'p',
    'tour-menu-intro',
    !pending ? 'You finished every chapter. Pick one to see it again.'
    : welcome ? 'New here? A short guided tour shows you around the real app. Each chapter takes a couple of minutes.'
    : 'Pick a chapter. Each one takes a couple of minutes.',
  );
  const list = el('div', 'tour-menu-list');
  const row = el('div', 'modal-buttons');
  const later = el('button', 'modal-btn', welcome ? 'Not now' : 'Close');
  later.type = 'button';
  const start = el('button', 'modal-btn modal-btn-primary', !pending ? 'Start over' : done.size ? 'Continue' : 'Start the tour');
  start.type = 'button';
  row.append(later, start);
  box.append(title, intro, list, row);
  scrim.append(box);

  return new Promise((resolve) => {
    const finish = (c: TourChapter | null): void => {
      scrim.remove();
      if (!c && previous?.isConnected) previous.focus();
      resolve(c);
    };
    chapters.forEach((c, i) => {
      const b = el('button', 'tour-chapter');
      b.type = 'button';
      const mark = el('span', 'tour-chapter-mark', done.has(c.id) ? '✓' : String(i + 1));
      if (done.has(c.id)) {
        b.classList.add('tour-chapter-done');
        mark.setAttribute('aria-label', 'Finished');
      }
      const words = el('span', 'tour-chapter-words');
      words.append(el('span', 'tour-chapter-title', c.title), el('span', 'tour-chapter-summary', c.summary));
      b.append(mark, words);
      b.addEventListener('click', () => finish(c));
      list.append(b);
    });
    later.addEventListener('click', () => finish(null));
    start.addEventListener('click', () => finish(pending ?? chapters[0]));

    // the keyboard stays in the dialog, as in the Help guide
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const focusable = [...box.querySelectorAll<HTMLButtonElement>('button')];
        const i = focusable.indexOf(document.activeElement as HTMLButtonElement);
        focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
      }
    });
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) e.preventDefault();
    });
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) finish(null);
    });

    document.body.append(scrim);
    start.focus();
  });
}

/**
 * Opens the chapter list and runs the chosen chapter; a finished chapter is remembered and the list comes
 * back for the next one. Ends when the list is closed or a chapter is left halfway.
 */
export async function openTour(o: OpenTourOptions = {}): Promise<void> {
  if (open || tourRunning()) return;
  open = true;
  const chapters = o.chapters ?? CHAPTERS;
  try {
    let welcome = o.welcome ?? false;
    for (;;) {
      const chapter = await pickChapter(chapters, welcome);
      welcome = false;
      if (!chapter) return;
      const end = await runTour(chapter.steps, { ...o.engine, title: chapter.title });
      if (end !== 'finished') return;
      markDone(chapter.id);
    }
  } finally {
    open = false;
  }
}

/** Offers the tour the first time the app is used; afterwards it lives under Help. */
export function offerTourOnce(o: OpenTourOptions = {}): void {
  if (loadProgress().offered) return;
  markOffered();
  void openTour({ ...o, welcome: true });
}
