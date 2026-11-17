// Columna del Asistente: la interfaz de BuiltBot (su build estática, copiada por scripts/sync-builtbot.ts)
// en un iframe del mismo origen. Las llamadas a Tauri salen solas desde el iframe; los eventos no le
// llegan, y BuiltBot los escucha a través del relevo de esta ventana (relay.ts). El iframe se crea la
// primera vez que se abre la columna, para no cargar BuiltBot ni arrancar el agente antes de tiempo, y no
// se destruye nunca: plegar la columna solo la oculta.
import type { AssistantPanel } from '../../workspace/workspace';

export const BUILTBOT_SRC = '/builtbot/index.html?host=studio';
/** La demo web: sin Tauri, BuiltBot habla con el puente del navegador (assistant/web/). */
export const BUILTBOT_WEB_SRC = '/builtbot/index.html?host=studio-web';
const MISSING = 'BuiltBot is not built yet. Run npm run sync-builtbot in the studio folder, then reopen Dream BIM.';

/**
 * ¿Es la página de BuiltBot? Se reconoce por sus recursos con el prefijo /builtbot: el servidor de
 * desarrollo devuelve el index de Studio para cualquier ruta que no existe, y eso no debe pasar por BuiltBot.
 */
export function isBuiltBotPage(html: string): boolean {
  return html.includes('/builtbot/_next/');
}

async function builtbotCopied(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    return r.ok && isBuiltBotPage(await r.text());
  } catch {
    return false;
  }
}

export function mountBuiltBotColumn(
  opts: { src?: string; exists?(url: string): Promise<boolean> } = {},
): AssistantPanel {
  const src = opts.src ?? BUILTBOT_SRC;
  const exists = opts.exists ?? builtbotCopied;
  const root = document.createElement('section');
  root.className = 'bb-column';
  root.setAttribute('aria-label', 'Assistant');
  let opened: Promise<void> | null = null;

  const load = async () => {
    if (await exists(src.split('?')[0])) {
      const frame = document.createElement('iframe');
      frame.className = 'bb-frame';
      frame.title = 'BuiltBot';
      frame.setAttribute('src', src);
      // en dev, una recarga de una ruta interna de BuiltBot puede devolver el index de Studio: se vuelve a
      // la página de BuiltBot en vez de dejar un Studio dentro de la columna
      frame.addEventListener('load', () => {
        const html = frame.contentDocument?.documentElement?.outerHTML ?? '';
        if (html && !isBuiltBotPage(html)) frame.contentWindow?.location.replace(src);
      });
      root.replaceChildren(frame);
    } else {
      const p = document.createElement('p');
      p.className = 'bb-missing';
      p.textContent = MISSING;
      root.replaceChildren(p);
    }
  };

  return {
    root,
    open() {
      opened ??= load();
      return opened;
    },
  };
}
