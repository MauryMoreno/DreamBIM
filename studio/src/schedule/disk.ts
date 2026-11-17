// Disk of the Schedule mode: choose the MS Project XML or the Primavera XER to import and save the
// MS Project XML exportado.
import { files } from '../platform/files';
import { fileName, readTextFile, writeTextFile } from '../model/open';

/** Dialog for an MS Project schedule (.xml) or Primavera P6 (.xer); null if cancelled. */
export async function pickScheduleFile(): Promise<{ name: string; text: string } | null> {
  const picked = await files().pickOpen([
    { name: 'Schedules', extensions: ['xml', 'xer'] },
    { name: 'Microsoft Project XML', extensions: ['xml'] },
    { name: 'Primavera P6 XER', extensions: ['xer'] },
  ]);
  if (picked === null) return null;
  return { name: fileName(picked), text: await readTextFile(picked) };
}

/** Save dialog of the MS Project XML; it writes the file and returns its name, or null if cancelled. */
export async function saveScheduleFile(suggested: string, text: string): Promise<string | null> {
  const picked = await files().pickSave(suggested, [{ name: 'Microsoft Project XML', extensions: ['xml'] }]);
  if (picked === null) return null;
  const path = picked.toLowerCase().endsWith('.xml') ? picked : `${picked}.xml`;
  await writeTextFile(path, text);
  return fileName(path);
}
