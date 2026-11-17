import { describe, expect, it, vi } from 'vitest';
import { WorkspaceState } from '../src/workspace/state';

describe('WorkspaceState', () => {
  it('listeners fire once per change', () => {
    const state = new WorkspaceState();
    const listener = vi.fn();
    state.on('editable', listener);
    state.editable = true;
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an unsubscribed listener does not fire', () => {
    const state = new WorkspaceState();
    const listener = vi.fn();
    const unsubscribe = state.on('dirty', listener);
    unsubscribe();
    state.dirty = true;
    expect(listener).not.toHaveBeenCalled();
  });

  it('setting the same value does not notify', () => {
    const state = new WorkspaceState();
    const listener = vi.fn();
    state.on('editable', listener);
    state.editable = true;
    state.editable = true;
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
