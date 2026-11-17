// Ciclo de vida del documento abierto: abrir, nuevo, cerrar, Inicio con recientes y recarga en vivo
// when the file changes on disk. What is done with the already open document belongs to the controller.

import { unreportedWarnings } from '../composer/stack';
import { loadAddin, showAddinDialog, type AddinInfo } from '../home/addin';
import { exampleOf, renderHome, type ExampleEntry } from '../home/home';
import { openRecentsSafe, type RecentsLike } from '../home/safe-recents';
import type { LoadedModel } from '../model/load';
import { errorMessage, fileMtime, fileName, openPath, pathExists } from '../model/open';
import { isWeb } from '../platform/env';
import { files } from '../platform/files';
import { isSchemaWarning } from '../model/validate';
import { createFileWatcher } from '../model/watch';
import type { DocumentController } from '../document/controller';
import type { EditSession } from '../modeling/session';
import { hideLoading, nextPaint, setLoadingText, showLoading } from '../shell/loading';
import { setDocumentTitle, type Screen } from '../shell/screens';
import { toast } from '../shell/toast';
import type { Workspace } from '../workspace/workspace';
import { importWarningToast } from './load-warnings';
import { pickModelOrWarn } from './pickers';

export interface DocumentFlowDeps {
  /** The controller is created later (it needs `saved`): it is queried when used. */
  doc(): DocumentController;
  /** It is read when used: the workspace is mounted later. */
  readonly ws: Pick<Workspace, 'viewer' | 'agent'>;
  home: HTMLElement;
  goScreen(s: Screen): void;
  showCollection(): void;
  showDocuments(): void;
}

export interface DocumentFlow {
  openFile(path: string): Promise<void>;
  openDialog(): Promise<void>;
  /** New…: documento de Studio con Level 1, editable y con su planta abierta. */
  newModel(): Promise<void>;
  /** Home: with unsaved changes it asks first (the document stays open behind). */
  goHome(): Promise<void>;
  /** Archivo › Cerrar: libera el modelo y vuelve a Inicio. */
  closeDocument(): Promise<void>;
  /** Layer › +: elige un .ifcx y lo enlaza encima del documento abierto. */
  addLayerDialog(): Promise<void>;
  /** Layer › Relink…: chooses the new location of a linked file. */
  relinkDialog(id: string): Promise<void>;
  /** Tras guardar: la fecha nueva es la referencia (un guardado propio no se recarga) y la ruta pudo cambiar. */
  saved(m: LoadedModel): Promise<void>;
  /** Recently opened files, for Home and the File menu. */
  recents(): ReturnType<RecentsLike['list']>;
  /** Pinta Inicio y carga la lista de recientes. */
  startHome(): Promise<void>;
}

