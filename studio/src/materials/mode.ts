// Modo Materials: une el Browser, el Editor y Usage con el visor y el controlador.
// Receives everything injected (no DOM of the workspace) so it can be tested.
import type { Viewer } from '../render/viewer';
import type { QuantityRow } from '../render/viewer';
import type { ColorFn } from '../render/coloroverride';
import { editPath } from '../composer/edits';
import type { LoadedModel } from '../model/load';
import { mountMaterialBrowser } from './browserpanel';
import { catalog, matchRule, modelColor, NO_MATERIAL, usage, type CatalogEntry, type CatalogNode } from './catalog';
import { mountMaterialEditor } from './editorpanel';
import { askRule } from './ruledialog';
import type { MaterialDef } from './state';
import { mountUsagePanel } from './usagepanel';

/** Lo que el modo pide al controlador (main.ts lo conecta a `doc.*`). */
export interface MaterialsActions {
  /** The material nodes of the model, with what the document overrides of each one. */
  nodes(): readonly CatalogNode[];
  setMaterial(code: string | null, def: MaterialDef): Promise<boolean>;
  promoteMaterial(code: string): Promise<boolean>;
  resetMaterial(code: string): Promise<boolean>;
  duplicateMaterial(code: string): Promise<string | null>;
  deleteMaterial(code: string): Promise<boolean>;
  /** `paths`: edit paths (editPath) of the elements. */
  assignMaterial(paths: string[], code: string | null, label?: 'Assign Material' | 'Assign by Rule'): Promise<boolean>;
  confirm(message: string, ok: string): Promise<boolean>;
}

export interface MaterialsModeDeps {
  actions: MaterialsActions;
  viewer: Pick<Viewer, 'quantities' | 'setColorOverride' | 'selectMany'>;
  model(): LoadedModel | null;
  /** Ruta compuesta del elemento seleccionado. */
  selected(): string | null;
  toast(message: string, kind?: 'info' | 'error'): void;
  editable: boolean;
}

export interface MaterialsMode {
  /** Contenido de cada hueco: 0 = Browser (izquierda), 1 = Editor (derecha), 2 = Usage (abajo). */
  panel(slot: number): HTMLElement | null;
  enter(): void;
  leave(): void;
  /** Recomputes catalog, use and colors (the model or the materials changed). */
  refresh(): void;
  selectionChanged(path: string | null): void;
  newMaterial(): void;
  assignToSelection(): void;
  assignByRule(): Promise<void>;
  setColors(on: boolean): void;
  /** Soltar un material del Browser sobre un elemento del visor. */
  dropMaterial(code: string, elementPath: string | null): void;
  setEditable(on: boolean): void;
}

