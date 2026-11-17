// the prompt explains how to place library pieces
import { describe, expect, it } from 'vitest';
import { FREE_COMMANDS, PLACE_SECTION, systemPrompt } from '../src/assistant/web/agent/prompt';

describe('prompt del Asistente web', () => {
  it('plan mode still adds its section', () => {
    const p = systemPrompt('');
    expect(p).toContain('build_model');
    expect(p).toContain('delete_elements');
    expect(p).not.toContain('There are no doors');
    expect(p).not.toContain('the example models are all there is');
    expect(p).toContain('split it into separate walls');
    expect(p).toContain("Don't announce a long plan before acting");
  });

  it('it teaches stair_spots and place_stairs and no longer says there are no stairs', () => {
    const p = systemPrompt('');
    expect(p).toContain('PLACING LIBRARY PIECES');
    expect(p).toContain('place_in_wall');
    expect(p).toContain('place_furniture');
    expect(p).toContain('CENTER');
    expect(PLACE_SECTION).toContain('one undo step');
  });

  it('los comandos nuevos no son libres', () => {
    expect(FREE_COMMANDS.has('build_model')).toBe(false);
    expect(FREE_COMMANDS.has('delete_elements')).toBe(false);
    expect(FREE_COMMANDS.has('walls')).toBe(true);
    expect(FREE_COMMANDS.has('place_in_wall')).toBe(false);
    expect(FREE_COMMANDS.has('place_furniture')).toBe(false);
  });

  it('the skill section goes after the stairs and without a skill the prompt does not change', () => {
    expect(systemPrompt('', true)).toContain('PLAN MODE ACTIVE');
  });
});

describe('escaleras en el prompt', () => {
  it('there is a single skill and it is looked up by name', () => {
    const p = systemPrompt('');
    expect(p).toContain('--- STAIRS ---');
    expect(p).toContain('stair_spots');
    expect(p).toContain('place_stairs');
    expect(p).toContain('Never compute a stair position yourself');
    expect(p).not.toContain('There are no stairs');
  });

  it('stair_spots es libre y place_stairs no', () => {
    expect(FREE_COMMANDS.has('stair_spots')).toBe(true);
    expect(FREE_COMMANDS.has('place_stairs')).toBe(false);
  });
});

describe('skill en el prompt', () => {
  it('the skill text teaches the two review commands and the eight steps', () => {
    const withSkill = systemPrompt('', false, '--- SKILL: X ---');
    expect(withSkill).toContain('--- STAIRS ---');
    expect(withSkill.indexOf('--- SKILL: X ---')).toBeGreaterThan(withSkill.indexOf('--- STAIRS ---'));
    expect(systemPrompt('')).toBe(systemPrompt('', false));
  });

  it('las revisiones son comandos libres', () => {
    expect(FREE_COMMANDS.has('review_plan')).toBe(true);
    expect(FREE_COMMANDS.has('review_model')).toBe(true);
  });
});
