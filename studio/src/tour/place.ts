// Where the tour card goes: pure geometry, no DOM.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** `inside`: the target is too big to sit beside, so the card goes in its lower left corner. */
export type Side = 'bottom' | 'right' | 'left' | 'top' | 'inside' | 'center';

export interface Placement {
  left: number;
  top: number;
  side: Side;
}

const ORDER: Side[] = ['bottom', 'right', 'left', 'top'];

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, Math.max(min, max)));

/**
 * Puts a card of `card` size next to `target` without leaving the `view`. Tries `prefer` first, then
 * below, right, left and above; with no target the card is centered.
 */
export function placeCard(target: Box | null, card: Size, view: Size, prefer?: Side, gap = 12, margin = 8): Placement {
  const maxLeft = view.width - card.width - margin;
  const maxTop = view.height - card.height - margin;
  if (!target) {
    return { left: clamp((view.width - card.width) / 2, margin, maxLeft), top: clamp((view.height - card.height) / 2, margin, maxTop), side: 'center' };
  }

  const room: Record<string, number> = {
    bottom: view.height - (target.top + target.height) - gap - margin - card.height,
    top: target.top - gap - margin - card.height,
    right: view.width - (target.left + target.width) - gap - margin - card.width,
    left: target.left - gap - margin - card.width,
  };
  const order = prefer && ORDER.includes(prefer) ? [prefer, ...ORDER.filter((s) => s !== prefer)] : ORDER;
  const side = order.find((s) => room[s] >= 0);

  const centerX = target.left + target.width / 2 - card.width / 2;
  const centerY = target.top + target.height / 2 - card.height / 2;
  switch (side) {
    case 'bottom':
      return { left: clamp(centerX, margin, maxLeft), top: target.top + target.height + gap, side };
    case 'top':
      return { left: clamp(centerX, margin, maxLeft), top: target.top - gap - card.height, side };
    case 'right':
      return { left: target.left + target.width + gap, top: clamp(centerY, margin, maxTop), side };
    case 'left':
      return { left: target.left - gap - card.width, top: clamp(centerY, margin, maxTop), side };
    default:
      return {
        left: clamp(target.left + gap, margin, maxLeft),
        top: clamp(target.top + target.height - gap - card.height, margin, maxTop),
        side: 'inside',
      };
  }
}
