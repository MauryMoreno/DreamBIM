import { mountProjectBrowser } from '../browser/browser';
import type { ViewRef } from '../browser/views';
import { mountLayerPanel } from '../composer/layerpanel';
import { mountReferencesPanel } from '../composer/refspanel';
import type { StackRow } from '../composer/rows';
import { mountStagePanel, type StageData } from '../composer/stagepanel';
import type { ComposedNode } from '../ifcx/types';
import type { LoadedModel } from '../model/load';
import { copyPath } from '../properties/copy';
import type { LinkedProps, PayloadToggle } from '../properties/groups';
import { PropertiesPanel } from '../properties/panel';
import type { RefContext } from '../properties/references';
import type { LevelInfo } from '../render/levels';
import type { WorkspaceContext } from './context';
import type { SelectionFrom } from './selection';

export interface PanelsDeps {
  select(path: string | null, from?: SelectionFrom, toggle?: boolean): void;
  openView(v: ViewRef): void;
}

export interface PanelsController {
  showProperties(node: ComposedNode | null): void;
  reveal(path: string | null): void;
  markSelected(paths: string[]): void;
  selectReference(node: ComposedNode | null): void;
  setReferencesModel(m: { result: LoadedModel['result']; path: string | null } | null): void;
  setBrowserModel(root: ComposedNode | null, levels: LevelInfo[]): void;
  setStage(data: StageData): void;
  readonly stageData: StageData;
  setStack(rows: StackRow[] | null): void;
  setModeHidden(paths: ReadonlySet<string>): void;
  applyHidden(): void;
  isLayerHidden(id: string): boolean;
  setLayerHidden(id: string, hidden: boolean): boolean;
  readonly referencesShown: () => void;
  readonly editsOff: ReadonlySet<string>;
}

