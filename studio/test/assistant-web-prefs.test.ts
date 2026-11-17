import { describe, expect, it } from 'vitest';
import { keyFor, loadPrefs, savePrefs, settingsView } from '../src/assistant/web/prefs';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const hostileStorage = (): Storage =>
  ({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  }) as unknown as Storage;

describe('preferencias y claves del Asistente web', () => {
  it('sin nada guardado pide configurar DeepSeek, como el escritorio', () => {
    expect(settingsView(loadPrefs(memoryStorage()))).toEqual({
      provider: 'deepseek',
      model: 'deepseek-flash',
      keys: { deepseek: false, anthropic: false, openai: false },
      needs_setup: true,
    });
  });

  it('con una clave guardada ya no pide configurar y el modelo elegido se recuerda', () => {
    const s = memoryStorage();
    const p = loadPrefs(s);
    p.provider = 'anthropic';
    p.models.anthropic = 'claude-opus-5-5';
    p.keys.anthropic = 'sk-ant-x';
    savePrefs(p, s);
    expect(settingsView(loadPrefs(s))).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      keys: { deepseek: false, anthropic: true, openai: false },
      needs_setup: false,
    });
  });

  it('guardar y volver a cargar devuelve lo mismo', () => {
    const s = memoryStorage();
    const p = loadPrefs(s);
    p.planMode = true;
    p.autoApprove = true;
    p.effort = 'high';
    p.thinkingMode = 'off';
    p.instructions = 'Hola';
    p.keys.openai = 'sk-o';
    savePrefs(p, s);
    expect(loadPrefs(s)).toEqual(p);
  });

  it('a saved provider that no longer exists goes back to the default one', () => {
    const h = hostileStorage();
    const p = loadPrefs(h);
    expect(p.provider).toBe('deepseek');
    expect(() => savePrefs(p, h)).not.toThrow();
    expect(loadPrefs(null).provider).toBe('deepseek');
    expect(() => savePrefs(p, null)).not.toThrow();
  });

  it('needs_setup also counts for deepseek_openai without a DeepSeek key', () => {
    const s = memoryStorage();
    s.setItem('ifcx.assistant.prefs.v1', '{no es json');
    expect(loadPrefs(s).provider).toBe('deepseek');
    s.setItem('ifcx.assistant.prefs.v1', '"cadena"');
    expect(loadPrefs(s).provider).toBe('deepseek');
  });

  it('Prompt of the web Assistant: how to create models, place pieces and which commands are free.', () => {
    const s = memoryStorage();
    s.setItem('ifcx.assistant.prefs.v1', JSON.stringify({ provider: 'qwen', keys: { anthropic: 7 } }));
    const p = loadPrefs(s);
    expect(p.provider).toBe('deepseek');
    expect(p.keys.anthropic).toBeUndefined();
  });

  it('keyFor: DeepSeek por OpenAI usa la clave de DeepSeek', () => {
    const p = loadPrefs(memoryStorage());
    p.keys.deepseek = 'ds';
    p.keys.openai = 'oa';
    expect(keyFor(p, 'deepseek_openai')).toBe('ds');
    expect(keyFor(p, 'deepseek')).toBe('ds');
    expect(keyFor(p, 'openai')).toBe('oa');
    expect(keyFor(p, 'anthropic')).toBeNull();
  });

  it('the prompt explains how to create models', () => {
    const p = loadPrefs(memoryStorage());
    p.provider = 'deepseek_openai';
    expect(settingsView(p).needs_setup).toBe(true);
    p.keys.deepseek = 'ds';
    expect(settingsView(p).needs_setup).toBe(false);
  });
});