export function createDocumentFlow(d: DocumentFlowDeps): DocumentFlow {
  const { goScreen } = d;
  let recents: RecentsLike | null = null;
  let busy = false;
  let addin: AddinInfo | null = null;
  let addinLoaded = false;

  const homeActions = () => {
    const current = addin;
    return {
      onOpen: () => void openDialog(),
      onNew: () => void newModel(),
      onOpenRecent: (e: { path: string }) => void openFile(e.path),
      onRemoveRecent: (path: string) => void removeRecent(path),
      onOpenExample: (e: ExampleEntry) => void openFile(e.path),
      onCollection: () => d.showCollection(),
      onDocuments: () => d.showDocuments(),
      ...(current ? { onRevitAddin: () => showAddinDialog(current) } : {}),
    };
  };

  /** Manifest of the Revit add-in (web demo only); if it is missing, Home is painted without the button. */
  async function loadRevitAddin(): Promise<void> {
    if (!isWeb() || addinLoaded) return;
    addinLoaded = true;
    addin = await loadAddin(import.meta.env.BASE_URL);
  }

  /** Example models on Home (web demo only); if they cannot be read, they are not shown. */
  async function loadExamples(): Promise<ExampleEntry[]> {
    try {
      return ((await files().examples?.()) ?? []).map(exampleOf);
    } catch (e) {
      console.warn('Could not read the example models:', e);
      return [];
    }
  }

  async function refreshHome(): Promise<void> {
    const list = recents?.list() ?? [];
    const marked = await Promise.all(list.map(async (r) => ({ ...r, missing: !(await pathExists(r.path)) })));
    renderHome(d.home, marked, homeActions(), await loadExamples());
  }

  async function removeRecent(path: string): Promise<void> {
    try {
      await recents?.remove(path);
    } catch (e) {
      console.warn('No se pudo guardar la lista de recientes:', e);
    }
    await refreshHome();
  }

  async function remember(m: LoadedModel): Promise<void> {
    if (!m.path || !recents) return; // solo los archivos de disco van a recientes
    let thumbnail: string | null = null;
    try {
      thumbnail = d.ws.viewer.thumbnail(m.result.root.children.map((c) => c.path), 320, 240);
    } catch (e) {
      console.warn('No se pudo generar la miniatura:', e);
    }
    try {
      await recents.add({ path: m.path, name: m.name, openedAt: Date.now(), thumbnail });
    } catch (e) {
      console.warn('No se pudo guardar la lista de recientes:', e);
    }
  }

  /** Shows the model and returns the one left on screen (with the linked layers composed). */
  async function showModel(loaded: LoadedModel, session: EditSession | null): Promise<LoadedModel> {
    // reads and composes the linked files; it also sets the title with the {3D} view
    const m = await d.doc().opened(loaded, session);
    goScreen('workspace');
    // the linked files that were not found were already reported, one by one
    const warnings = unreportedWarnings(m.warnings);
    // the buildingSMART viewer would not open the file: the first failure is reported
    const schema = warnings.filter(isSchemaWarning);
    if (schema.length) {
      for (const w of schema) console.warn(`${m.name}: ${w}`);
      const more = schema.length > 1 ? ` (+${schema.length - 1} more, see console)` : '';
      toast(`${m.name} is not valid IFCX: ${schema[0]}${more}`, 'error');
    }
    // web demo: a model opened on its own without its companions looks incomplete; the missing ones are named
    const missing = isWeb() ? importWarningToast(m.name, warnings) : null;
    if (missing) {
      for (const w of missing.log) console.warn(`${m.name}: ${w}`);
      toast(missing.message, 'error');
    }
    const rest = warnings.length - schema.length - (missing?.log.length ?? 0);
    if (rest) toast(`${m.name}: ${rest} ${rest === 1 ? 'warning' : 'warnings'} on load`, 'info');
    return m;
  }

  // Live reload: the open file changed on disk (the Assistant, a script or another app).
  let warnedDirty = false;
  const fileWatcher = createFileWatcher({
    mtime: fileMtime,
    onChange: async (p) => {
      // also in read-only: the path is that of the open model, whether or not it has an editable session
      if (busy || d.ws.agent.model()?.path !== p) return;
      if (d.doc().session?.dirty) {
        // unsaved changes are not overwritten: it warns once per change
        if (!warnedDirty) toast(`${fileName(p)} changed on disk. Save or close your changes to see it.`, 'info');
        warnedDirty = true;
        return;
      }
      warnedDirty = false;
      const { model, session } = await openPath(p); // it rejects if it is half written: it is retried
      await d.doc().opened(model, session, { keepView: true });
    },
  });

  async function openFile(path: string): Promise<void> {
    if (busy) {
      toast('A model is already opening', 'info');
      return;
    }
    busy = true;
    const name = fileName(path);
    try {
      if (!(await d.doc().confirmDiscard())) return;
      showLoading(`Opening ${name}…`);
      await nextPaint(); // so that the notice is painted before the synchronous work
      const { model, session, studioUnreadable } = await openPath(path);
      setLoadingText('Building geometry…');
      await nextPaint();
      const shown = await showModel(model, session);
      fileWatcher.watch(model.path);
      if (studioUnreadable) {
        toast(`${name} was created in Dream BIM but could not be read for editing; opened read-only.`, 'info');
      }
      // the thumbnail is drawn from the viewer: its roots are those of the composed model, not those of the file alone
      await remember({ ...model, result: shown.result });
    } catch (e) {
      toast(`Could not open ${name}: ${errorMessage(e)}`, 'error');
    } finally {
      hideLoading();
      busy = false;
    }
    await refreshHome();
  }

  async function openDialog(): Promise<void> {
    const path = await pickModelOrWarn();
    if (path) await openFile(path);
  }

  async function newModel(): Promise<void> {
    const doc = d.doc();
    if (busy || !(await doc.confirmDiscard())) return;
    try {
      await doc.newDocument();
      fileWatcher.watch(null);
      goScreen('workspace');
    } catch (e) {
      toast(`Could not create the model: ${errorMessage(e)}`, 'error');
    }
  }

  function showHome(): void {
    goScreen('home');
    setDocumentTitle(null, null);
  }

  return {
    openFile,
    openDialog,
    newModel,
    goHome: async () => {
      if (await d.doc().confirmDiscard()) showHome();
    },
    closeDocument: async () => {
      const doc = d.doc();
      if (!(await doc.confirmDiscard())) return;
      doc.closed();
      fileWatcher.watch(null);
      showHome();
    },
    addLayerDialog: async () => {
      if (!d.doc().hasDocument) return;
      const path = await pickModelOrWarn();
      if (path) await d.doc().linkFile(path); // los fallos ya avisan con un toast
    },
    relinkDialog: async (id) => {
      if (!d.doc().hasDocument) return;
      const path = await pickModelOrWarn();
      if (path) await d.doc().relink(id, path); // los fallos ya avisan con un toast
    },
    saved: (m) => {
      fileWatcher.watch(m.path);
      return remember(m).then(refreshHome);
    },
    recents: () => recents?.list() ?? [],
    startHome: async () => {
      // it is painted empty at once; the recents arrive when its store opens
      renderHome(d.home, [], { ...homeActions(), onOpenRecent: () => {}, onRemoveRecent: () => {} });
      recents = await openRecentsSafe();
      await loadRevitAddin();
      await refreshHome();
    },
  };
}
