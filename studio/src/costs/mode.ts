// Costs mode: the budget of a cost IFCx that the model composes as a layer. It reads the system, measures the elements
// that carry a code, computes the BOQ and shows it with the Cost panel of the element and the color in the viewer. Editing an
// item writes in the IFCx file that defines it. It receives everything injected (no DOM of the workspace) to
// poder probarlo.
import type { Viewer, QuantityRow } from '../render/viewer';
import type { ColorFn } from '../render/coloroverride';
import type { IfcxFile } from '../ifcx/types';
import type { ComposeResult } from '../ifcx/compose';
import { editPath } from '../composer/edits';
import type { LoadedModel } from '../model/load';
import { NO_MATERIAL } from '../materials/catalog';
import type { MaterialDef } from '../materials/state';
import { mountBoq } from './boqpanel';
import { computeBudget, type Budget, type BudgetNode } from './budget';
import { assignCost } from './assign';
import { askCode } from './codedialog';
import { itemColor, rampColor } from './colors';
import { applyCodeEdit, replaceSystemCodes } from './edit';
import { mountCostProps } from './propspanel';
import type { DocState } from './docpicker';
import type { QuoteSource } from './quoteparse';
import { askSystemEdit } from './systemeditor';
import { mountCostTree } from './treepanel';
import { elementCode, readCostSystem, type CostCode, type CostSystem } from './system';
import { elementMeasures, type ElementMeasures } from './takeoff';

export type ColorBy = 'off' | 'item' | 'cost';

/** El presupuesto de antes (IfcCostSchedule con partidas por reglas): Studio ya no lo lee. */
const K_LEGACY_BUDGET = 'prj::ifc::CostSchedule';
export const LEGACY_BUDGET = 'This model uses the previous budget format (IfcCostSchedule), which Dream BIM no longer reads. Convert it to a cost system.';

/** Lo que el modo pide al controlador (main.ts lo conecta a `doc.*`). */
export interface CostsActions {
  materials(): readonly MaterialDef[];
  /**
   * Changes the IFCx file that defines a code (`location`): a history step that recomposes the model and is
   * escribe con Save (`doc.changeImportedFile`). `change` devuelve el archivo nuevo o un texto con el motivo.
   */
  saveFile(location: string, label: string, change: (file: IfcxFile) => IfcxFile | string): Promise<boolean>;
  /**
   * Changes the assignment layer (`<model>.costos-asignacion.ifcx`), which is created and imported the first time
   * (`doc.changeCostAssignment`).
   */
  assign(label: string, change: (file: IfcxFile, result: ComposeResult) => IfcxFile | string): Promise<boolean>;
  confirm(message: string, ok: string): Promise<boolean>;
  /** Abre un documento de precios (Excel, Word, PDF, imagen, CSV, texto); null si se cancela. */
  openQuote?(): Promise<QuoteSource | null>;
  /** Re-reads by its path the document a price came from. */
  readQuote?(path: string): Promise<QuoteSource>;
}

export interface CostsModeDeps {
  actions: CostsActions;
  viewer: Pick<Viewer, 'quantities' | 'setColorOverride' | 'selectMany'>;
  model(): LoadedModel | null;
  /** Ruta compuesta del elemento seleccionado. */
  selected(): string | null;
  /** Rutas compuestas de todo lo seleccionado (si falta, solo cuenta `selected`). */
  selection?(): string[];
  /** Eje de un muro de Studio (m); null si no lo es. */
  wallLength(path: string): number | null;
  toast(message: string, kind?: 'info' | 'error'): void;
  editable: boolean;
}

