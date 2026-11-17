// What the workspace can ask for: each panel and mode receives its commands, and here they are connected
// to the document controller and to the disk. The workspace knows neither of the two.

import { listLibrary, saveLibraryFolder, savedLibraryFolder } from '../library/disk';
import { pickQuoteFile, readQuoteFile } from '../costs/disk';
import { errorMessage, fileName } from '../model/open';
import { pickScheduleFile, saveScheduleFile } from '../schedule/disk';
import type { DocumentController } from '../document/controller';
import { stairOf } from '../modeling/document';
import type { Viewer } from '../render/viewer';
import { askConfirm } from '../shell/dialog';
import { toast } from '../shell/toast';
import { openModelWindow } from '../shell/windows';
import type { AssistantPanel, WorkspaceOptions } from '../workspace/workspace';
import type { DocumentFlow } from './documents';
import { pickFolderOrWarn } from './pickers';
import { exitApp } from './window';

export interface WorkspaceWiring {
  /** The controller is created after the workspace: it is queried when used. */
  doc(): DocumentController;
  flow: DocumentFlow;
  modeHost: HTMLElement;
  assistant?: AssistantPanel;
  /** The library folder changed in the Library panel. */
  onLibraryFolderChange(dir: string | null): void;
  showCollection(): void;
}

export function workspaceOptions(w: WorkspaceWiring): WorkspaceOptions<Viewer> {
  const doc = w.doc;
  return {
    modeHost: w.modeHost,
    // Open de una referencia: el archivo va a su propia ventana y esta sigue con su modelo
    openReference: (p) =>
      void openModelWindow(p).catch((e) => toast(`Could not open ${fileName(p)}: ${errorMessage(e)}`, 'error')),
    materials: {
      nodes: () => doc().materialNodes,
      setMaterial: (code, def) => doc().setMaterial(code, def),
      promoteMaterial: (code) => doc().promoteMaterial(code),
      resetMaterial: (code) => doc().resetMaterial(code),
      duplicateMaterial: (code) => doc().duplicateMaterial(code),
      deleteMaterial: (code) => doc().deleteMaterial(code),
      assignMaterial: (paths, code, label) => doc().assignMaterial(paths, code, label),
      confirm: askConfirm,
    },
    schedule: {
      state: () => doc().schedule,
      change: (label, change) => doc().changeSchedule(label, change),
      materials: () => doc().materialNodes.map((n) => n.def),
      confirm: askConfirm,
      importFile: pickScheduleFile,
      exportFile: saveScheduleFile,
    },
    costs: {
      materials: () => doc().materialNodes.map((n) => n.def),
      saveFile: (location, label, change) => doc().changeImportedFile(location, label, change),
      assign: (label, change) => doc().changeCostAssignment(label, change),
      confirm: askConfirm,
      openQuote: pickQuoteFile,
      readQuote: readQuoteFile,
    },
    assistant: w.assistant,
    fileMenu: {
      onOpen: () => void w.flow.openDialog(),
      onSave: () => void doc().save(),
      onSaveAs: () => void doc().saveAs(),
      canSave: () => doc().session !== null,
      onClose: () => void w.flow.closeDocument(),
      onExit: exitApp,
      recents: w.flow.recents,
      onOpenRecent: (e) => void w.flow.openFile(e.path),
    },
    composer: {
      onAdd: () => void w.flow.addLayerDialog(),
      onToggle: (id, on) => void doc().setLayerEnabled(id, on),
      onToggleEdits: (id, on) => void doc().setEditsEnabled(id, on),
      onRemove: (id) => void doc().unlink(id),
      onRemoveEdit: (layerId, path) => void doc().removeEdit(layerId, path),
      onMoveLayer: (id, toIndex) => void doc().moveLayer(id, toIndex),
      onRelink: (id) => void w.flow.relinkDialog(id),
      moveBy: (t, d) => doc().moveBy(t, d),
      moveTo: (t, p) => doc().moveTo(t, p),
      rotateTo: (t, r) => doc().rotateTo(t, r),
      scaleTo: (t, sc) => doc().scaleTo(t, sc),
      reparent: (layerId, origin, newParentOrigin, at) => doc().reparent(layerId, origin, newParentOrigin, at),
      setLinkedAttr: (layerId, node, key, value) => doc().setLinkedAttr(layerId, node, key, value),
      resetLinkedAttr: (layerId, node, key) => doc().resetLinkedAttr(layerId, node, key),
      linkedAttrEdited: (layerId, node, key) => doc().linkedAttrEdited(layerId, node, key),
      setLinkedVariant: (layerId, node, set, option) => doc().setLinkedVariant(layerId, node, set, option),
      resetLinkedVariant: (layerId, node, set) => doc().resetLinkedVariant(layerId, node, set),
      linkedVariantEdited: (layerId, node, set) => doc().linkedVariantEdited(layerId, node, set),
      setPayloadLoaded: (uri, on, layerId) => doc().setPayloadLoaded(uri, on, layerId),
      onPlace: (layerId, parentOrigin) => void doc().place(layerId, parentOrigin),
      placeAsset: (path, parentOrigin, at) => doc().placeFile(path, parentOrigin, at),
      linkAsset: (path) => doc().linkFile(path),
      onUnplace: (layerId) => void doc().unplace(layerId),
    },
    library: {
      folder: savedLibraryFolder(),
      chooseFolder: pickFolderOrWarn,
      list: listLibrary,
      onFolderChange: (dir) => {
        saveLibraryFolder(dir);
        w.onLibraryFolderChange(dir);
      },
      onOpenCollection: w.showCollection,
    },
    editor: {
      addWall: (start, end, levelId) => doc().editor.addWall(start, end, levelId),
      deleteWall: (id) => doc().editor.deleteWall(id),
      addFloor: (boundary, levelId) => doc().editor.addFloor(boundary, levelId),
      deleteFloor: (id) => doc().editor.deleteFloor(id),
      deleteStair: (id) => doc().editor.deleteStair?.(id),
    },
    studio: {
      levels: () => doc().session?.doc.levels ?? [],
      wall: (id) => doc().session?.doc.walls.find((x) => x.id === id),
      walls: () => doc().session?.doc.walls ?? [],
      floor: (id) => doc().session?.doc.floors.find((f) => f.id === id),
      stair: (id) => {
        const s = doc().session;
        return s ? stairOf(s.doc, id) : undefined;
      },
      placement: (id) => doc().session?.doc.composer.placements.find((p) => p.id === id),
      placementBase: (p) => doc().placementBase(p),
      addLevel: () => doc().addLevel(),
      renameLevel: (id, name) => doc().renameLevel(id, name),
      setLevelElevation: (id, elevation) => doc().setLevelElevation(id, elevation),
      setWallConstraints: (id, patch) => doc().setWallConstraints(id, patch),
      setFloorConstraints: (id, patch) => doc().setFloorConstraints(id, patch),
    },
  };
}
