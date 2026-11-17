// Preferencias y claves del Asistente en la demo web. Todo vive en este navegador (localStorage); si el
// storage is not available (private window, blocked data), everything works during the session and is not saved.
// La forma de `settingsView` es la de `read()` de chatbot-revit/AI_Manage/src/services/user_settings.py.
import { DEFAULT_MODEL, DIALECTS, type Dialect } from './agent/catalog';

/** The providers the keys panel offers (user_settings.PROVIDERS). */
export type Provider = 'deepseek' | 'anthropic' | 'openai';
export const PROVIDERS: readonly Provider[] = ['deepseek', 'anthropic', 'openai'];

export interface WebPrefs {
  provider: Dialect;
  models: Partial<Record<Dialect, string>>;
  keys: Partial<Record<Provider, string>>;
  effort: string | null;
  thinkingMode: string;
  planMode: boolean;
  autoApprove: boolean;
  instructions: string;
}

export const PREFS_KEY = 'ifcx.assistant.prefs.v1';
const DEFAULT_PROVIDER: Dialect = 'deepseek';

export function defaultPrefs(): WebPrefs {
  return {
    provider: DEFAULT_PROVIDER,
    models: {},
    keys: {},
    effort: null,
    thinkingMode: 'on',
    planMode: false,
    autoApprove: false,
    instructions: '',
  };
}

function ambientStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function loadPrefs(storage: Storage | null = ambientStorage()): WebPrefs {
  const out = defaultPrefs();
  let raw: unknown;
  try {
    const text = storage?.getItem(PREFS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    return out;
  }
  if (!isObject(raw)) return out;
  if (DIALECTS.includes(raw.provider as Dialect)) out.provider = raw.provider as Dialect;
  if (isObject(raw.models)) {
    for (const d of DIALECTS) {
      const m = str(raw.models[d]);
      if (m) out.models[d] = m;
    }
  }
  if (isObject(raw.keys)) {
    for (const p of PROVIDERS) {
      const k = str(raw.keys[p]);
      if (k) out.keys[p] = k;
    }
  }
  out.effort = str(raw.effort);
  out.thinkingMode = str(raw.thinkingMode) ?? out.thinkingMode;
  out.planMode = raw.planMode === true;
  out.autoApprove = raw.autoApprove === true;
  out.instructions = str(raw.instructions) ?? '';
  return out;
}

export function savePrefs(p: WebPrefs, storage: Storage | null = ambientStorage()): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* no storage: it lasts as long as the session */
  }
}

/** The key a dialect uses; DeepSeek through OpenAI uses the DeepSeek one. */
export function keyFor(p: WebPrefs, d: Dialect): string | null {
  const provider: Provider = d === 'deepseek_openai' ? 'deepseek' : d;
  return p.keys[provider] ?? null;
}

export function settingsView(p: WebPrefs): {
  provider: string;
  model: string;
  keys: Record<Provider, boolean>;
  needs_setup: boolean;
} {
  return {
    provider: p.provider,
    model: p.models[p.provider] ?? DEFAULT_MODEL[p.provider],
    keys: { deepseek: !!p.keys.deepseek, anthropic: !!p.keys.anthropic, openai: !!p.keys.openai },
    needs_setup: keyFor(p, p.provider) === null,
  };
}
