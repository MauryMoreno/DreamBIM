// Build mode: the web demo is built with `vite build --mode web`. It is not detected at run time
// because the tests run without Tauri and would be taken for web.

/** true en la demo web (sin Tauri, sin persistencia). */
export function isWeb(): boolean {
  return import.meta.env.MODE === 'web';
}
