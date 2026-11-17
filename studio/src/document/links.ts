import type { IfcxFile } from '../ifcx/types';
import { nextColor, type ComposerLayer } from '../composer/stack';
import { linkUri, resolveUri, sameFile } from '../composer/uri';
import { parseLayer } from '../model/load';
import { errorMessage, fileName } from '../model/open';
import type { DocumentContext } from './context';

export class LinksService {
  constructor(private readonly ctx: DocumentContext) {}

  /** Is there already another layer pointing to that file, or is it the document itself? Warns if so. */
  private alreadyLinked(absPath: string, except?: ComposerLayer): boolean {
    const docPath = this.ctx.stack.docPath();
    if (docPath && sameFile(docPath, absPath)) {
      this.ctx.d.toast("A document can't link itself", 'info');
      return true;
    }
    const dup = this.ctx.state.layers.some((l) => l !== except && sameFile(resolveUri(docPath, l.uri), absPath));
    if (dup) this.ctx.d.toast(`${fileName(absPath)} is already linked`, 'info');
    return dup;
  }

  /** Parses a linked layer: in the worker if there is one (packed meshes) or, if not, on the main thread. */
  readonly parseLinked = (text: string, name = ''): Promise<IfcxFile> =>
    this.ctx.d.parseLinked ? this.ctx.d.parseLinked(text) : Promise.resolve().then(() => parseLayer('', name, text).file);

  /** Reads and validates a file to link it; null (with a warning) if it fails. */
  async readLinked(absPath: string, verb: string): Promise<IfcxFile | null> {
    const name = fileName(absPath);
    try {
      return await this.parseLinked(await this.ctx.d.readText(absPath), name);
    } catch (e) {
      this.ctx.d.toast(`Could not ${verb} ${name}: ${errorMessage(e)}`, 'error');
      return null;
    }
  }

  /** Links an .ifcx above the document and below the other links. false if it could not. */
  linkFile(absPath: string): Promise<boolean> {
    const gen = this.ctx.state.generation;
    return this.ctx.stack.stackChange(`Link ${fileName(absPath)}`, async () => {
      if (this.alreadyLinked(absPath)) return null;
      const file = await this.readLinked(absPath, 'link');
      // during the read another document could have been opened: its stack is not touched
      if (!file || gen !== this.ctx.state.generation) return null;
      const uri = linkUri(this.ctx.stack.docPath(), absPath);
      this.ctx.state.files.set(uri, file);
      const layer: ComposerLayer = {
        id: this.ctx.stack.newLayerId(), uri, name: fileName(absPath), color: nextColor(this.ctx.state.layers),
        enabled: true, editsEnabled: true, edits: [],
      };
      this.ctx.state.layers = [...this.ctx.state.layers, layer];
      return true;
    });
  }

  /** Removes a link; with edits or placements it asks for confirmation first. */
  async unlink(id: string): Promise<boolean> {
    const l = this.ctx.stack.layer(id);
    if (!l) return false;
    const n = l.edits.length;
    const placed = (this.ctx.state.current?.doc.composer.placements.filter((p) => p.layerUri === l.uri).length ?? 0) > 0;
    const edits = `${n} ${n === 1 ? 'edit' : 'edits'}`;
    const what = n && placed ? `, its ${edits} and its placement` : n ? ` and its ${edits}` : ' and its placement';
    if ((n > 0 || placed) && !(await this.ctx.d.confirm(`Remove ${l.name}${what}?`, 'Remove'))) return false;
    return this.ctx.stack.stackChange('Remove Layer', () => {
      const target = this.ctx.stack.layer(id);
      if (!target) return null;
      this.ctx.state.layers = this.ctx.state.layers.filter((x) => x !== target);
      this.ctx.state.files.delete(target.uri);
      const s = this.ctx.state.current;
      if (s) {
        s.doc.composer.placements = s.doc.composer.placements.filter((p) => p.layerUri !== target.uri);
        // what hung from a node of this file moves to the project, instead of being left loose
        for (const p of s.doc.composer.placements) {
          if (p.parentLayerUri !== target.uri) continue;
          p.parentId = s.doc.ids.project;
          delete p.parentLayerUri;
        }
      }
      return true;
    });
  }

  setLayerEnabled(id: string, on: boolean): Promise<boolean> {
    return this.ctx.stack.stackChange(on ? 'Enable Layer' : 'Disable Layer', () => {
      const l = this.ctx.stack.layer(id);
      if (!l) return null;
      if (l.enabled === on) return false;
      l.enabled = on;
      return true;
    });
  }

  /** Deletes the orphan edit of `path` from the layer; false if the layer or the edit do not exist. */
  removeEdit(layerId: string, path: string): Promise<boolean> {
    return this.ctx.stack.stackChange('Delete Edit', () => {
      const l = this.ctx.stack.edited(layerId);
      if (!l || !l.edits.some((n) => n.path === path)) return null;
      l.edits = l.edits.filter((n) => n.path !== path);
      return true;
    });
  }

  setEditsEnabled(id: string, on: boolean): Promise<boolean> {
    return this.ctx.stack.stackChange(on ? 'Enable Edits' : 'Disable Edits', () => {
      const l = this.ctx.stack.layer(id);
      if (!l) return null;
      if (l.editsEnabled === on) return false;
      l.editsEnabled = on;
      return true;
    });
  }

  /** Moves the layer to `toIndex` among the linked layers (the document does not count); it is clamped to the range. */
  moveLayer(id: string, toIndex: number): Promise<boolean> {
    return this.ctx.stack.stackChange('Reorder Layers', () => {
      const from = this.ctx.state.layers.findIndex((l) => l.id === id);
      if (from < 0) return null;
      const to = Math.max(0, Math.min(this.ctx.state.layers.length - 1, Math.trunc(toIndex) || 0));
      if (to === from) return false;
      const next = [...this.ctx.state.layers];
      const [l] = next.splice(from, 1);
      next.splice(to, 0, l);
      this.ctx.state.layers = next;
      return true;
    });
  }

  /** Points the layer to another file (e.g. one that was not found); it keeps its edits. */
  relink(id: string, absPath: string): Promise<boolean> {
    const gen = this.ctx.state.generation;
    return this.ctx.stack.stackChange('Relink', async () => {
      const l = this.ctx.stack.layer(id);
      if (!l) return null;
      if (this.alreadyLinked(absPath, l)) return null;
      const file = await this.readLinked(absPath, 'relink');
      if (!file || gen !== this.ctx.state.generation || !this.ctx.state.layers.includes(l)) return null;
      const uri = linkUri(this.ctx.stack.docPath(), absPath);
      this.ctx.state.files.delete(l.uri);
      this.ctx.state.files.set(uri, file);
      const s = this.ctx.state.current;
      if (s) {
        for (const p of s.doc.composer.placements) {
          if (p.layerUri === l.uri) p.layerUri = uri;
          if (p.parentLayerUri === l.uri) p.parentLayerUri = uri;
        }
      }
      l.uri = uri;
      l.name = fileName(absPath);
      if (s) this.ctx.stack.refreshRoots(s, l); // the container hangs the roots of the new file
      return true;
    });
  }
}
