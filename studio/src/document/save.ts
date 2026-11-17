import type { IfcxFile } from '../ifcx/types';
import type { LinkedFiles } from '../composer/stack';
import { rebaseUri } from '../composer/uri';
import { errorMessage, fileName } from '../model/open';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { BASE_URI, ForeignSession } from '../modeling/foreign';
import { sidecarFor } from '../modeling/sidecars';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { LibSlot, persisted } from './shared';

/** Content a migrated legacy sidecar is left with: no assignments, so it is not applied again. */
const MIGRATED_SIDECAR = JSON.stringify(
  { header: { id: 'studio-migrated', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' }, imports: [], schemas: {}, data: [] },
  null,
  2,
);

export class SaveService {
  constructor(private readonly ctx: DocumentContext) {}

  /** What is saved in the model file, without the materials (they go in their own file). */
  private fingerprint(): string {
    return JSON.stringify([this.ctx.state.current?.doc ?? null, this.ctx.state.baseLayer?.edits ?? [], this.ctx.state.layers.map(persisted)]);
  }

  private sourceOf(s: EditSession | null): IfcxFile | null {
    return s instanceof ForeignSession ? s.source : null;
  }

  /** The model file on disk is the current state. */
  markModelSaved(): void {
    this.ctx.state.modelSaved = this.fingerprint();
    this.ctx.state.savedSource = this.sourceOf(this.ctx.state.current);
  }

  /** Does the model match what is saved on disk? (then Save does not rewrite it) */
  private modelIsSaved(s: EditSession): boolean {
    return this.sourceOf(s) === this.ctx.state.savedSource && this.fingerprint() === this.ctx.state.modelSaved;
  }

  /** Save: without a path it acts as Save As; with a path and no changes it does nothing. true if it ends up saved. */
  save(): Promise<boolean> {
    return this.saveWith(false);
  }

  /** Save As: always asks for the path. true if it was saved. */
  saveAs(): Promise<boolean> {
    return this.saveWith(true);
  }

  private saveWith(ask: boolean): Promise<boolean> {
    const s = this.ctx.state.current;
    if (!s) {
      this.ctx.d.toast(this.ctx.state.open ? NOT_EDITABLE : 'No document is open', 'info');
      return Promise.resolve(false);
    }
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      if (this.ctx.state.current !== s) return false;
      let path = s.path;
      if (!path || ask) {
        try {
          path = await this.ctx.d.pickSavePath(s.path ?? `${s.name}.ifcx`);
        } catch (e) {
          this.ctx.d.toast(`Could not open the dialog: ${errorMessage(e)}`, 'error');
          return false;
        }
        if (!path) return false; // cancelled
        // while the dialog was open, another document could have been opened, created or closed
        if (this.ctx.state.current !== s || gen !== this.ctx.state.generation) return false;
      } else if (!s.dirty) return true;
      // if only the materials changed, the model is not rewritten (its date would change for no reason)
      const modelUnchanged = !!s.path && !ask && this.modelIsSaved(s);
      // the linked uris still point to the same files from the new path
      const undo = this.rebaseStack(s, path);
      try {
        if (!modelUnchanged) {
          await s.saveTo(path);
          if (s instanceof ForeignSession && this.ctx.state.baseLayer) {
            // the edits are already written into the file nodes: the base is the saved file
            this.ctx.state.files.set(BASE_URI, s.source);
            this.ctx.state.baseLayer.edits = [];
            this.ctx.state.baseLayer.name = s.name;
          }
        }
      } catch (e) {
        undo();
        this.ctx.d.toast(`Could not save ${fileName(path)}: ${errorMessage(e)}`, 'error');
        return false;
      }
      this.markModelSaved();
      let sidecarsOk = true;
      for (const slot of this.ctx.d.writeText ? this.ctx.sidecars.slots() : []) {
        if (slot.kind.isEmpty(slot.get()) && !this.ctx.state.sidecarExisted.has(slot.kind.suffix)) continue;
        const side = sidecarFor(path, slot.kind);
        try {
          await this.ctx.d.writeText!(side, JSON.stringify(slot.kind.toFile(slot.get(), fileName(path).replace(/\.ifcx$/i, '')), null, 2));
          this.ctx.state.sidecarExisted.add(slot.kind.suffix);
        } catch (e) {
          this.ctx.d.toast(`Could not save ${fileName(side)}: ${errorMessage(e)}`, 'error');
          sidecarsOk = false; // the model is already written, but not this file
        }
      }
      // the schedule belongs to the model: on Save As to another folder it goes with the new path
      for (const slot of [this.ctx.state.scheduleSlot] as LibSlot<unknown>[]) this.ctx.libraryFiles.relocateLibDoc(slot, path);
      for (const [lib, file] of this.ctx.state.libs) {
        if (this.ctx.state.libsSaved.get(lib) === file) continue;
        try {
          if (!this.ctx.d.writeText) throw new Error('no file access');
          await this.ctx.d.writeText(lib, JSON.stringify(file, null, 2));
          this.ctx.state.libsSaved.set(lib, file);
        } catch (e) {
          this.ctx.d.toast(`Could not save ${fileName(lib)}: ${errorMessage(e)}`, 'error');
          sidecarsOk = false;
        }
      }
      // what was migrated is already in the document: the old file is emptied so it is not applied again on open
      if (sidecarsOk && this.ctx.state.legacyFiles.files.length && path === this.ctx.state.legacyFiles.doc && this.ctx.d.writeText) {
        const left: string[] = [];
        for (const f of this.ctx.state.legacyFiles.files) {
          try {
            await this.ctx.d.writeText(f, MIGRATED_SIDECAR);
          } catch (e) {
            this.ctx.d.toast(`Could not update ${fileName(f)}: ${errorMessage(e)}`, 'error');
            left.push(f);
          }
        }
        this.ctx.state.legacyFiles = { doc: path, files: left };
      }
      if (!sidecarsOk) {
        s.dirty = true;
        return false;
      }
      s.dirty = false; // saveTo already lowers it; if the model was not rewritten (materials only), we lower it here
      this.ctx.state.savedVersion = this.ctx.state.version;
      // new name in the title and the tree; the recent list needs the model with its path
      const model = await this.ctx.stack.refresh(s, false);
      if (model) await this.ctx.d.remember(model);
      return true;
    });
  }

  /**
   * Recomputes the stack uris (and those of the placements) to save at `toPath`: after a Save As
   * they still point to the same file, and on the first Save the absolute ones become relative.
   * Returns how to undo it if the save fails.
   */
  private rebaseStack(s: EditSession, toPath: string): () => void {
    const from = s.path;
    const layers = this.ctx.state.layers;
    const files = this.ctx.state.files;
    const oldUris = layers.map((l) => l.uri);
    const placements = s.doc.composer.placements.map((p) => [p.layerUri, p.parentLayerUri] as const);
    const moved = new Map<string, string>();
    const next: LinkedFiles = new Map();
    // the base file of a foreign IFCx is not a link: it stays the same even if the model is not rewritten
    const base = files.get(BASE_URI);
    if (base !== undefined) next.set(BASE_URI, base);
    for (const l of layers) {
      const uri = rebaseUri(l.uri, from, toPath);
      moved.set(l.uri, uri);
      next.set(uri, files.get(l.uri) ?? null);
      l.uri = uri;
    }
    for (const p of s.doc.composer.placements) {
      p.layerUri = moved.get(p.layerUri) ?? p.layerUri;
      if (p.parentLayerUri !== undefined) p.parentLayerUri = moved.get(p.parentLayerUri) ?? p.parentLayerUri;
    }
    this.ctx.state.files = next;
    this.ctx.stack.writeMeta(s);
    return () => {
      layers.forEach((l, i) => (l.uri = oldUris[i]));
      s.doc.composer.placements.forEach((p, i) => {
        p.layerUri = placements[i][0];
        if (placements[i][1] !== undefined) p.parentLayerUri = placements[i][1];
      });
      this.ctx.state.files = files;
      this.ctx.stack.writeMeta(s);
    };
  }

  /**
   * Before leaving the document (Close, Home, Open…, New, Exit): true if it can continue.
   * With changes it asks; Save saves and continues unless it is cancelled or fails.
   */
  async confirmDiscard(): Promise<boolean> {
    await this.ctx.queue.idle(); // pending edits also count
    const s = this.ctx.state.current;
    if (!s?.dirty) return true;
    const choice = await this.ctx.d.askSaveChanges(s.name);
    if (choice === 'cancel') return false;
    if (choice === 'discard') return true;
    return this.save();
  }
}
