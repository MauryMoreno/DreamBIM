// Asistente: lo que el agente de BuiltBot puede consultar y manejar de la app.

import { connectStudio } from '../assistant/builtbot/studio-link';
import { createExecutor, type StudioExecutor } from '../assistant/studio/executor';
import { createLiveHost } from '../assistant/studio/live-host';
import { scaleDataUrl } from '../assistant/studio/scale';
import { cardKey, type CardStore } from '../collection/store';
import { samePath } from '../home/recents';
import { searchLibrary } from '../library/disk';
import type { LibraryEntry } from '../library/librarypanel';
import type { DocumentController } from '../document/controller';
import { ForeignSession } from '../modeling/foreign';
import type { Workspace } from '../workspace/workspace';

export interface AssistantWiring {
  ws: Pick<Workspace, 'agent'>;
  doc: DocumentController;
  /** Abre un modelo; los fallos ya avisan al usuario con un toast. */
  openFile(path: string): Promise<void>;
  cards: CardStore;
}

/** El ejecutor de la herramienta Studio sobre la app real: la misma en escritorio y en la demo web. */
export function buildExecutor({ ws, doc, openFile, cards }: AssistantWiring): StudioExecutor {
  return createExecutor(
    createLiveHost({
      ws: ws.agent,
      doc: {
        get hasDocument() {
          return doc.hasDocument;
        },
        isDirty: () => doc.session?.dirty ?? false,
        idle: () => doc.idle(),
        editable: () => (doc.session === null ? 'readonly' : doc.session instanceof ForeignSession ? 'foreign' : 'studio'),
      },
      edit: {
        asAgent: (fn) => doc.asAgent(fn),
        editPaths: (p) => doc.editPaths(p),
        setColors: (paths, c, label) => doc.setColors(paths, c, label),
        assignMaterial: (paths, code, label) => doc.assignMaterial(paths, code, label),
        setMaterial: (code, def) => doc.setMaterial(code, def),
        buildModel: (req) => doc.buildModel(req),
        placeAssets: (req, dryRun) => doc.placeAssets(req, dryRun),
        stairSpots: (q) => doc.stairSpots(q),
        placeStairs: (req, dryRun) => doc.placeStairs(req, dryRun),
        elementIds: (paths) => doc.elementIds(paths),
        removeElements: (ids, label) => doc.removeElements(ids, label),
        reviewPlan: (plan) => doc.reviewPlan(plan),
        reviewModel: (opts) => doc.reviewModel(opts),
      },
      openPath: async (path) => {
        await openFile(path);
        if (!samePath(ws.agent.model()?.path ?? '', path)) {
          throw new Error(`Could not open '${path}'; the user has been shown the reason`);
        }
      },
      searchLibrary: (query, limit) =>
        searchLibrary(ws.agent.libraryFolder() ?? '', query, limit) as Promise<{ path: string; name: string; mtime: number }[]>,
      cardInfo: async (path, mtime) => (await cards.get(cardKey({ path, mtime } as LibraryEntry)))?.info ?? null,
      scale: scaleDataUrl,
    }),
  );
}

/** Connects the Studio tool of the agent and the edit lock during each BuiltBot turn. */
export function connectAssistant(w: AssistantWiring): void {
  void connectStudio({ executor: buildExecutor(w), setLock: (on) => w.doc.setUserLock(on) });
}
