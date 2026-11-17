import { DOCUMENT_COLOR, nextColor, notFoundWarning, type ComposerLayer } from '../composer/stack';
import { loadLinked } from '../composer/uri';
import type { LoadedModel } from '../model/load';
import { errorMessage, fileName } from '../model/open';
import { BASE_URI, ForeignSession } from '../modeling/foreign';
import { readLegacySidecar } from '../materials/state';
import { EMPTY_SCHEDULE } from '../schedule/state';
import { EMPTY_COLORS } from '../colors/state';
import { readLegacyClassification, type ClassAssign } from '../classification/state';
import { sidecarFor } from '../modeling/sidecars';
import { newSession, type EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { SCHEDULE_LIB } from './shared';

/** Legacy materials sidecar: read only, to migrate it. */
const LEGACY_MATERIALS = { suffix: '.materials.ifcx' };

/** Legacy classification sidecar: read only, to migrate it. */
const LEGACY_CLASSIFICATION = { suffix: '.classification.ifcx' };

export class LifecycleService {
  constructor(private readonly ctx: DocumentContext) {}

  /** Forgets the stack of the previous document. */
  resetStack(): void {
    this.ctx.state.generation++;
    this.ctx.state.layers = [];
    this.ctx.state.files = new Map();
    this.ctx.state.payloads = new Map();
    this.ctx.state.libs = new Map();
    this.ctx.state.libsSaved = new Map();
    this.ctx.state.libsOrigin = new Map();
    this.ctx.state.legacyFiles = { doc: '', files: [] };
    this.ctx.state.scheduleState = EMPTY_SCHEDULE;
    this.ctx.state.scheduleSlot.file = null;
    this.ctx.state.colorsState = EMPTY_COLORS;
    this.ctx.state.sidecarExisted = new Set();
    this.ctx.state.baseLayer = null;
    this.ctx.state.undoStack = [];
    this.ctx.state.redoStack = [];
    this.ctx.state.version = 0;
    this.ctx.state.savedVersion = 0;
    this.ctx.history.pushHistory();
  }

  /** New document with Level 1: editable and with its plan open. */
  async newDocument(): Promise<void> {
    this.resetStack();
    const s = newSession();
    const model = await this.ctx.stack.build(s);
    this.show(model, s);
    this.ctx.d.ws.showPlan();
  }

  /**
   * A model opened from disk: editable only if it is from Studio (with a session). Before showing it,
   * it reads the document's linked files; a missing one warns and keeps its edits.
   * Resolves to the shown model (with the composed layers), or to the received one if another replaced it.
   */
  /**
   * `keepView`: the same document reloaded because it changed on disk; it is recomposed without closing tabs
   * or moving the camera (the history is forgotten anyway: it belonged to a file that is no longer the same).
   */
  async opened(model: LoadedModel, session: EditSession | null, opts: { keepView?: boolean } = {}): Promise<LoadedModel> {
    this.resetStack();
    const gen = this.ctx.state.generation;
    this.ctx.state.current = null; // while the links are read, the previous document is not edited
    this.ctx.state.open = false;
    this.ctx.state.base = model;
    const layers: ComposerLayer[] = [];
    for (const meta of session?.doc.composer.layers ?? []) {
      layers.push({ ...meta, id: this.ctx.stack.newLayerId(), color: meta.color || nextColor(layers) });
    }
    this.ctx.state.layers = layers;
    if (session instanceof ForeignSession) {
      this.ctx.state.baseLayer = {
        id: 'base', uri: BASE_URI, name: session.name, color: DOCUMENT_COLOR, enabled: true, editsEnabled: true, edits: [],
      };
    }
    const docPath = session?.path ?? model.path;
    let legacy: Record<string, string> = {};
    let legacyName = '';
    let legacyClass: Record<string, ClassAssign> = {};
    let legacyClassName = '';
    if (docPath && this.ctx.d.exists) {
      const oldClass = sidecarFor(docPath, LEGACY_CLASSIFICATION);
      try {
        if (await this.ctx.d.exists(oldClass)) {
          legacyClass = readLegacyClassification(JSON.parse(await this.ctx.d.readText(oldClass)));
          legacyClassName = fileName(oldClass);
        }
      } catch (e) {
        if (gen !== this.ctx.state.generation) return model;
        this.ctx.d.toast(`Could not read ${fileName(oldClass)}: ${errorMessage(e)}`, 'error');
      }
      const old = sidecarFor(docPath, LEGACY_MATERIALS);
      try {
        if (await this.ctx.d.exists(old)) {
          legacy = readLegacySidecar(JSON.parse(await this.ctx.d.readText(old)));
          legacyName = fileName(old);
        }
      } catch (e) {
        if (gen !== this.ctx.state.generation) return model;
        this.ctx.d.toast(`Could not read ${fileName(old)}: ${errorMessage(e)}`, 'error');
      }
      for (const slot of this.ctx.sidecars.slots()) {
        const side = sidecarFor(docPath, slot.kind);
        try {
          if (await this.ctx.d.exists(side)) {
            const value = slot.kind.fromFile(JSON.parse(await this.ctx.d.readText(side)));
            if (gen !== this.ctx.state.generation) return model;
            slot.set(value);
            this.ctx.state.sidecarExisted.add(slot.kind.suffix);
          }
        } catch (e) {
          if (gen !== this.ctx.state.generation) return model;
          this.ctx.d.toast(`Could not read ${fileName(side)}: ${errorMessage(e)}`, 'error');
        }
      }
    }
    if (session) this.ctx.stack.writeMeta(session); // assigned colors; does not count as a change
    // the document opens the same, but the next Save would write the empty stack
    if (session?.composerDamaged) {
      this.ctx.d.toast(`Linked layers in ${session.name} could not be read and will be lost on save`, 'error');
    }
    let shown = model;
    if (layers.length || this.ctx.state.baseLayer || this.ctx.sidecars.overlays().length) {
      const files = layers.length ? await loadLinked(session?.path ?? model.path, layers.map((l) => l.uri), this.ctx.d.readText, this.ctx.d.parseLinked) : new Map();
      if (gen !== this.ctx.state.generation) return model;
      this.ctx.state.files = files;
      if (session instanceof ForeignSession) files.set(BASE_URI, session.source);
      for (const l of layers) if (!files.get(l.uri)) this.ctx.d.toast(notFoundWarning(l.uri), 'info');
      // the file may have gained or lost roots since it was placed: the document is recomposed with the
      // current ones (without marking changes; they are saved with the next Save)
      const rooted = session ? layers.map((l) => this.ctx.stack.refreshRoots(session, l)).some(Boolean) : false;
      try {
        shown = session && rooted ? await this.ctx.stack.build(session) : await this.ctx.stack.compose(model);
      } catch (e) {
        this.ctx.d.toast(`Could not update the layers: ${errorMessage(e)}`, 'error');
      }
      if (gen !== this.ctx.state.generation) return model;
    }
    this.show(shown, session, opts.keepView ?? false);
    if (session && Object.keys(legacy).length) await this.ctx.materials.migrateLegacyAssignments(session, legacy, legacyName);
    if (session && Object.keys(legacyClass).length) await this.ctx.classification.migrateLegacyClassification(session, legacyClass, legacyClassName);
    const migratedSchedule = await this.ctx.libraryFiles.loadLibDoc(this.ctx.state.scheduleSlot, session, docPath, gen);
    if (gen !== this.ctx.state.generation) return model;
    if (session && docPath) {
      const files = [
        ...(Object.keys(legacy).length ? [sidecarFor(docPath, LEGACY_MATERIALS)] : []),
        ...(Object.keys(legacyClass).length ? [sidecarFor(docPath, LEGACY_CLASSIFICATION)] : []),
        ...(migratedSchedule ? [sidecarFor(docPath, SCHEDULE_LIB.legacy)] : []),
      ];
      this.ctx.state.legacyFiles = { doc: docPath, files };
    }
    return this.ctx.state.shown ?? shown;
  }

  closed(): void {
    this.resetStack();
    this.ctx.state.current = null;
    this.ctx.state.open = false;
    this.ctx.state.base = null;
    this.ctx.state.shown = null;
    this.ctx.stack.pushLayers();
    this.ctx.d.ws.setModel(null);
    this.ctx.d.ws.setDirty(false); // setModel does not clear the *
    this.ctx.d.ws.setEditable(false);
  }

  show(model: LoadedModel, session: EditSession | null, keepView = false): void {
    this.ctx.state.current = session;
    this.ctx.state.open = true;
    this.ctx.state.shown = model;
    this.ctx.saver.markModelSaved();
    if (keepView) this.ctx.d.ws.updateModel(model);
    else this.ctx.d.ws.setModel(model);
    this.ctx.d.ws.setDirty(false); // setModel does not clear the *
    if (this.ctx.lock.userLock) this.ctx.d.ws.setEditable(false);
    else this.ctx.lock.applyEditable();
    this.ctx.stack.pushLayers();
  }
}
