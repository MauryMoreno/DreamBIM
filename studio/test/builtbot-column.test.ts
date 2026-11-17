import { describe, expect, it, vi } from 'vitest';
import { BUILTBOT_WEB_SRC, isBuiltBotPage, mountBuiltBotColumn } from '../src/assistant/builtbot/column';

describe('columna con BuiltBot', () => {
  it('abre un solo iframe con host=studio aunque open se llame dos veces', async () => {
    const exists = vi.fn(async () => true);
    const col = mountBuiltBotColumn({ exists });
    await col.open();
    await col.open();
    const frames = col.root.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute('src')).toBe('/builtbot/index.html?host=studio');
    expect(frames[0].classList.contains('bb-frame')).toBe(true);
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it('en la demo web abre BuiltBot con host=studio-web', async () => {
    expect(BUILTBOT_WEB_SRC).toBe('/builtbot/index.html?host=studio-web');
    const exists = vi.fn(async () => true);
    const col = mountBuiltBotColumn({ src: BUILTBOT_WEB_SRC, exists });
    await col.open();
    expect(col.root.querySelector('iframe')!.getAttribute('src')).toBe('/builtbot/index.html?host=studio-web');
    expect(exists).toHaveBeenCalledWith('/builtbot/index.html');
  });

  it('if a reload loads something else (the Studio index in dev), it goes back to the BuiltBot page', async () => {
    const col = mountBuiltBotColumn({ exists: async () => false });
    await col.open();
    expect(col.root.querySelector('iframe')).toBeNull();
    expect(col.root.textContent).toContain(
      'BuiltBot is not built yet. Run npm run sync-builtbot in the studio folder, then reopen Dream BIM.',
    );
  });

  it('antes de abrir no carga nada', () => {
    const exists = vi.fn(async () => true);
    const col = mountBuiltBotColumn({ exists });
    expect(col.root.querySelector('iframe')).toBeNull();
    expect(exists).not.toHaveBeenCalled();
  });
});

describe('reconocer la build de BuiltBot', () => {
  it('es BuiltBot si carga sus recursos con el prefijo /builtbot', () => {
    expect(isBuiltBotPage('<html><head><script src="/builtbot/_next/static/chunks/a.js"></script></head></html>')).toBe(true);
  });

  it('with invoke it exposes it, delegates to it and marks the relay as web', () => {
    expect(isBuiltBotPage('<html><head><script type="module" src="/src/main.ts"></script></head></html>')).toBe(false);
  });
});

describe('el iframe nunca se queda con algo que no es BuiltBot', () => {
  it('an executor result with an error is also answered', async () => {
    const col = mountBuiltBotColumn({ exists: async () => true });
    await col.open();
    const frame = col.root.querySelector('iframe')!;
    const replace = vi.fn();
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => ({ documentElement: { outerHTML: '<html><script type="module" src="/src/main.ts"></script></html>' } }),
    });
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => ({ location: { replace } }) });
    frame.dispatchEvent(new Event('load'));
    expect(replace).toHaveBeenCalledWith('/builtbot/index.html?host=studio');
  });

  it('si carga BuiltBot no toca nada', async () => {
    const col = mountBuiltBotColumn({ exists: async () => true });
    await col.open();
    const frame = col.root.querySelector('iframe')!;
    const replace = vi.fn();
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => ({ documentElement: { outerHTML: '<html><script src="/builtbot/_next/a.js"></script></html>' } }),
    });
    Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => ({ location: { replace } }) });
    frame.dispatchEvent(new Event('load'));
    expect(replace).not.toHaveBeenCalled();
  });
});
