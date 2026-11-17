import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTarget, runTour, tourRunning, type TourStep } from '../src/tour/engine';

const BOX = { left: 100, top: 100, width: 200, height: 50 };
const rectOf = () => BOX;
const OPTS = { title: 'Chapter', pollMs: 10, advanceMs: 20, rectOf };

const card = () => document.querySelector<HTMLElement>('.tour-card');
const spot = () => document.querySelector<HTMLElement>('.tour-spot');
const button = (label: string) => [...card()!.querySelectorAll('button')].find((b) => b.textContent === label)!;
const stepTitle = () => card()!.querySelector('.tour-title')!.textContent;
const taskText = () => card()!.querySelector('.tour-task')!.textContent;
const key = (k: string) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

const step = (id: string, extra: Partial<TourStep> = {}): TourStep => ({ id, title: id.toUpperCase(), text: [`about ${id}`], ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="before">before</button><div class="panel">panel</div><div id="gone" hidden><i class="inner"></i></div>';
});

afterEach(() => {
  // a test that leaves the tour open closes it here, so the next one starts clean
  if (card()) button('Skip tour').click();
  vi.useRealTimers();
});

describe('runTour', () => {
  it('shows the first step with its position in the chapter and Back disabled', () => {
    void runTour([step('a'), step('b')], OPTS);
    expect(tourRunning()).toBe(true);
    expect(stepTitle()).toBe('A');
    expect(card()!.textContent).toContain('about a');
    expect(card()!.querySelector('.tour-where')!.textContent).toBe('Chapter · 1 of 2');
    expect(button('Back').disabled).toBe(true);
  });

  it('Next and Back walk the steps, and Finish on the last one ends as finished', async () => {
    const p = runTour([step('a'), step('b')], OPTS);
    button('Next').click();
    expect(stepTitle()).toBe('B');
    button('Back').click();
    expect(stepTitle()).toBe('A');
    button('Next').click();
    button('Finish').click();
    await expect(p).resolves.toBe('finished');
    expect(card()).toBeNull();
    expect(spot()).toBeNull();
    expect(tourRunning()).toBe(false);
  });

  it('Skip tour, the close button and Esc end as closed', async () => {
    for (const leave of [() => button('Skip tour').click(), () => button('✕').click(), () => key('Escape')]) {
      const p = runTour([step('a'), step('b')], OPTS);
      leave();
      await expect(p).resolves.toBe('closed');
      expect(card()).toBeNull();
    }
  });

  it('Esc on the card does not reach the app, and the focus goes back where it was', async () => {
    const before = document.getElementById('before')!;
    before.focus();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    const p = runTour([step('a')], OPTS);
    expect(document.activeElement).toBe(button('Finish'));
    key('Escape');
    await p;
    window.removeEventListener('keydown', seen);
    expect(seen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
  });

  it('the arrow keys move between steps', () => {
    void runTour([step('a'), step('b')], OPTS);
    key('ArrowRight');
    expect(stepTitle()).toBe('B');
    key('ArrowLeft');
    expect(stepTitle()).toBe('A');
  });

  it('puts the spotlight around the target and the card beside it', () => {
    void runTour([step('a', { target: '.panel' })], OPTS);
    expect(spot()!.hidden).toBe(false);
    expect(spot()!.style.left).toBe('96px');
    expect(spot()!.style.width).toBe('208px');
    expect(card()!.dataset.side).not.toBe('center');
  });

  it('centers the card and hides the spotlight when the target is missing or hidden', () => {
    void runTour([step('a', { target: '.nope' }), step('b', { target: '.inner' })], OPTS);
    expect(spot()!.hidden).toBe(true);
    expect(card()!.dataset.side).toBe('center');
    button('Next').click();
    expect(spot()!.hidden).toBe(true);
  });

  it('follows a target that appears later', () => {
    void runTour([step('a', { target: '.late' })], OPTS);
    expect(spot()!.hidden).toBe(true);
    document.body.insertAdjacentHTML('beforeend', '<div class="late"></div>');
    vi.advanceTimersByTime(10);
    expect(spot()!.hidden).toBe(false);
  });

  it('a task moves on by itself, after a pause, once it is done', () => {
    let done = false;
    void runTour([step('a', { task: { hint: 'Do it.', until: () => done } }), step('b')], OPTS);
    expect(taskText()).toBe('Try it: Do it.');
    vi.advanceTimersByTime(50);
    expect(stepTitle()).toBe('A');
    done = true;
    vi.advanceTimersByTime(10);
    expect(taskText()).toBe('✓ Do it.');
    expect(stepTitle()).toBe('A');
    vi.advanceTimersByTime(20);
    expect(stepTitle()).toBe('B');
  });

  it('a click task is done by a click inside the element, not outside it', () => {
    void runTour([step('a', { task: { hint: 'Click the panel.', click: '.panel' } }), step('b')], OPTS);
    document.getElementById('before')!.click();
    vi.advanceTimersByTime(50);
    expect(stepTitle()).toBe('A');
    document.querySelector<HTMLElement>('.panel')!.click();
    vi.advanceTimersByTime(20);
    expect(stepTitle()).toBe('B');
  });

  it('a task that was already done on arrival shows as done and waits for Next', () => {
    void runTour([step('a', { task: { hint: 'Do it.', until: () => true } }), step('b')], OPTS);
    expect(taskText()).toBe('✓ Do it.');
    vi.advanceTimersByTime(200);
    expect(stepTitle()).toBe('A');
  });

  it('a finished task as the last step finishes the tour', async () => {
    let done = false;
    const p = runTour([step('a', { task: { hint: 'Do it.', until: () => done } })], OPTS);
    done = true;
    vi.advanceTimersByTime(30);
    await expect(p).resolves.toBe('finished');
  });

  it('pressing Next cancels the pending automatic step, so it does not skip one', () => {
    let done = false;
    void runTour([step('a', { task: { hint: 'Do it.', until: () => done } }), step('b'), step('c')], OPTS);
    done = true;
    vi.advanceTimersByTime(10);
    button('Next').click();
    vi.advanceTimersByTime(100);
    expect(stepTitle()).toBe('B');
  });

  it('leaves out the steps whose condition is false, and counts the rest', () => {
    void runTour([step('a', { when: () => false }), step('b'), step('c')], OPTS);
    expect(stepTitle()).toBe('B');
    expect(card()!.querySelector('.tour-where')!.textContent).toBe('Chapter · 1 of 2');
  });

  it('does not start a second tour over a running one, nor an empty one', async () => {
    void runTour([step('a')], OPTS);
    await expect(runTour([step('b')], OPTS)).resolves.toBe('closed');
    expect(document.querySelectorAll('.tour-card').length).toBe(1);
    button('Skip tour').click();
    await expect(runTour([step('a', { when: () => false })], OPTS)).resolves.toBe('closed');
    expect(card()).toBeNull();
  });

  it('stops its timers and listeners when it ends', async () => {
    const until = vi.fn(() => false);
    const p = runTour([step('a', { task: { hint: 'Do it.', until } })], OPTS);
    button('Skip tour').click();
    await p;
    until.mockClear();
    vi.advanceTimersByTime(100);
    expect(until).not.toHaveBeenCalled();
  });
});

describe('findTarget', () => {
  it('takes the first selector that has a visible match', () => {
    expect(findTarget(['.nope', '.inner', '.panel'], rectOf)?.el.className).toBe('panel');
  });

  it('skips collapsed panels, panels of another mode and elements without size', () => {
    document.body.innerHTML = '<div class="is-collapsed"><b class="x"></b></div><div class="ws-mode-off"><b class="y"></b></div><b class="z"></b>';
    expect(findTarget('.x', rectOf)).toBeNull();
    expect(findTarget('.y', rectOf)).toBeNull();
    expect(findTarget('.z', () => ({ left: 0, top: 0, width: 0, height: 0 }))).toBeNull();
    expect(findTarget(undefined, rectOf)).toBeNull();
  });
});