export interface CostsMode {
  /** Content of each slot: 0 = the system tree (left), 1 = Cost (right), 2 = BOQ (bottom). */
  panel(slot: number): HTMLElement | null;
  enter(): void;
  leave(): void;
  /** Recomputes quantities, BOQ and colors (the model changed). */
  refresh(): void;
  selectionChanged(path: string | null): void;
  /** Opens the dialog of the item (or heading line) chosen in the BOQ. */
  editItem(): Promise<void>;
  /** Opens the whole system in the editor (create, change and delete codes) and writes it in a single step. */
  editSystem(): Promise<void>;
  /** Pone la partida elegida a los elementos seleccionados. */
  assignToSelection(): Promise<void>;
  /** Removes the code from the selected elements. */
  clearAssignment(): Promise<void>;
  /** A code dropped on an element of the viewer (null: on the empty space). */
  dropCode(code: string, elementPath: string | null): void;
  setColorBy(v: ColorBy): void;
  setEditable(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

export function createCostsMode(d: CostsModeDeps): CostsMode {
  const hosts = [0, 1, 2].map(() => el('div', 'cost-host'));

  let rows: QuantityRow[] = [];
  let measures = new Map<string, ElementMeasures>();
  let system: CostSystem | null = null;
  let budget: Budget | null = null;
  let nodes = new Map<string, BudgetNode>();
  let colorBy: ColorBy = 'item';
  let selectedCode: string | null = null;
  let colors = new Map<string, { color: string; opacity: number }>();
  let active = false;
  let editable = d.editable;
  let warned: string | null = null;
  /** The document open for choosing prices: it stays open between openings of the editor. */
  const docState: DocState = { doc: null, decimal: '.' };

  const colorFn: ColorFn = (path) => colors.get(path) ?? NO_MATERIAL;
  const apply = (): void => d.viewer.setColorOverride(active && colorBy !== 'off' ? colorFn : null);

  const tree = mountCostTree(hosts[0], {
    // choosing in the tree does not touch the 3D selection: this way elements are selected and then the item to assign is chosen
    onSelect: (code) => pickCode(code),
    onEdit: (code) => {
      pickCode(code);
      void editItem();
    },
    onMove: (code, parent) => void moveCode(code, parent),
    onOpenEditor: () => void editSystem(),
  });
  tree.setEditable(editable);
  const props = mountCostProps(hosts[1]);
  const boqPanel = mountBoq(hosts[2], {
    onSelect: (code) => selectCode(code),
    onEdit: (code) => {
      selectCode(code);
      void editItem();
    },
    onSelectUnassigned: () => {
      const list = budget?.unassigned.map((u) => u.path) ?? [];
      if (list.length) d.viewer.selectMany(list);
      else d.toast('No elements', 'info');
    },
  });

  /** Elements of a line and of everything that hangs from it. */
  function elementsOf(n: BudgetNode): string[] {
    return [...n.elements, ...n.children.flatMap(elementsOf)];
  }

  /** Chooses a code (in the BOQ and in the tree) without changing the 3D selection. */
  function pickCode(code: string): void {
    selectedCode = code;
    boqPanel.setSelected(code);
    tree.setSelected(code);
  }

  /** Chooses a code and selects in 3D the elements of its branch. */
  function selectCode(code: string): void {
    pickCode(code);
    const n = nodes.get(code);
    const list = n ? elementsOf(n) : [];
    if (list.length) d.viewer.selectMany(list);
  }

  function computeColors(): void {
    colors = new Map();
    if (!budget) return;
    if (colorBy === 'item') {
      let i = 0;
      const walk = (n: BudgetNode): void => {
        if (n.code.medicion) {
          for (const p of n.elements) colors.set(p, { color: itemColor(i), opacity: 1 });
          i++;
        }
        n.children.forEach(walk);
      };
      budget.roots.forEach(walk);
    } else if (colorBy === 'cost') {
      const sorted = [...budget.elementCost.values()].map((e) => e.amount).sort((a, b) => a - b);
      for (const [p, e] of budget.elementCost) colors.set(p, { color: rampColor(e.amount, sorted), opacity: 1 });
    }
  }

  function showElement(path: string | null): void {
    const m = path ? measures.get(path) ?? null : null;
    const paid = path ? budget?.elementCost.get(path) ?? null : null;
    const code = paid && system ? system.byCode.get(paid.code) ?? null : null;
    const reason = path ? budget?.unassigned.find((u) => u.path === path)?.reason ?? null : null;
    props.show(path, m, { code, amount: paid?.amount ?? 0, reason }, budget?.currency ?? 'USD');
    boqPanel.markCode(paid?.code ?? null);
  }

  function refresh(): void {
    const model = d.model();
    rows = model ? d.viewer.quantities(false) : [];
    measures = elementMeasures(rows, d.actions.materials(), d.wallLength);
    system = model ? readCostSystem(model.result) : null;
    if (system && model) {
      const sys = system;
      const elements = [...new Map(rows.map((r) => [r.element, { path: r.element, cls: r.cls }])).values()];
      const codeOf = (path: string): string | null => {
        const node = model.result.byPath.get(path);
        return node ? elementCode(node, sys) : null;
      };
      budget = computeBudget(sys, elements, codeOf, measures);
    } else {
      budget = null;
    }
    nodes = new Map();
    const index = (n: BudgetNode): void => {
      nodes.set(n.code.code, n);
      n.children.forEach(index);
    };
    budget?.roots.forEach(index);
    if (selectedCode && !nodes.has(selectedCode)) selectedCode = null;
    // one notice per change: that of the system, or that the budget is of the previous format (which Studio no longer reads)
    const legacy = !system && !!model && model.result.provenance.pathsWith(K_LEGACY_BUDGET).length > 0;
    const note = system?.warning ?? (legacy ? LEGACY_BUDGET : null);
    if (note && note !== warned) d.toast(note, 'info');
    warned = note;
    computeColors();
    boqPanel.setBudget(budget);
    boqPanel.setSelected(selectedCode);
    // the tree: how many elements each branch has
    const counts = new Map([...nodes].map(([code, n]) => [code, elementsOf(n).length]));
    tree.setSystem(system, counts);
    tree.setSelected(selectedCode);
    showElement(d.selected());
    apply();
  }

  /** The system if it can be written; otherwise, it says why and gives null. */
  function writable(): CostSystem | null {
    const sys = system;
    if (!editable || !sys) return null;
    if (sys.role !== 'import') {
      d.toast('Edit the costs file where it is imported', 'info');
      return null;
    }
    if (!sys.location) {
      d.toast('Save the costs file first', 'info');
      return null;
    }
    return sys;
  }

  /** Escribe el archivo del sistema; un fallo se avisa en lugar de perderse. */
  async function saveSystem(location: string, label: string, change: (file: IfcxFile) => IfcxFile | string): Promise<void> {
    try {
      await d.actions.saveFile(location, label, change);
    } catch (e) {
      d.toast(`Could not save the cost system: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  async function editSystem(): Promise<void> {
    const model = d.model();
    const sys = writable();
    if (!sys || !model) return;
    // elements with an item in the branch of each code, to warn before deleting it
    const elementsIn = (code: string): number => {
      const n = nodes.get(code);
      return n ? elementsOf(n).length : 0;
    };
    const entries = await askSystemEdit(sys, {
      currency: sys.currency,
      elementsIn,
      confirm: d.actions.confirm,
      docState,
      file: sys.location!.split(/[\\/]/).pop(),
      ...(d.actions.openQuote ? { openFile: d.actions.openQuote } : {}),
      ...(d.actions.readQuote ? { readFile: d.actions.readQuote } : {}),
    });
    if (!entries) return;
    await saveSystem(sys.location!, 'Edit Cost System', (file) => replaceSystemCodes(file, sys, entries));
  }

  async function moveCode(code: string, parent: string | null): Promise<void> {
    const sys = writable();
    const entry = sys?.byCode.get(code);
    if (!sys || !entry || entry.parent === parent) return;
    const edit = { name: entry.name, parent, medicion: entry.medicion, manualPrice: entry.manualPrice };
    await saveSystem(sys.location!, 'Move Cost Code', (file) => applyCodeEdit(file, sys, entry.path, edit));
  }

  /** What is selected in the viewer: everything, or the chosen element if the workspace gives no more. */
  function selection(): string[] {
    const many = d.selection?.() ?? [];
    if (many.length) return many;
    const one = d.selected();
    return one ? [one] : [];
  }

  /**
   * Writes the assignment layer: the item `code` (null = remove) on those elements, by their edit path. Then it
   * checks that the code that is seen is the requested one: a code written in the document or in another stronger layer wins over
   * esta capa, y entonces se avisa en lugar de dar el cambio por hecho.
   */
  async function writeAssignment(label: string, code: CostCode | null, paths: string[]): Promise<void> {
    const codePath = code?.path ?? null;
    const change = (file: IfcxFile, result: ComposeResult): IfcxFile => {
      const keys = paths.flatMap((p) => {
        const node = result.byPath.get(p);
        return node ? [editPath(node, result)] : [];
      });
      return assignCost(file, keys, codePath);
    };
    let ok = false;
    try {
      ok = await d.actions.assign(label, change);
    } catch (e) {
      d.toast(`Could not save the assignment: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    if (!ok) return;
    const model = d.model();
    const sys = model ? readCostSystem(model.result) : null;
    const want = code?.code ?? null;
    const kept = paths.filter((p) => {
      const node = model?.result.byPath.get(p);
      return (node && sys ? elementCode(node, sys) : null) !== want;
    }).length;
    if (kept) d.toast(kept === 1 ? '1 element keeps a code set in another layer' : `${kept} elements keep a code set in another layer`, 'info');
  }

  /** The item chosen to assign, or null (and it warns) if there is none or it is a heading line. */
  function itemToAssign(code: string | null): CostCode | null {
    const entry = code && system ? system.byCode.get(code) : undefined;
    if (!entry?.medicion) {
      d.toast('Choose an item, not a heading', 'info');
      return null;
    }
    return entry;
  }

  async function editItem(): Promise<void> {
    const model = d.model();
    const sys = system;
    const entry = sys && selectedCode ? sys.byCode.get(selectedCode) : undefined;
    if (!editable || !model || !sys || !entry) return;
    // the document and the layers of the Layer panel are not written through here: on save the model would be overwritten
    if (entry.role !== 'import') return d.toast('Edit the costs file where it is imported', 'info');
    if (!entry.location) return d.toast('Save the costs file first', 'info');
    const edit = await askCode(entry, sys);
    if (!edit) return;
    try {
      await d.actions.saveFile(entry.location, 'Edit Cost Item', (file) => applyCodeEdit(file, sys, entry.path, edit));
    } catch (e) {
      d.toast(`Could not save the cost item: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  return {
    panel: (slot) => hosts[slot] ?? null,
    enter() {
      active = true;
      refresh();
    },
    leave() {
      active = false;
      apply();
    },
    refresh,
    selectionChanged(path) {
      if (active) showElement(path);
    },
    editItem,
    editSystem,
    async assignToSelection() {
      if (!editable || !system) return;
      const entry = itemToAssign(selectedCode);
      if (!entry) return;
      const sel = selection();
      if (!sel.length) return d.toast('Select elements first', 'info');
      await writeAssignment('Assign Cost Item', entry, sel);
    },
    async clearAssignment() {
      if (!editable) return;
      const sel = selection();
      if (!sel.length) return d.toast('Select elements first', 'info');
      await writeAssignment('Clear Cost Item', null, sel);
    },
    dropCode(code, elementPath) {
      if (!editable || !elementPath || !system) return;
      const entry = itemToAssign(code);
      if (entry) void writeAssignment('Assign Cost Item', entry, [elementPath]);
    },
    setColorBy(v) {
      colorBy = v;
      computeColors();
      apply();
    },
    setEditable(on) {
      editable = on;
      tree.setEditable(on);
    },
  };
}
