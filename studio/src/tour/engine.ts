// Tour engine: a spotlight over a real element of the app and a card that explains it. The app stays
// usable underneath, so a step can ask the user to do something and move on by itself once it is done.
import { placeCard, type Box, type Side } from './place';

export interface TourTask {
  /** What the user is asked to do, in the imperative: "Open the Layer tab." */
  hint: string;
  /** The task is done when this turns true (checked a few times per second). */
  until?: () => boolean;
  /** The task is done when the user clicks inside an element that matches this selector. */
  click?: string;
}

export interface TourStep {
  id: string;
  title: string;
  text: string[];
  /** Element to highlight: the first visible match of the first selector that has one. None: centered card. */
  target?: string | string[];
  /** Side of the target to try first. */
  prefer?: Side;
  task?: TourTask;
  /** Checked once when the tour starts; a step that answers false is left out. */
  when?: () => boolean;
}

export type TourEnd = 'finished' | 'closed';

export interface TourOptions {
  /** Shown above each step: the chapter name. */
  title: string;
  /** How often the target is followed and the task checked. */
  pollMs?: number;
  /** Pause between a finished task and the next step, so the user sees the result. */
  advanceMs?: number;
  /** Screen box of an element (tests replace it: happy-dom has no layout). */
  rectOf?: (el: Element) => Box;
}

const SPOT_PAD = 4;
let running = false;

export function tourRunning(): boolean {
  return running;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, label: string): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  return b;
}

/** The element a step points at, or null when it is missing, hidden, collapsed or has no size. */
export function findTarget(target: TourStep['target'], rectOf: (el: Element) => Box): { el: Element; box: Box } | null {
  for (const selector of target === undefined ? [] : typeof target === 'string' ? [target] : target) {
    for (const candidate of document.querySelectorAll(selector)) {
      if (candidate.closest('[hidden], .ws-mode-off, .is-collapsed')) continue;
      const box = rectOf(candidate);
      if (box.width > 0 && box.height > 0) return { el: candidate, box };
    }
  }
  return null;
}

/**
 * Runs `steps` one after another. Resolves with 'finished' after the last step, or 'closed' when the user
 * leaves early (Skip, the close button or Esc with the focus on the card) or another tour is already running.
 */
export function runTour(allSteps: readonly TourStep[], opts: TourOptions): Promise<TourEnd> {
  const steps = allSteps.filter((s) => s.when?.() ?? true);
  if (running || steps.length === 0) return Promise.resolve('closed');
  running = true;

  const pollMs = opts.pollMs ?? 250;
  const advanceMs = opts.advanceMs ?? 900;
  const rectOf = opts.rectOf ?? ((e: Element) => e.getBoundingClientRect());
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const spot = el('div', 'tour-spot');
  spot.hidden = true;
  const card = el('div', 'tour-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'tour-step-title');

  const head = el('div', 'tour-head');
  const where = el('span', 'tour-where');
  const close = button('tour-close', '✕');
  close.title = 'Close tour';
  close.setAttribute('aria-label', 'Close tour');
  head.append(where, close);
  const title = el('h3', 'tour-title');
  title.id = 'tour-step-title';
  const body = el('div', 'tour-body');
  const task = el('p', 'tour-task');
  task.setAttribute('role', 'status');
  const row = el('div', 'tour-buttons');
  const skip = button('tour-skip', 'Skip tour');
  const back = button('modal-btn', 'Back');
  const next = button('modal-btn modal-btn-primary', 'Next');
  row.append(skip, back, next);
  card.append(head, title, body, task, row);

  let index = 0;
  let taskDone = false;
  let advance: ReturnType<typeof setTimeout> | undefined;
  /** Goes to step `i`, or ends the tour past the last one. Set below, where the ending lives. */
  let go: (i: number) => void = () => {};

  const current = (): TourStep => steps[index];

  /** Follows the target (panels move and resize) and puts the card beside it. */
  function layout(): void {
    const found = findTarget(current().target, rectOf);
    spot.hidden = !found;
    if (found) {
      const b = found.box;
      spot.style.left = `${Math.round(b.left - SPOT_PAD)}px`;
      spot.style.top = `${Math.round(b.top - SPOT_PAD)}px`;
      spot.style.width = `${Math.round(b.width + SPOT_PAD * 2)}px`;
      spot.style.height = `${Math.round(b.height + SPOT_PAD * 2)}px`;
    }
    const size = rectOf(card);
    const p = placeCard(found?.box ?? null, size, { width: window.innerWidth, height: window.innerHeight }, current().prefer);
    card.style.left = `${Math.round(p.left)}px`;
    card.style.top = `${Math.round(p.top)}px`;
    card.dataset.side = p.side;
  }

  function paintTask(): void {
    const t = current().task;
    task.hidden = !t;
    task.classList.toggle('tour-task-done', taskDone);
    task.textContent = t ? (taskDone ? `✓ ${t.hint}` : `Try it: ${t.hint}`) : '';
  }

  /** Marks the task done; `auto` moves on after a pause (not when it was already done on arrival). */
  function completeTask(auto: boolean): void {
    if (taskDone) return;
    taskDone = true;
    paintTask();
    if (auto) advance = setTimeout(() => go(index + 1), advanceMs);
  }

  function show(i: number): void {
    clearTimeout(advance);
    index = i;
    const s = current();
    const keepFocus = card.contains(document.activeElement);
    where.textContent = `${opts.title} · ${i + 1} of ${steps.length}`;
    title.textContent = s.title;
    body.replaceChildren(...s.text.map((t) => el('p', 'tour-text', t)));
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Finish' : 'Next';
    taskDone = false;
    if (s.task?.until?.()) completeTask(false);
    paintTask();
    layout();
    // the focus only moves when it was already on the card: a step that advanced by itself leaves it in the app
    if (keepFocus) next.focus();
  }

  return new Promise<TourEnd>((resolve) => {
    const tick = (): void => {
      layout();
      if (!taskDone && current().task?.until?.()) completeTask(true);
    };
    const onClick = (e: MouseEvent): void => {
      const selector = current().task?.click;
      if (selector && e.target instanceof Element && e.target.closest(selector)) completeTask(true);
    };
    const timer = setInterval(tick, pollMs);
    window.addEventListener('resize', layout);
    document.addEventListener('click', onClick, true);

    const finish = (end: TourEnd): void => {
      clearInterval(timer);
      clearTimeout(advance);
      window.removeEventListener('resize', layout);
      document.removeEventListener('click', onClick, true);
      const hadFocus = card.contains(document.activeElement);
      spot.remove();
      card.remove();
      running = false;
      if (hadFocus && previous?.isConnected) previous.focus();
      resolve(end);
    };
    go = (i) => (i >= steps.length ? finish('finished') : show(Math.max(0, i)));

    close.addEventListener('click', () => finish('closed'));
    skip.addEventListener('click', () => finish('closed'));
    back.addEventListener('click', () => go(index - 1));
    next.addEventListener('click', () => go(index + 1));

    // keys only count with the focus on the card: Esc and the arrows keep their meaning in the app
    card.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        finish('closed');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        go(index - 1);
      }
    });

    document.body.append(spot, card);
    show(0);
    next.focus();
  });
}
