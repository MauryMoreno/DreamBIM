// File and folder dialogs that warn with a toast if they cannot be opened.

import { pickFolder } from '../library/disk';
import { errorMessage, pickPath } from '../model/open';
import { toast } from '../shell/toast';

async function orWarn(pick: () => Promise<string | null>): Promise<string | null> {
  try {
    return await pick();
  } catch (e) {
    toast(`Could not open the dialog: ${errorMessage(e)}`, 'error');
    return null;
  }
}

/** Open dialog for .ifcx. null if cancelled or it fails (already reported). */
export const pickModelOrWarn = (): Promise<string | null> => orWarn(pickPath);

/** Folder dialog. null if cancelled or it fails (already reported). */
export const pickFolderOrWarn = (): Promise<string | null> => orWarn(pickFolder);
