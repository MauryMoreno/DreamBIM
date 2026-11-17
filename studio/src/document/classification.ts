import type { IfcxNode } from '../ifcx/types';
import { BASE_URI, ForeignSession } from '../modeling/foreign';
import type { ClassAssign } from '../classification/state';
import { classItems, type ClassItem } from '../classification/nodes';
import { assignClass, resolveClassTarget, tableOf, type ClassTarget } from '../classification/assign';
import type { ClassTableRef } from '../classification/system';
import type { EditSession } from '../modeling/session';
import type { DocumentContext } from './context';
import { OverResult } from './shared';

export class ClassificationService {
  constructor(private readonly ctx: DocumentContext) {}

  /** The tables of the folder, only if some code still has no item in the model (reading them is costly). */
  private async tablesFor(codes: readonly string[], items: readonly ClassItem[]): Promise<readonly ClassTableRef[]> {
    const have = new Set(items.map((i) => `${i.table}:${i.code}`));
    return codes.some((c) => !have.has(`${tableOf(c)}:${c}`)) ? (await this.ctx.d.classTables?.()) ?? [] : [];
  }

  /** The overs with the table imported into the document (if needed): its imports, or those of the base file of a foreign IFCx. */
  private withImports(overs: IfcxNode[], uris: readonly string[]): OverResult {
    const s = this.ctx.state.current;
    const missing = uris.filter((u) => !this.ctx.libraryFiles.importedUris().includes(u));
    if (!s || !missing.length) return overs;
    if (s instanceof ForeignSession) return { overs, source: { ...s.source, imports: [...(s.source.imports ?? []), ...missing.map((uri) => ({ uri }))] } };
    return { overs, docImports: [...s.doc.imports, ...missing] };
  }

  /**
   * Classifies those elements (edit paths) with `code` (from table 21, 23…, by its prefix); null removes the
   * code of table `table`. It inherits the table item (`inherits.omniclass21`, `inherits.omniclass23`…) and imports
   * its file if the document does not import it yet; if that is not possible (legacy-format table, no table or an unsaved
   * document) it writes the value. `title`: the name if no table provides it.
   */
  classify(paths: string[], code: string | null, label: string = 'Classify Elements', title?: string, table: string = code ? tableOf(code) : '21'): Promise<boolean> {
    return this.ctx.materials.overChange(label, async (overs, result) => {
      const items = classItems(result);
      const tables = code === null ? [] : await this.tablesFor([code], items);
      const target = code === null ? null : resolveClassTarget(code, title, items, tables, this.ctx.stack.docPath(), this.ctx.libraryFiles.importedUris());
      const elements = this.ctx.materials.elementsByEditPath(result);
      let out = overs;
      for (const p of paths) {
        const n = elements.get(p);
        if (n) out = assignClass(out, p, target, n, result, table);
      }
      return out === overs ? overs : this.withImports(out, target?.importUri ? [target.importUri] : []);
    });
  }

  /**
   * The assignments of the legacy `*.classification.ifcx` move to `inherits.omniclass21` in the over
   * layer of the document. It is not a history step: it leaves the document with changes and warns.
   */
  async migrateLegacyClassification(s: EditSession, assign: Record<string, ClassAssign>, file: string): Promise<void> {
    const result = this.ctx.state.shown?.result;
    if (!result) return;
    const items = classItems(result);
    const tables = await this.tablesFor(Object.values(assign).map((v) => v.code), items);
    const elements = this.ctx.materials.elementsByEditPath(result);
    const targets = new Map<string, ClassTarget>();
    const toImport = new Set<string>();
    let overs = this.ctx.materials.docOvers();
    let converted = 0;
    let withoutNode = 0;
    for (const [ep, v] of Object.entries(assign)) {
      const el = elements.get(ep);
      if (!el) continue;
      let target = targets.get(v.code);
      if (!target) {
        target = resolveClassTarget(v.code, v.title, items, tables, this.ctx.stack.docPath(), [...this.ctx.libraryFiles.importedUris(), ...toImport]);
        targets.set(v.code, target);
      }
      const next = assignClass(overs, ep, target, el, result);
      if (next === overs) continue;
      overs = next;
      converted++;
      if (target.item === null) withoutNode++;
      if (target.importUri) toImport.add(target.importUri);
    }
    if (!converted) return;
    const edit = this.withImports(overs, [...toImport]);
    this.ctx.materials.setDocOvers(overs);
    if (typeof edit !== 'string' && !Array.isArray(edit)) {
      if (edit.docImports) s.doc.imports = edit.docImports;
      if (edit.source && s instanceof ForeignSession) {
        s.source = edit.source;
        this.ctx.state.files.set(BASE_URI, edit.source);
      }
    }
    s.dirty = true;
    this.ctx.state.version = this.ctx.state.nextVersion++;
    if (s instanceof ForeignSession) {
      this.ctx.stack.writeMeta(s);
      await this.ctx.stack.recompose();
    } else await this.ctx.stack.refresh(s, true);
    this.ctx.d.toast(
      `Converted ${converted} classification assignment${converted === 1 ? '' : 's'} from ${file}${withoutNode ? `; ${withoutNode} have no table node` : ''}`,
      'info',
    );
  }
}
