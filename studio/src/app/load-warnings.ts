// Warnings when loading a model that deserve to be spelled out.

const IMPORT_UNAVAILABLE = 'Import unavailable:';

/**
 * Warning about the imported files that could not be read (in the web demo, a model opened on its own without its
 * companions looks incomplete): it names the first one with its reason and leaves all of them in `log`. null if none is missing.
 */
export function importWarningToast(name: string, warnings: readonly string[]): { message: string; log: string[] } | null {
  const log = warnings.filter((w) => w.startsWith(IMPORT_UNAVAILABLE));
  if (log.length === 0) return null;
  const more = log.length > 1 ? ` (+${log.length - 1} more, see console)` : '';
  return { message: `${name}: ${log[0]}${more}`, log };
}
