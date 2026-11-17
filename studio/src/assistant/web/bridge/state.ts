import { textHistory } from './helpers-static';
import { DEFAULT_MODEL } from '../agent/catalog';
import { type Decision } from '../agent/loop';
import { loadPrefs, savePrefs } from '../prefs';
import type { WebBridgeContext } from './context';

export function installState(ctx: WebBridgeContext): void {
  ctx.prefs = loadPrefs(ctx.d.storage);

  const persist = () => savePrefs(ctx.prefs, ctx.d.storage);
  ctx.persist = persist;

  ctx.convId = null;

  ctx.rich = [];

  ctx.history = [];

  const turns = new Map<string, AbortController>();
  ctx.turns = turns;

  const pending = new Map<string, (decision: Decision) => void>();
  ctx.pending = pending;

  const always = new Set<string>();
  ctx.always = always;

  /** Name of the skill active in the conversation, if there is one. */
  ctx.skill = null;

  /** stableKey of the `build` whose last `review_plan` passed. */
  ctx.approvedBuild = null;

  /** The model changed since the last approved `review_model`. */
  ctx.needsModelReview = false;

  const SKILL_GATE =
    'The "design-building" skill is active: run review_plan with this exact plan first, fix everything it reports, ' +
    'and build only the plan that passed.';
  ctx.SKILL_GATE = SKILL_GATE;

  const REVIEW_NOTE = '[skill] The model changed: run review_model before telling the user it is finished.';
  ctx.REVIEW_NOTE = REVIEW_NOTE;

  const WRITES = new Set(['build_model', 'place_in_wall', 'place_stairs', 'place_furniture', 'delete_elements']);
  ctx.WRITES = WRITES;

  const activeModel = (): string => ctx.prefs.models[ctx.prefs.provider] ?? DEFAULT_MODEL[ctx.prefs.provider];
  ctx.activeModel = activeModel;

  const resetSession = () => {
    // un razonamiento firmado o una llamada de otro proveedor no se pueden reenviar a otro: solo el texto pasa
    ctx.history = textHistory(ctx.rich);
  };
  ctx.resetSession = resetSession;
}