export function mountPanels(ctx: WorkspaceContext, deps: PanelsDeps): PanelsController {
  const { layout, state, viewer, opts } = ctx;
  const { props, browser, stageHost, layerHost, refsHost } = layout;

  const properties = new PropertiesPanel(props.body);

  const projectBrowser = mountProjectBrowser(browser.body, {
    onOpenView: (v) => deps.openView(v),
    onSelectView: (v) => {
      if (v.kind === 'plan') deps.select(v.level.path, 'browser');
    },
  });

  /** Hidden from the Stage eye (paths) and from Layer's (layer ids). */
  let stageHidden: ReadonlySet<string> = new Set();
  /** What the active mode hides (pending in the Schedule 4D); added to what Stage and Layer hide. */
  let modeHidden: ReadonlySet<string> = new Set();
  let hiddenLayers: ReadonlySet<string> = new Set();
  /** Data of the Stage brought by the last setComposer (the model renews it when it changes). */
  let stageData: StageData = { root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() };
  /** Layers with their edits off: their elements are not edited (no Move, no arrows, no Properties). */
  let editsOff: ReadonlySet<string> = new Set();

  /**
   * The view hides what the Stage hides and, for each hidden layer, the nodes that come from it: only
   * the top ones, because hiding a node already hides what hangs from it.
   */
  function applyHidden(): void {
    const paths = new Set([...stageHidden, ...modeHidden]);
    const root = stageData.root;
    if (hiddenLayers.size && root) {
      const walk = (n: ComposedNode): void => {
        const s = stageData.sourceOf.get(n.origin);
        if (s && hiddenLayers.has(s)) paths.add(n.path);
        else n.children.forEach(walk);
      };
      root.children.forEach(walk);
    }
    viewer.setHidden(paths);
  }

  // the Stage passes the path of the row: each instance of a reused element is its own
  const stage = mountStagePanel(stageHost, {
    onSelect: (_origin, path, toggle) => {
      if (state.model?.result.byPath.has(path)) deps.select(path, 'stage', toggle);
    },
    onFit: (_origin, path) => {
      if (!state.model?.result.byPath.has(path)) return;
      deps.select(path, 'stage');
      viewer.fit(path);
    },
    onReparent: (origin, newParentOrigin, { layer, node, parent }) =>
      void opts.composer?.reparent?.(layer, origin, newParentOrigin, { node, parent }),
    onPlace: (layerId, parentOrigin) => opts.composer?.onPlace?.(layerId, parentOrigin),
    onPlaceAsset: (path, parentOrigin) => void opts.composer?.placeAsset?.(path, parentOrigin),
    canPlace: () => state.editable, // in read-only the controller does not place: dropping is not offered
    onHiddenChange: (hidden) => {
      stageHidden = hidden;
      applyHidden();
    },
  });

  const layerPanel = mountLayerPanel(layerHost, {
    onAdd: () => opts.composer?.onAdd(),
    onToggle: (id, on) => opts.composer?.onToggle(id, on),
    onToggleEdits: (id, on) => opts.composer?.onToggleEdits(id, on),
    onRemove: (id) => opts.composer?.onRemove(id),
    onMoveLayer: (id, to) => opts.composer?.onMoveLayer(id, to),
    onRelink: (id) => opts.composer?.onRelink(id),
    onPlace: (id, parentOrigin) => opts.composer?.onPlace?.(id, parentOrigin),
    onUnplace: (id) => opts.composer?.onUnplace?.(id),
    onRemoveEdit: (id, path) => opts.composer?.onRemoveEdit?.(id, path),
    onHiddenLayersChange: (hidden) => {
      hiddenLayers = hidden;
      applyHidden();
    },
  });

  // References tab: the model's linked files; Open goes through the app's open flow
  const references = mountReferencesPanel(refsHost, { open: (p) => opts.openReference?.(p), copy: copyPath });

  /**
   * Properties of the node: in an editable document, the Studio fields and, if the element comes from
   * a linked layer (the Stage's `sourceOf`), its simple attributes, which are overridden in that layer.
   */
  function showProperties(node: ComposedNode | null): void {
    const toggle = node ? payloadToggle(node) : undefined;
    properties.show(
      node,
      state.model?.result.schemas ?? {},
      state.editable ? opts.studio : undefined,
      node ? linkedProps(node) : undefined,
      toggle,
      state.model ? referenceContext(state.model) : undefined,
    );
    properties.setCount(Math.max(1, state.selection.length));
  }

  /** Provenance of the open model and the actions of the References rows. */
  function referenceContext(m: LoadedModel): RefContext {
    return {
      provenance: m.result.provenance,
      docPath: m.path,
      open: opts.openReference,
      copy: copyPath,
    };
  }

  /** Loading a payload edits nothing: it also works in read-only. */
  function payloadToggle(node: ComposedNode): PayloadToggle | undefined {
    const set = opts.composer?.setPayloadLoaded;
    if (!set || !node.payloads) return undefined;
    const layer = stageData.sourceOf.get(node.origin) ?? 'document';
    return (uri, on) => set(uri, on, layer);
  }

  function linkedProps(node: ComposedNode): LinkedProps | undefined {
    const layer = stageData.sourceOf.get(node.origin);
    const c = opts.composer;
    if (!state.editable || !layer || layer === 'document' || editsOff.has(layer) || !c?.setLinkedAttr || !c.resetLinkedAttr) return undefined;
    const { setLinkedAttr, resetLinkedAttr, linkedAttrEdited, setLinkedVariant, resetLinkedVariant, linkedVariantEdited } = c;
    return {
      edited: (key) => linkedAttrEdited?.(layer, node, key) ?? false,
      set: (key, value) => setLinkedAttr(layer, node, key, value),
      reset: (key) => resetLinkedAttr(layer, node, key),
      variantEdited: (set) => linkedVariantEdited?.(layer, node, set) ?? false,
      setVariant: setLinkedVariant && ((set, option) => setLinkedVariant(layer, node, set, option)),
      resetVariant: resetLinkedVariant && ((set) => resetLinkedVariant(layer, node, set)),
    };
  }

  function setStage(data: StageData): void {
    stageData = data;
    stage.setStage(data);
    if (hiddenLayers.size) applyHidden(); // after recomposing, the nodes of the hidden layers may be others
  }

  function setStack(rows: StackRow[] | null): void {
    layerPanel.setStack(rows);
    editsOff = new Set((rows ?? []).flatMap((r) => (r.kind === 'file' && !r.editsEnabled ? [r.id] : [])));
  }

  function setModeHidden(paths: ReadonlySet<string>): void {
    modeHidden = paths;
    applyHidden();
  }

  return {
    showProperties,
    reveal: (path) => stage.reveal(path),
    markSelected: (paths) => stage.markSelected(paths),
    selectReference: (node) => references.select(node),
    setReferencesModel: (m) => references.setModel(m),
    setBrowserModel: (root, levels) => projectBrowser.setModel(root, levels),
    setStage,
    get stageData() {
      return stageData;
    },
    setStack,
    setModeHidden,
    applyHidden,
    isLayerHidden: (id) => hiddenLayers.has(id),
    setLayerHidden: (id, hidden) => layerPanel.setHidden(id, hidden),
    referencesShown: () => references.shown(),
    get editsOff() {
      return editsOff;
    },
  };
}
