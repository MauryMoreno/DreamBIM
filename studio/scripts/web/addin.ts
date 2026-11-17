// Which add-in zip the demo publishes: the most recent one that has the source code zip (LGPL) next to it.

export interface AddinManifest {
  file: string;
  version: string;
  sizeMB: number;
  source: string;
}

export interface ZipFile {
  name: string;
  mtimeMs: number;
  size: number;
}

const NAME = /^IFCx-Revit-2026-(.+)\.zip$/;
const SOURCE_SUFFIX = '-src.zip';

/** The most recent zip that has its sources zip; null if none has sources. */
export function pickAddin(files: ZipFile[]): AddinManifest | null {
  const names = new Set(files.map((f) => f.name));
  let best: { file: ZipFile; version: string } | null = null;
  for (const file of files) {
    if (file.name.endsWith(SOURCE_SUFFIX)) continue;
    const match = NAME.exec(file.name);
    if (!match) continue;
    const version = match[1];
    if (!names.has(`IFCx-Revit-2026-${version}${SOURCE_SUFFIX}`)) continue;
    if (!best || file.mtimeMs > best.file.mtimeMs) best = { file, version };
  }
  if (!best) return null;
  return {
    file: best.file.name,
    version: best.version,
    sizeMB: Math.round(best.file.size / (1024 * 1024)),
    source: `IFCx-Revit-2026-${best.version}${SOURCE_SUFFIX}`,
  };
}
