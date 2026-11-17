// Docs mode: a file explorer of the chosen folder. Left: folder tree; center: table. There is no
// registry, metadata, versions or viewer: what you see is what is on the disk.
import { errorMessage, fileName } from '../model/open';
import { askText } from '../shell/dialog';
import { mountDocExplorer, type Explorer } from './explorer';
import { mountDocTree } from './treepanel';
import { EMPTY_TREE, joinPath, type DiskTree } from './scan';

/** Everything the mode needs from outside; the `rel` paths are relative to the project folder. */
export interface DocsActions {
  /** Project folder; null if it has not been chosen yet. */
  folder(): string | null;
  /** What is on the disk now. */
  scan(): Promise<DiskTree>;
  pickFile(): Promise<string | null>;
  /** Copia un archivo de fuera al proyecto. */
  addFile(src: string, rel: string): Promise<void>;
  /** Crea una carpeta nueva en el disco. */
  makeFolder(rel: string): Promise<void>;
  /** Opens the file with the default application of the system. */
  openFile(rel: string): Promise<void>;
  /** Abre un `.ifcx` como modelo en Studio. */
  openModel(rel: string): Promise<void>;
}

export interface DocsModeDeps {
  actions: DocsActions;
  toast(message: string, kind?: 'info' | 'error'): void;
  /** For tests: replaces the folder-name dialog. */
  askName?(title: string, label: string): Promise<string | null>;
}

export interface DocsMode {
  /** 0 = tree, 3 = center (table). The other slots are not used. */
  panel(slot: number): HTMLElement | null;
  enter(): void;
  refresh(): void;
  newFolder(): Promise<void>;
  upload(): Promise<void>;
  open(): Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createDocsMode(d: DocsModeDeps): DocsMode {
  const askName = d.askName ?? askText;
  const hosts: (HTMLElement | null)[] = [el('div', 'doc-host'), null, null, el('div', 'doc-host doc-center')];
  const [treeHost, , , centerHost] = hosts as [HTMLElement, null, null, HTMLElement];
  const tableHost = el('div', 'doc-table-host');
  centerHost.append(tableHost);

  /** What is on the disk; it is read again on every refresh. */
  let disk: DiskTree = EMPTY_TREE;
  let scanning = 0;
  /** Folder being viewed ('' = the project one). */
  let folder = '';
  /** El archivo elegido, por su ruta. */
  let selectedPath: string | null = null;

  /** Name of the project folder: the root of the tree and the first breadcrumb. */
  const projectName = (): string => {
    const dir = d.actions.folder();
    return (dir ? dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '') || 'Project';
  };

  const tree = mountDocTree(treeHost, {
    onSelect: (f) => explorer.navigate(f),
  });
  const explorer: Explorer = mountDocExplorer(tableHost, {
    tree: () => disk,
    rootName: projectName,
    onNavigate: (f) => {
      folder = f;
      tree.setSelected(f);
    },
    onOpen: (path) => {
      selectedPath = path;
      explorer.setSelected(path);
      void open();
    },
  });

  /** Pinta con lo que se sabe; el archivo elegido se mantiene. */
  function render(): void {
    tree.setRoot(projectName());
    tree.setFolders(disk.folders);
    explorer.setSelected(selectedPath);
  }

  async function rescan(): Promise<void> {
    const turn = ++scanning;
    if (!d.actions.folder()) {
      disk = EMPTY_TREE;
      return render();
    }
    try {
      const next = await d.actions.scan();
      if (turn !== scanning) return;
      disk = next;
      // the folder that was being viewed no longer exists (it was deleted or moved outside Studio): it goes back to the project one
      if (folder && !disk.folders.includes(folder)) explorer.navigate('');
    } catch (e) {
      if (turn === scanning) d.toast(`Could not read the project folder: ${errorMessage(e)}`, 'error');
    }
    if (turn !== scanning) return;
    render();
  }

  /** Vuelve a leer el disco. */
  function refresh(): void {
    render();
    void rescan();
  }

  async function open(): Promise<void> {
    const path = explorer.selected() ?? selectedPath;
    if (!path) return d.toast('Select a file first', 'info');
    try {
      // un IFCx es un modelo: se abre en Studio
      if (/\.ifcx$/i.test(path)) await d.actions.openModel(path);
      else await d.actions.openFile(path);
    } catch (e) {
      d.toast(`Could not open ${fileName(path)}: ${errorMessage(e)}`, 'error');
    }
  }

  /** File or folder name valid on any system: no separators or reserved characters. */
  const validName = (name: string): boolean => !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..';

  async function newFolder(): Promise<void> {
    if (!d.actions.folder()) return d.toast('Choose the project folder first', 'info');
    const name = (await askName('New Folder', 'Folder name'))?.trim();
    if (!name) return;
    if (!validName(name)) return d.toast('A folder name cannot contain \\ / : * ? " < > |', 'info');
    try {
      await d.actions.makeFolder(joinPath(folder, name));
    } catch (e) {
      return d.toast(`Could not create the folder: ${errorMessage(e)}`, 'error');
    }
    refresh();
  }

  async function upload(): Promise<void> {
    if (!d.actions.folder()) return d.toast('Choose the project folder first', 'info');
    const src = await d.actions.pickFile();
    if (!src) return;
    const original = fileName(src);
    const rel = joinPath(folder, original);
    if (disk.files.some((f) => f.path.toLowerCase() === rel.toLowerCase())) {
      return d.toast(`${original} is already in this folder`, 'info');
    }
    try {
      await d.actions.addFile(src, rel);
    } catch (e) {
      return d.toast(`Could not store the file: ${errorMessage(e)}`, 'error');
    }
    selectedPath = rel;
    refresh();
  }

  return {
    panel: (slot) => hosts[slot] ?? null,
    enter() { refresh(); },
    refresh,
    newFolder,
    upload,
    open,
  };
}
