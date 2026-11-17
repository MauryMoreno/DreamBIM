// Collection screen (the library as cards) and the switch between screens, which notifies it when leaving.

import { mountCollection } from '../collection/collection';
import { createIndexer } from '../collection/indexer';
import type { CardStore } from '../collection/store';
import { createThumbRenderer } from '../collection/thumbs';
import { listLibrary, saveLibraryFolder, savedLibraryFolder } from '../library/disk';
import { createLinkedParser } from '../model/parse-client';
import { readTextFile } from '../model/open';
import { Viewer } from '../render/viewer';
import { showScreen, type Screen } from '../shell/screens';
import type { Workspace } from '../workspace/workspace';
import { pickFolderOrWarn } from './pickers';

export interface CollectionScreenDeps {
  host: HTMLElement;
  store: CardStore;
  ws: Pick<Workspace, 'setLibraryFolder' | 'placeAsset'>;
  hasDocument(): boolean;
}

export interface CollectionScreen {
  /** Switches screen; when leaving the Collection its indexing is stopped and the big card is closed. */
  goScreen(s: Screen): void;
  /** Shows the Collection; Back returns to the screen it comes from. */
  show(): void;
  /** The library folder changed elsewhere: the Collection reads it again when it opens. */
  forgetFolder(): void;
}

export function mountCollectionScreen(d: CollectionScreenDeps): CollectionScreen {
  /** Folder the Collection was loaded with (undefined: not loaded yet or it must be read again). */
  let folder: string | null | undefined;
  /** Screen it comes from, for the Back button. */
  let cameFrom: 'home' | 'workspace' = 'home';
  const parser = createLinkedParser();

  const collection = mountCollection(
    d.host,
    {
      list: listLibrary,
      chooseFolder: pickFolderOrWarn,
      onFolderChange: (dir) => {
        saveLibraryFolder(dir);
        folder = dir;
        void d.ws.setLibraryFolder(dir);
      },
      onBack: () => goScreen(cameFrom),
      onPlace: (path) => {
        goScreen('workspace');
        d.ws.placeAsset(path);
      },
    },
    {
      createIndexer: (handlers) => createIndexer({ store: d.store, readText: readTextFile, parse: parser, ...handlers }),
      store: d.store,
      renderThumb: createThumbRenderer((h) => new Viewer(h)),
      createViewer: (h) => new Viewer(h),
    },
  );

  function goScreen(s: Screen): void {
    if (document.body.dataset.screen === 'collection' && s !== 'collection') collection.onHide();
    showScreen(s);
  }

  function show(): void {
    const from = document.body.dataset.screen;
    if (from === 'home' || from === 'workspace') cameFrom = from;
    goScreen('collection');
    collection.setCanPlace(d.hasDocument());
    const dir = savedLibraryFolder();
    if (dir !== folder) {
      folder = dir;
      void collection.setFolder(dir);
    } else collection.onShow();
  }

  return { goScreen, show, forgetFolder: () => (folder = undefined) };
}
