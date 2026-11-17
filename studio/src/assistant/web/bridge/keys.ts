import { Payload } from './types';
import { str, dialectOf } from './helpers-static';
import { PROVIDERS, settingsView, type Provider } from '../prefs';
import type { WebBridgeContext } from './context';

export function installKeys(ctx: WebBridgeContext): void {
  ctx.saveKey = saveKey;
  ctx.removeKey = removeKey;
  function saveKey(p: Payload) {
    const provider = str(p.provider) as Provider;
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`unknown provider '${provider}' (expected one of: ${PROVIDERS.join(', ')})`);
    }
    const key = str(p.api_key).trim();
    if (/[\r\n\s#"']/.test(key)) throw new Error("API key contains spaces, quotes, '#' or line breaks");
    if (!key) throw new Error('API key is empty');
    // the default provider only moves the first time: the first saved key is the one the app starts with
    const moved = settingsView(ctx.prefs).needs_setup;
    if (moved) ctx.prefs.provider = dialectOf(provider);
    ctx.prefs.keys[provider] = key;
    ctx.persist();
    if (moved) ctx.resetSession();
  }

  function removeKey(p: Payload) {
    const provider = str(p.provider) as Provider;
    if (!PROVIDERS.includes(provider)) {
      throw new Error(`unknown provider '${provider}' (expected one of: ${PROVIDERS.join(', ')})`);
    }
    delete ctx.prefs.keys[provider];
    const activeProvider: Provider = ctx.prefs.provider === 'deepseek_openai' ? 'deepseek' : ctx.prefs.provider;
    if (activeProvider === provider) {
      const other = PROVIDERS.find((q) => q !== provider && ctx.prefs.keys[q]);
      if (other) {
        ctx.prefs.provider = dialectOf(other);
        ctx.resetSession(); // lo opaco del proveedor anterior no vale en el nuevo
      }
    }
    ctx.persist();
  }
}
