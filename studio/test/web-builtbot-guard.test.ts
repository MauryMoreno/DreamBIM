// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BUILTBOT_BRANCH, checkBuiltBotSource } from '../scripts/web/builtbot-guard';

describe('origen de BuiltBot para la demo web', () => {
  it('la rama es builtbot-web', () => {
    expect(BUILTBOT_BRANCH).toBe('builtbot-web');
  });

  it('en la rama y sin cambios en frontend/ deja compilar y da el commit', () => {
    expect(checkBuiltBotSource({ branch: 'builtbot-web', dirtyFrontend: [], commit: 'abc1234' })).toEqual({ ok: true, commit: 'abc1234' });
  });

  it('on another branch it refuses and says which one it is on', () => {
    expect(checkBuiltBotSource({ branch: 'New-structure', dirtyFrontend: [], commit: 'abc1234' })).toEqual({
      ok: false,
      reason: 'chatbot-revit must be on branch builtbot-web (is on New-structure)',
    });
  });

  it('con cambios sin confirmar en frontend/ se niega y los nombra', () => {
    expect(
      checkBuiltBotSource({ branch: 'builtbot-web', dirtyFrontend: ['frontend/src/a.ts', 'frontend/src/b.tsx'], commit: 'abc1234' }),
    ).toEqual({ ok: false, reason: 'chatbot-revit/frontend has uncommitted changes: frontend/src/a.ts, frontend/src/b.tsx' });
  });

  it('on a detached branch (HEAD) it also refuses', () => {
    const r = checkBuiltBotSource({ branch: 'HEAD', dirtyFrontend: [], commit: 'abc1234' });
    expect(r.ok).toBe(false);
  });

  it('the branch comes before the changes: the branch is warned about first', () => {
    const r = checkBuiltBotSource({ branch: 'master', dirtyFrontend: ['frontend/x'], commit: 'abc' });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('must be on branch builtbot-web') });
  });
});
