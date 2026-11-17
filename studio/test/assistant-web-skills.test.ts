// Skills integradas del Asistente web: lista y comando /skills.
import { describe, expect, it } from 'vitest';
import { parseSkillCommand, SKILLS, skillByName } from '../src/assistant/web/skills';

describe('skills integradas', () => {
  it('BuiltBot listens to the bridge events through the relay', () => {
    expect(SKILLS).toHaveLength(1);
    expect(SKILLS[0]).toMatchObject({ name: 'design-building', scope: 'builtin' });
    expect(skillByName('design-building')).toBe(SKILLS[0]);
    expect(skillByName(' Design-Building ')).toBe(SKILLS[0]);
    expect(skillByName('nope')).toBeUndefined();
  });

  it('lee /skills <nombre> y /skills off al principio del mensaje', () => {
    expect(parseSkillCommand('/skills design-building')).toEqual({ name: 'design-building' });
    expect(parseSkillCommand('/skills off')).toEqual({ name: null });
    expect(parseSkillCommand('/skills nope')).toEqual({ name: 'nope' });
    expect(parseSkillCommand('  /skills design-building  ')).toEqual({ name: 'design-building' });
    expect(parseSkillCommand('/skills design-building y sigue')).toEqual({ name: 'design-building' });
    expect(parseSkillCommand('hola /skills x')).toBeNull();
    expect(parseSkillCommand('/skills')).toBeNull();
    expect(parseSkillCommand('skills design-building')).toBeNull();
  });

  it('with two open turns the lock is released when the last one ends', () => {
    const prompt = SKILLS[0].prompt;
    expect(prompt).toContain('--- SKILL: DESIGN A BUILDING STEP BY STEP ---');
    expect(prompt).toContain('Step 1 - Lot');
    expect(prompt).toContain('Step 8 - Second review');
    expect(prompt).toContain('review_plan');
    expect(prompt).toContain('review_model');
    expect(prompt).toContain('The two reviews are mandatory');
  });
});
