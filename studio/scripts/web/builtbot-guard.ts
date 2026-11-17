// La demo web publica la interfaz de BuiltBot (chatbot-revit/frontend), que es la misma que usa la app de Revit.
// So that the demo always comes from a known commit and not from whatever is half done on disk, the deploy
// only builds BuiltBot from the branch of the web version and with `frontend/` without pending changes.

export const BUILTBOT_BRANCH = 'builtbot-web';

export interface BuiltBotGit {
  /** `git rev-parse --abbrev-ref HEAD` (con HEAD suelto da `HEAD`). */
  branch: string;
  /** Rutas con cambios sin confirmar dentro de `frontend/` (`git status --porcelain -- frontend`). */
  dirtyFrontend: string[];
  /** `git rev-parse --short HEAD`. */
  commit: string;
}

export function checkBuiltBotSource(git: BuiltBotGit): { ok: true; commit: string } | { ok: false; reason: string } {
  if (git.branch !== BUILTBOT_BRANCH) {
    return { ok: false, reason: `chatbot-revit must be on branch ${BUILTBOT_BRANCH} (is on ${git.branch})` };
  }
  if (git.dirtyFrontend.length) {
    return { ok: false, reason: `chatbot-revit/frontend has uncommitted changes: ${git.dirtyFrontend.join(', ')}` };
  }
  return { ok: true, commit: git.commit };
}
