// Models per provider, reasoning and vision capabilities of the web agent.
// Copia de chatbot-revit/AI_Manage/src/settings_config/settings.py (MODEL_PRESETS, REASONING_CAPS, VISION_MODELS,
// _thinking_for) and of services/user_settings.py (PROVIDERS, default models). If the Python changes, this must
// change with it: they are the real measures of each model, not assumptions.

/** How the provider is spoken to: `deepseek` is DeepSeek through its Anthropic-compatible endpoint. */
export type Dialect = 'anthropic' | 'deepseek' | 'deepseek_openai' | 'openai';

export const DIALECTS: readonly Dialect[] = ['deepseek', 'anthropic', 'openai', 'deepseek_openai'];

export const MODEL_PRESETS: Record<Dialect, readonly string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
  // el mismo servicio por otro transporte: el modelo no debe ser otra variable
  deepseek_openai: ['deepseek-flash', 'deepseek-v4-pro'],
  openai: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol'],
};

export const DEFAULT_MODEL: Record<Dialect, string> = {
  deepseek: 'deepseek-flash',
  deepseek_openai: 'deepseek-flash',
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-6-sol',
};

export interface ReasoningCaps {
  /** El interruptor puede apagarse (y apagado deja de razonar). */
  canDisable: boolean;
  /** Razona y no se puede apagar. */
  alwaysOn: boolean;
  /** Levels the interface offers, from weakest to strongest; empty = no dropdown. */
  efforts: readonly string[];
  defaultEffort: string | null;
}

const NO_REASONING: ReasoningCaps = { canDisable: false, alwaysOn: false, efforts: [], defaultEffort: null };
const CLAUDE_5 = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const caps = (
  canDisable: boolean,
  alwaysOn: boolean,
  efforts: readonly string[],
  defaultEffort: string | null,
): ReasoningCaps => ({ canDisable, alwaysOn, efforts, defaultEffort });

const REASONING_CAPS: Record<Dialect, Record<string, ReasoningCaps>> = {
  anthropic: {
    'claude-haiku-5-5': caps(true, false, CLAUDE_5, 'medium'),
    'claude-sonnet-5-5': caps(false, true, CLAUDE_5, 'high'),
    'claude-opus-5-5': caps(false, true, CLAUDE_5, 'medium'),
    'claude-fable-5-1': caps(false, true, CLAUDE_5, 'high'),
    // previous generation: no longer offered, but a model pinned by hand still resolves here
    'claude-haiku-4-5': NO_REASONING,
    'claude-sonnet-5': caps(true, false, CLAUDE_5, 'high'),
    'claude-opus-5': caps(true, false, CLAUDE_5, 'high'),
    'claude-fable-5': caps(false, true, CLAUDE_5, 'high'),
  },
  deepseek: {
    'deepseek-flash': caps(true, false, ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], 'high'),
    'deepseek-v4-pro': caps(true, false, [], null),
  },
  deepseek_openai: {
    'deepseek-flash': caps(true, false, [], null),
    'deepseek-v4-pro': caps(true, false, [], null),
  },
  openai: {
    'gpt-6-luna': caps(true, false, CLAUDE_5, 'medium'),
    'gpt-6-sol': caps(true, false, CLAUDE_5, 'medium'),
    'gpt-6-astra': caps(false, true, CLAUDE_5, 'medium'),
    'gpt-6.1-sol': caps(false, true, CLAUDE_5, 'medium'),
  },
};

/** Modelos que de verdad reciben un bloque de imagen (medido); ausente = no medido = false. */
const VISION_MODELS: Record<Dialect, ReadonlySet<string>> = {
  anthropic: new Set([...MODEL_PRESETS.anthropic, 'claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-fable-5']),
  deepseek: new Set(['deepseek-flash']),
  deepseek_openai: new Set(),
  openai: new Set(),
};

const norm = (s: string) => (s ?? '').trim().toLowerCase();

export function reasoningCaps(model: string, dialect: Dialect): ReasoningCaps {
  return REASONING_CAPS[dialect]?.[norm(model)] ?? NO_REASONING;
}

export function modelSeesImages(model: string, dialect: Dialect): boolean {
  return VISION_MODELS[dialect]?.has(norm(model)) ?? false;
}

/**
 * Extra request parameters for reasoning, in the dialect of the provider, or null to send none.
 * `mode` is the position of the switch ('on' | 'off'; anything else counts as 'on').
 */
export function reasoningParams(
  model: string,
  dialect: Dialect,
  mode: string,
  effort: string | null,
): Record<string, unknown> | null {
  const c = reasoningCaps(model, dialect);
  const on = c.alwaysOn || (mode !== 'off' && c.canDisable);
  const level = on ? (effort && c.efforts.includes(effort) ? effort : c.defaultEffort) : null;

  if (dialect === 'deepseek') {
    // DeepSeek reasons if the parameter is omitted: it is always said which
    const params: Record<string, unknown> = { thinking: { type: on ? 'enabled' : 'disabled' } };
    if (level) params.output_config = { effort: level };
    return params;
  }
  if (dialect === 'deepseek_openai') {
    if (on) return level ? { reasoning_effort: level } : null;
    return { extra_body: { thinking: { type: 'disabled' } } };
  }
  if (dialect === 'openai') {
    // Responses dialect; `store: false` is set by the adapter on every request
    if (on) {
      const reasoning: Record<string, unknown> = { summary: 'auto' };
      if (level) reasoning.effort = level;
      return { reasoning, include: ['reasoning.encrypted_content'] };
    }
    return c.canDisable ? { reasoning: { effort: 'none' } } : null;
  }
  // Anthropic: Claude 5 returns empty thinking if a summary is not requested, and Opus reasons if the
  // parameter is omitted, so "off" says `disabled`, and never together with an effort.
  if (on) {
    const params: Record<string, unknown> = { thinking: { type: 'adaptive', display: 'summarized' } };
    if (level) params.output_config = { effort: level };
    return params;
  }
  return c.canDisable ? { thinking: { type: 'disabled' } } : null;
}
