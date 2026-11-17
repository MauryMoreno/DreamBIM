
export interface LibraryEntry {
  name: string;
  /** Ruta absoluta. */
  path: string;
  isDir: boolean;
  /** Last modification, ms since the Unix epoch (0 if unknown). */
  mtime?: number;
}

export interface LibraryCallbacks {
  /** Folder dialog; null if cancelled. */
  chooseFolder(): Promise<string | null>;
  /** Contenido de una carpeta (lanza si no se puede leer). */
  list(dir: string): Promise<LibraryEntry[]>;
  /** The root folder changed (to remember it between sessions). */
  onFolderChange?(dir: string | null): void;
  /** Doble clic o Enter sobre un archivo: enlazarlo. */
  onActivate(path: string): void;
  /** Opens the Collection screen (the cards as trading cards); without this the button does not appear. */
  onOpenCollection?(): void;
}

export interface LibraryPanel {
  /** Root folder of the library (null: none). Resolves once it has been listed. */
  setFolder(dir: string | null): Promise<void>;
  /** Sin documento abierto las fichas no se arrastran ni se activan. */
  setEnabled(on: boolean): void;
  /** Vuelve a leer la carpeta en curso. */
  refresh(): Promise<void>;
}
