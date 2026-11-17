import type { IfcxFile } from '../../ifcx/types';
import type { Viewer } from '../../render/viewer';
import type { LibraryEntry } from '../../library/librarypanel';
import type { Indexer, IndexerDeps } from '../indexer';
import { type CardStore } from '../store';

export interface CollectionCallbacks {
  list(dir: string): Promise<LibraryEntry[]>;
  /** Folder dialog; null if cancelled. */
  chooseFolder(): Promise<string | null>;
  onFolderChange(dir: string | null): void;
  onBack(): void;
  /** Place the card in the document (the Collection is no longer shown afterwards). */
  onPlace(path: string): void;
}

/** El visor vivo de la carta grande. */
export type CardViewer = Pick<Viewer, 'setModel' | 'setLod' | 'fit' | 'disposeModel'> & { dispose?(): void };

export interface CollectionDeps {
  /** Creates the indexer with the warnings of the screen (called once, when mounting). */
  createIndexer(handlers: Pick<IndexerDeps, 'onCard' | 'onProgress'>): Indexer;
  store: CardStore;
  renderThumb(file: IfcxFile): string | null;
  createViewer(host: HTMLElement): CardViewer;
  /** Cards per page (PAGE_SIZE by default): only those of the current page are in the DOM. */
  pageSize?: number;
}

export interface Collection {
  /** Recorre la carpeta y lanza el indexador. Resuelve cuando ya se ha recorrido. */
  setFolder(dir: string | null): Promise<void>;
  /** Sin documento abierto no se puede colocar. */
  setCanPlace(on: boolean): void;
  /** The screen is shown: it resumes the indexing if it was left half done. */
  onShow(): void;
  /** La pantalla se oculta: cancela el indexado y cierra la carta grande. */
  onHide(): void;
}
