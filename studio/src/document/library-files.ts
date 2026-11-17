import type { IfcxFile } from '../ifcx/types';
import type { Fetcher } from '../ifcx/layers';
import { offlineFetcher } from '../model/schemas';
import { resolveUri } from '../composer/uri';
import { errorMessage, fileName } from '../model/open';
import { NOT_EDITABLE } from '../ribbon/filemenu';
import { BASE_URI, ForeignSession } from '../modeling/foreign';
import type { ScheduleState } from '../schedule/state';
import { sidecarFor } from '../modeling/sidecars';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { LibFile, LibSlot } from './shared';

interface LibEdit {
  file: LibFile;
  libs: Map<string, IfcxFile>;
  addImport: boolean;
}

export class LibraryFilesService {
  constructor(private readonly ctx: DocumentContext) {}

  /**
   * Reads a library document (schedule, budget): the one of the imported IFCx file that carries its root. If there is
   * none, the one of the legacy sidecar moves to a `<model><suffix>` that the model imports (without a history
   * step: it leaves the document with changes and warns). true if it migrated.
   */
  async loadLibDoc<T>(slot: LibSlot<T>, s: EditSession | null, docPath: string | null, gen: number): Promise<boolean> {
    const k = slot.kind;
    const result = this.ctx.state.shown?.result;
    const root = result?.provenance?.pathsWith(k.marker)[0];
    if (result && root) {
      const src = result.provenance.sourcesOf(root).find((x) => x.role === 'import' && x.location);
      if (!src?.location) return false;
      try {
        const file = await this.ensureLib(src.location);
        if (gen !== this.ctx.state.generation) return false;
        const got = k.read(file);
        if (got) {
          slot.set(got.state);
          slot.file = { location: src.location, uri: src.uri ?? fileName(src.location), root: got.root };
        }
      } catch (e) {
        this.ctx.d.toast(`Could not read ${fileName(src.location)}: ${errorMessage(e)}`, 'error');
      }
      return false;
    }
    if (!s || !docPath || !this.ctx.d.exists) return false;
    const old = sidecarFor(docPath, k.legacy);
    let state: T;
    try {
      if (!(await this.ctx.d.exists(old))) return false;
      state = k.legacy.fromFile(JSON.parse(await this.ctx.d.readText(old)));
    } catch (e) {
      if (gen === this.ctx.state.generation) this.ctx.d.toast(`Could not read ${fileName(old)}: ${errorMessage(e)}`, 'error');
      return false;
    }
    if (gen !== this.ctx.state.generation || k.legacy.isEmpty(state)) return false;
    const edit = this.libEdit(slot, state);
    if (typeof edit === 'string') return false;
    this.applyLibEdit(slot, s, state, edit);
    s.dirty = true;
    if (edit.addImport) await this.afterImportChange(s);
    else this.ctx.d.ws.setDirty(true);
    this.ctx.d.toast(`Moved the ${k.noun} from ${fileName(old)} to ${fileName(edit.file.location)}`, 'info');
    return true;
  }

  /**
   * What changes when setting `next`: the regenerated IFCx file (in `libs`) and, if the model does not import it yet,
   * the import. An unsaved document cannot have a file next to it yet: it returns the reason.
   */
  private libEdit<T>(slot: LibSlot<T>, next: T): LibEdit | string {
    const docPath = this.ctx.stack.docPath();
    let file = slot.file;
    if (!file) {
      if (!docPath) return slot.kind.unsaved;
      const uri = `${fileName(docPath).replace(/\.ifcx$/i, '')}${slot.kind.suffix}`;
      file = { location: resolveUri(docPath, uri), uri, root: crypto.randomUUID() };
    }
    const title = docPath ? fileName(docPath).replace(/\.ifcx$/i, '') : 'Model';
    const data = slot.kind.write(next, { root: file.root, title, previous: this.ctx.state.libs.get(file.location) ?? null });
    return { file, libs: new Map(this.ctx.state.libs).set(file.location, data), addImport: !this.importedUris().includes(file.uri) };
  }

  private applyLibEdit<T>(slot: LibSlot<T>, s: EditSession, next: T, edit: LibEdit): void {
    slot.set(next);
    slot.file = edit.file;
    this.ctx.state.libs = edit.libs;
    if (!edit.addImport) return;
    if (s instanceof ForeignSession) {
      s.source = { ...s.source, imports: [...(s.source.imports ?? []), { uri: edit.file.uri }] };
      this.ctx.state.files.set(BASE_URI, s.source);
    } else s.doc.imports = [...s.doc.imports, edit.file.uri];
  }

