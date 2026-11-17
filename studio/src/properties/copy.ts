// Copies a path to the clipboard and reports the result; it never throws.
import { toast } from '../shell/toast';

export function copyPath(text: string, notify: typeof toast = toast): void {
  const fail = () => notify('Could not copy the path', 'error');
  try {
    // sin API de portapapeles (contexto no seguro) o con writeText que lanza: mismo aviso
    const done = navigator.clipboard?.writeText(text);
    if (!done) return fail();
    done.then(() => notify('Path copied', 'info'), fail);
  } catch {
    fail();
  }
}