export function createMaterialsMode(d: MaterialsModeDeps): MaterialsMode {
  const hosts = [0, 1, 2].map(() => {
    const h = document.createElement('div');
    h.className = 'mat-host';
    return h;
  });

  let rows: QuantityRow[] = [];
  let entries: CatalogEntry[] = [];
  const byCode = new Map<string, MaterialDef>();
  /** Effective material per element (it already includes what was assigned: it comes from the composed model). */
  let effective = new Map<string, string | null>();
  let selectedCode: string | null = null;
  let colorsOn = true;
  let active = false;
  let editable = d.editable;

  const colorFn: ColorFn = (path) => {
    const code = effective.get(path);
    const def = code ? byCode.get(code) : undefined;
    return def ? { color: def.color, opacity: def.opacity } : NO_MATERIAL;
  };

  const apply = (): void => d.viewer.setColorOverride(active && colorsOn ? colorFn : null);

  function pick(code: string | null): void {
    selectedCode = code;
    browser.setSelected(code);
    editor.show(entries.find((e) => e.def.code === code) ?? null);
  }

  const browser = mountMaterialBrowser(hosts[0], {
    onSelect: pick,
    onNew: () => newMaterial(),
    onDuplicate: (code) => void d.actions.duplicateMaterial(code).then((c) => c && pick(c)),
    onDelete: (code) => void remove(code),
  });
  const editor = mountMaterialEditor(hosts[1], {
    onPromote: (code) => void d.actions.promoteMaterial(code),
    onReset: (code) => void d.actions.resetMaterial(code),
    onChange: (old, def) =>
      void d.actions.setMaterial(old, def).then((ok) => {
        if (ok && selectedCode === old) pick(def.code.trim());
      }),
  });
  const usagePanel = mountUsagePanel(hosts[2], { onRow: (paths) => d.viewer.selectMany(paths) });
  browser.setEditable(editable);
  editor.setEditable(editable);

  async function remove(code: string): Promise<void> {
    const e = entries.find((x) => x.def.code === code);
    if (!e) return;
    if (e.site === 'library') {
      const ok = await d.actions.confirm(`Delete ${e.def.name} from ${e.sourceName}? Other models that use this library will lose it.`, 'Delete');
      if (!ok) return;
    } else if (e.elements > 0) {
      const ok = await d.actions.confirm(`Delete ${e.def.name}? It is assigned to ${e.elements} elements.`, 'Delete');
      if (!ok) return;
    }
    if (await d.actions.deleteMaterial(code)) pick(null);
  }

  function newMaterial(): void {
    if (!editable) return;
    const taken = new Set(entries.map((e) => e.def.code));
    let n = entries.length + 1;
    while (taken.has(`MAT-${n}`)) n++;
    const code = `MAT-${n}`;
    void d.actions.setMaterial(null, { name: 'New Material', code, color: modelColor(code), opacity: 1 }).then((ok) => ok && pick(code));
  }

  /** Edit path of an element (the key of the assignments). */
  function editKey(elementPath: string): string | null {
    const m = d.model();
    const node = m?.result.byPath.get(elementPath);
    return m && node ? editPath(node, m.result) : null;
  }

  function assignTo(code: string, elementPath: string): void {
    const key = editKey(elementPath);
    if (key) void d.actions.assignMaterial([key], code);
  }

  return {
    panel: (slot) => hosts[slot] ?? null,
    enter() {
      active = true;
      this.refresh();
    },
    leave() {
      active = false;
      apply();
    },
    refresh() {
      const m = d.model();
      rows = m ? d.viewer.quantities(false) : [];
      entries = catalog(m ? d.actions.nodes() : [], rows);
      byCode.clear();
      for (const e of entries) byCode.set(e.def.code, e.def);
      effective = new Map();
      for (const r of rows) if (r.materialCode || !effective.has(r.element)) effective.set(r.element, r.materialCode);
      browser.setEntries(entries);
      usagePanel.setRows(usage(entries, rows));
      if (selectedCode && !byCode.has(selectedCode)) selectedCode = null;
      pick(selectedCode);
      apply();
    },
    selectionChanged(path) {
      const code = path ? effective.get(path) : null;
      if (active && code) pick(code); // without a material, the Browser one stays so that it can be assigned
    },
    newMaterial,
    assignToSelection() {
      const sel = d.selected();
      if (!editable) return;
      if (!selectedCode || !sel) return d.toast('Select a material and an element first', 'info');
      assignTo(selectedCode, sel);
    },
    async assignByRule() {
      if (!editable) return;
      const answer = await askRule({
        classes: [...new Set(rows.map((r) => r.cls))].sort(),
        storeys: [...new Set(rows.map((r) => r.storey))].sort(),
        materials: entries.map((e) => ({ code: e.def.code, name: e.def.name })),
        target: selectedCode,
      });
      if (!answer) return;
      const keys = [...new Set(matchRule(rows, answer.rule).flatMap((p) => editKey(p) ?? []))];
      if (!keys.length) return d.toast('No elements match that rule', 'info');
      if (await d.actions.assignMaterial(keys, answer.target, 'Assign by Rule')) {
        d.toast(`Assigned ${byCode.get(answer.target)?.name ?? answer.target} to ${keys.length} elements`, 'info');
      }
    },
    setColors(on) {
      colorsOn = on;
      apply();
    },
    dropMaterial(code, elementPath) {
      if (editable && elementPath) assignTo(code, elementPath);
    },
    setEditable(on) {
      editable = on;
      browser.setEditable(on);
      editor.setEditable(on);
    },
  };
}
