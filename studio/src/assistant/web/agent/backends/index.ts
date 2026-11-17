// Chooses the adapter of each dialect. The addresses are the official ones of each provider: the user's key
// is not sent anywhere else, and there is no base URL field on the web.
import type { Dialect } from '../catalog';
import { anthropicBackend } from './anthropic';
import { chatBackend } from './chat';
import { responsesBackend } from './responses';
import type { Backend } from './types';

export type { Backend } from './types';

export const BASE_URL: Record<Dialect, string> = {
  anthropic: 'https://api.anthropic.com',
  deepseek: 'https://api.deepseek.com/anthropic',
  deepseek_openai: 'https://api.deepseek.com',
  openai: 'https://api.openai.com',
};

export function backendFor(dialect: Dialect, apiKey: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Backend {
  const base = BASE_URL[dialect];
  switch (dialect) {
    case 'anthropic':
    case 'deepseek':
      return anthropicBackend(apiKey, base, fetchImpl, dialect === 'deepseek');
    case 'openai':
      return responsesBackend(apiKey, base, fetchImpl);
    case 'deepseek_openai':
      return chatBackend(apiKey, base, fetchImpl);
  }
}