  /**
   * Queues a change to a library document. It regenerates its IFCx file (written with Save, like a
   * library) and, the first time, adds it to the model imports. It recomposes only if the imports change: the
   * datum is read by the modes (`dataChanged`), and dragging a bar must not recompose a large model.
   */
  private libChange<T>(slot: LibSlot<T>, label: string, change: (v: T) => T | string): Promise<boolean> {
    if (!this.ctx.state.open) return Promise.resolve(false);
    const s = this.ctx.state.current;
    if (!s) {
      this.ctx.d.toast(NOT_EDITABLE, 'info');
      return Promise.resolve(false);
    }
    if (this.ctx.lock.userLocked()) return Promise.resolve(false);
    const gen = this.ctx.state.generation;
    return this.ctx.queue.enqueue(async () => {
      if (gen !== this.ctx.state.generation || this.ctx.state.current !== s) return false;
      const next = change(slot.get());
      if (typeof next === 'string') {
        this.ctx.d.toast(next, 'info');
        return false;
      }
      if (next === slot.get()) return true;
      const edit = this.libEdit(slot, next);
      if (typeof edit === 'string') {
        this.ctx.d.toast(edit, 'info');
        return false;
      }
      const before = this.ctx.history.snapshot(label);
      this.applyLibEdit(slot, s, next, edit);
      s.dirty = true;
      this.ctx.history.commit(before);
      if (edit.addImport) await this.afterImportChange(s);
      else {
        this.ctx.d.ws.setDirty(true);
        this.ctx.d.ws.dataChanged?.();
      }
      return true;
    });
  }

  /** If the (relative) import of the library document points elsewhere from `docPath`, its file is written there. */
  relocateLibDoc<T>(slot: LibSlot<T>, docPath: string): void {
    const f = slot.file;
    if (!f) return;
    const location = resolveUri(docPath, f.uri);
    if (location === f.location) return;
    const data = slot.kind.write(slot.get(), { root: f.root, title: fileName(docPath).replace(/\.ifcx$/i, ''), previous: this.ctx.state.libs.get(f.location) ?? null });
    this.ctx.state.libs = new Map(this.ctx.state.libs).set(location, data);
    slot.file = { ...f, location };
  }

  /** The model imports one more file: it is recomposed, as after importing a table. */
  private async afterImportChange(s: EditSession): Promise<void> {
    if (s instanceof ForeignSession) {
      this.ctx.stack.writeMeta(s);
      await this.ctx.stack.recompose();
    } else await this.ctx.stack.refresh(s, true);
  }

  /**
   * Changes an IFCx file that the model imports (a cost system, a classification table): `change` receives its content as the
   * session knows it and returns the new one (or a text with the reason not to change). It is a history step, the
   * model is recomposed with it and it is written with Save, like an edited library.
   */
  changeImportedFile(location: string, label: string, change: (file: IfcxFile) => IfcxFile | string): Promise<boolean> {
    return this.ctx.materials.overChange(label, async (overs) => {
      const lib = await this.ensureLib(location);
      const next = change(lib);
      if (typeof next === 'string' || next === lib) return typeof next === 'string' ? next : overs;
      return { overs, libs: new Map(this.ctx.state.libs).set(location, next) };
    });
  }

  /** Schedule of the open document. */
  get schedule(): ScheduleState {
    return this.ctx.state.scheduleState;
  }

  /** Queues a change to the schedule (calendar or tasks): it is saved in its imported IFCx file. */
  changeSchedule(label: string, change: (s: ScheduleState) => ScheduleState | string): Promise<boolean> {
    return this.libChange(this.ctx.state.scheduleSlot, label, change);
  }

  /** Composition fetcher: a library edited in this session is read from memory, the rest from disk. */
  readonly libFetcher: Fetcher = (uri) => {
    const edited = this.ctx.state.libs.get(uri);
    return edited ? Promise.resolve(edited) : offlineFetcher(uri);
  };

  /**
   * The file of a library as the session knows it. The first time it is read from disk and kept in
   * `libs` and `libsSaved` (it is what is written): so undo can return to that content.
   */
  async ensureLib(location: string): Promise<IfcxFile> {
    const known = this.ctx.state.libs.get(location);
    if (known) return known;
    const file = await offlineFetcher(location);
    this.ctx.state.libs = new Map(this.ctx.state.libs).set(location, file);
    this.ctx.state.libsSaved.set(location, file);
    this.ctx.state.libsOrigin.set(location, file);
    return file;
  }

  /** Uris that the open document already imports. */
  importedUris(): string[] {
    const s = this.ctx.state.current;
    return s instanceof ForeignSession ? (s.source.imports ?? []).map((i) => i.uri) : s?.doc.imports ?? [];
  }
}
