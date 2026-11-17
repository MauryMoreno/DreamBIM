// Composition root: it creates each piece of the app and connects them. It is the only place that knows them all.

import { BUILTBOT_WEB_SRC, mountBuiltBotColumn } from '../assistant/builtbot/column';
import { installRelay } from '../assistant/builtbot/relay';
import { indexedDbStore, memoryStore } from '../collection/store';
import { pickSavePath, readTextFile, writeTextFile, pathExists } from '../model/open';
import { isWeb } from '../platform/env';
import { createLinkedParser } from '../model/parse-client';
import { DocumentController } from '../document/controller';
import { observeLongTasks, perfReport, perfReset } from '../render/perf';
import { askConfirm, askSaveChanges } from '../shell/dialog';
import { openHelp } from '../help/help';
import { offerTourOnce, openTour } from '../tour/tour';
import { mountDemoBanner } from '../shell/demo-banner';
import { mountShell, setDocumentTitle } from '../shell/screens';
import { mountTitlebar } from '../shell/titlebar';
import { toast } from '../shell/toast';
import { startupPath } from '../shell/windows';
import { samePath } from '../home/recents';
import { mountWorkspace, type Workspace } from '../workspace/workspace';
import { buildExecutor, connectAssistant } from './assistant';
import { connectWebAssistant } from './assistant-web';
import { mountCollectionScreen } from './collection-screen';
import { mountDocsScreen } from './docs-screen';
import { createDocumentFlow } from './documents';
import { installShortcuts } from './shortcuts';
import { guardClose, onOpenModelRequest } from './window';
import { workspaceOptions } from './workspace-options';

export async function start(rootEl: HTMLElement): Promise<void> {
  const shell = mountShell(rootEl);
  // Model window opened from a reference (?open=): it starts on that model and without Assistant, which
  // le habla a la app entera y solo debe atenderlo la ventana principal.
  const startup = startupPath(location.search);
  const secondary = startup !== null;
  // El Asistente (BuiltBot) lo atiende la ventana principal; la demo web lo lleva sin Tauri (app/assistant-web.ts)
  const noAssistant = secondary;
  if (isWeb()) mountDemoBanner(document.body);
  // the BuiltBot iframe listens to the Tauri events through this relay (see builtbot/shim.ts)
  if (!noAssistant && !isWeb()) installRelay(window);

  // The pieces need each other (the controller paints in the workspace, whose commands go to the
  // controller): each one queries the others when used, not when created.
  const doc = (): DocumentController => controller;
  const noModel = () => {
    if (doc().hasDocument) return false;
    toast('No model is open', 'info');
    return true;
  };

  // Help (the button and F1): the layers guide, with the entry to the guided tour
  const help = () => void openHelp({ onTour: () => void openTour() });

  // The title bar goes before the workspace: it gives it the slot of the mode tabs.
  const titlebar = mountTitlebar(shell.titlebar, {
    onUndo: () => void doc().undo(),
    onRedo: () => void doc().redo(),
    onOpen: () => void flow.openDialog(),
    onHome: () => void flow.goHome(),
    on3D: () => {
      if (noModel()) return;
      collection.goScreen('workspace');
      ws.show3D();
    },
    onAssistant: noAssistant
      ? undefined
      : () => {
          if (noModel()) return;
          collection.goScreen('workspace');
          ws.toggleAssistant();
        },
    onHelp: help,
  });

  const flow = createDocumentFlow({
    doc,
    get ws() {
      return ws;
    },
    home: shell.home,
    goScreen: (s) => collection.goScreen(s),
    showCollection: () => collection.show(),
    showDocuments: () => void docsScreen.show(),
  });

  const ws: Workspace = mountWorkspace(
    shell.workspace,
    workspaceOptions({
      doc,
      flow,
      modeHost: titlebar.modeHost,
      assistant: noAssistant ? undefined : mountBuiltBotColumn(isWeb() ? { src: BUILTBOT_WEB_SRC } : {}),
      onLibraryFolderChange: () => collection.forgetFolder(),
      showCollection: () => collection.show(),
    }),
  );
  exposePerf(ws);

  const controller: DocumentController = new DocumentController({
    ws,
    pickSavePath,
    askSaveChanges,
    toast,
    remember: flow.saved,
    readText: readTextFile,
    writeText: writeTextFile,
    exists: pathExists,
    parseLinked: createLinkedParser(),
    confirm: askConfirm,
    onHistory: (h) => titlebar.setHistory(h),
    onLocked: () => toast('The assistant is working. Press Stop to edit.', 'info'),
  });

  const cards = isWeb() ? memoryStore() : indexedDbStore();
  const collection = mountCollectionScreen({ host: shell.collection, store: cards, ws, hasDocument: () => doc().hasDocument });

  const docsScreen = mountDocsScreen({ host: shell.docs, onBack: () => collection.goScreen('home'), onOpenModel: (p) => flow.openFile(p) });

  if (!noAssistant) {
    const wiring = { ws, doc: controller, openFile: flow.openFile, cards };
    if (isWeb()) connectWebAssistant({ executor: buildExecutor(wiring), setLock: (on) => controller.setUserLock(on), win: window });
    else connectAssistant(wiring);
  }

  guardClose(() => controller.confirmDiscard());
  installShortcuts({
    hasDocument: () => controller.hasDocument,
    save: () => void controller.save(),
    saveAs: () => void controller.saveAs(),
    undo: () => void controller.undo(),
    redo: () => void controller.redo(),
    help,
  });

  titlebar.setHistory(controller.history);
  setDocumentTitle(null, null);
  await flow.startHome();
  // primera vez: se ofrece el recorrido (solo en la ventana principal, no sobre un modelo que ya se abre)
  if (!secondary) offerTourOnce();

  if (startup) {
    // another window asked for this one again: if with File › Open it moved to another model, the request is opened
    onOpenModelRequest((path) => {
      if (!samePath(ws.agent.model()?.path ?? '', path)) void flow.openFile(path);
    });
    await flow.openFile(startup);
  }
}

/** Timing measurement (enabled with localStorage 'ifcx.perf' = '1'): __ifcxPerf.report() / reset() / frame(). */
function exposePerf(ws: Workspace): void {
  (globalThis as any).__ifcxPerf = {
    report: () => console.table(perfReport()),
    reset: perfReset,
    frame: () => {
      const s = ws.viewer.frameStats();
      console.table([s]);
      return s;
    },
  };
  observeLongTasks(); // tareas largas (>= 50 ms) como fila `longtask` en report()
}
