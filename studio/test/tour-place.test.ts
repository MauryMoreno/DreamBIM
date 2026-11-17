// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { placeCard } from '../src/tour/place';

const VIEW = { width: 1000, height: 700 };
const CARD = { width: 300, height: 200 };

describe('placeCard', () => {
  it('centers the card when there is no target', () => {
    expect(placeCard(null, CARD, VIEW)).toEqual({ left: 350, top: 250, side: 'center' });
  });

  it('goes below the target when it fits, centered on it', () => {
    const p = placeCard({ left: 400, top: 40, width: 200, height: 30 }, CARD, VIEW);
    expect(p).toEqual({ left: 350, top: 82, side: 'bottom' });
  });

  it('tries the preferred side first', () => {
    const target = { left: 20, top: 100, width: 200, height: 300 };
    expect(placeCard(target, CARD, VIEW, 'right')).toEqual({ left: 232, top: 150, side: 'right' });
  });

  it('falls back to another side when the preferred one has no room', () => {
    // a column on the right edge: nothing fits to its right or below, so the card goes to its left
    const p = placeCard({ left: 760, top: 40, width: 240, height: 640 }, CARD, VIEW, 'right');
    expect(p.side).toBe('left');
    expect(p.left).toBe(760 - 12 - 300);
  });

  it('goes above a target that sits at the bottom', () => {
    const p = placeCard({ left: 0, top: 560, width: 1000, height: 140 }, CARD, VIEW);
    expect(p.side).toBe('top');
    expect(p.top).toBe(560 - 12 - 200);
  });

  it('puts the card inside a target that fills the window', () => {
    const p = placeCard({ left: 0, top: 0, width: 1000, height: 700 }, CARD, VIEW);
    expect(p).toEqual({ left: 12, top: 700 - 12 - 200, side: 'inside' });
  });

  it('never leaves the window', () => {
    const p = placeCard({ left: 0, top: 40, width: 60, height: 30 }, CARD, VIEW);
    expect(p.left).toBe(8);
    const small = placeCard(null, CARD, { width: 200, height: 100 });
    expect(small).toEqual({ left: 8, top: 8, side: 'center' });
  });
});
