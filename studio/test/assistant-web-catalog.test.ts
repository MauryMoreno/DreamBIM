import { describe, expect, it } from 'vitest';
import { createExecutor } from '../src/assistant/studio/executor';
import type { StudioHost } from '../src/assistant/studio/host';
import {
  DEFAULT_MODEL,
  MODEL_PRESETS,
  modelSeesImages,
  reasoningCaps,
  reasoningParams,
} from '../src/assistant/web/agent/catalog';
import { FREE_COMMANDS, STUDIO_TOOL, systemPrompt } from '../src/assistant/web/agent/prompt';

describe('herramienta Studio y comandos libres (copia de studio_host.py)', () => {
  it('all the free commands exist in the help of the executor', async () => {
    const r = await createExecutor({} as StudioHost).run('help', {});
    expect(r.ok).toBe(true);
    const names = ((r as { result: { commands: { name: string }[] } }).result.commands).map((c) => c.name);
    for (const free of FREE_COMMANDS) expect(names, free).toContain(free);
  });

  it('the commands that ask for confirmation are exactly the write ones', async () => {
    const r = await createExecutor({} as StudioHost).run('help', {});
    const names = ((r as { result: { commands: { name: string }[] } }).result.commands).map((c) => c.name);
    expect(names.filter((n) => !FREE_COMMANDS.has(n)).sort()).toEqual([
      'assign_material', 'build_model', 'create_material', 'delete_elements', 'place_furniture', 'place_in_wall',
      'place_stairs', 'set_color',
    ]);
  });

  it('la herramienta se llama Studio y exige command', () => {
    expect(STUDIO_TOOL.name).toBe('Studio');
    expect(STUDIO_TOOL.input_schema.required).toEqual(['command']);
  });
});

describe('prompt de sistema', () => {
  it('es el de Studio sin Revit, sin carpeta CDE y dice que es la demo web', () => {
    const p = systemPrompt('');
    expect(p).toContain('Dream BIM');
    expect(p).toContain('Studio help');
    expect(p).toContain(
      'there is no project folder or file system; the model lives in the browser and the user downloads it with Save.',
    );
    expect(p).not.toMatch(/ISO 19650|bqf|README\.md/);
  });

  it('adds the user instructions at the end, and only if there are any', () => {
    expect(systemPrompt('Always answer in Spanish.')).toMatch(/Always answer in Spanish\.$/);
    expect(systemPrompt('   ')).toBe(systemPrompt(''));
  });
});

describe('catalog of models (copy of settings.py)', () => {
  it('default models of each provider', () => {
    expect(DEFAULT_MODEL.anthropic).toBe('claude-haiku-5-5');
    expect(DEFAULT_MODEL.openai).toBe('gpt-6-sol');
    expect(DEFAULT_MODEL.deepseek).toBe('deepseek-flash');
    expect(DEFAULT_MODEL.deepseek_openai).toBe('deepseek-flash');
  });

  it('the models each dialect offers', () => {
    expect(MODEL_PRESETS.anthropic).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
    expect(MODEL_PRESETS.deepseek).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
    expect(MODEL_PRESETS.openai).toEqual(['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol']);
  });

  it('reasoning and vision capabilities', () => {
    expect(reasoningCaps('claude-opus-5-5', 'anthropic')).toMatchObject({ canDisable: false, alwaysOn: true, defaultEffort: 'medium' });
    expect(reasoningCaps('desconocido', 'openai')).toMatchObject({ canDisable: false, alwaysOn: false, efforts: [] });
    expect(modelSeesImages('claude-haiku-5-5', 'anthropic')).toBe(true);
    expect(modelSeesImages('deepseek-v4-pro', 'deepseek')).toBe(false);
    expect(modelSeesImages('gpt-6-sol', 'openai')).toBe(false);
  });

  it('reasoning parameters per dialect', () => {
    expect(reasoningParams('claude-haiku-5-5', 'anthropic', 'on', 'high')).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
    });
    expect(reasoningParams('claude-haiku-5-5', 'anthropic', 'off', null)).toEqual({ thinking: { type: 'disabled' } });
    expect(reasoningParams('claude-opus-5-5', 'anthropic', 'off', null)).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'medium' },
    });
    expect(reasoningParams('deepseek-flash', 'deepseek', 'off', null)).toEqual({ thinking: { type: 'disabled' } });
    expect(reasoningParams('deepseek-flash', 'deepseek_openai', 'on', null)).toBeNull();
    expect(reasoningParams('deepseek-flash', 'deepseek_openai', 'off', null)).toEqual({ extra_body: { thinking: { type: 'disabled' } } });
    expect(reasoningParams('gpt-6-sol', 'openai', 'on', 'low')).toEqual({
      reasoning: { summary: 'auto', effort: 'low' },
      include: ['reasoning.encrypted_content'],
    });
    expect(reasoningParams('gpt-6-sol', 'openai', 'off', null)).toEqual({ reasoning: { effort: 'none' } });
  });
});
