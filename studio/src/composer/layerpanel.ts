// Layer panel: the composer stack. One row per linked file (handle, checkbox, color, name,
// "placed", Place…, "link" and ×), its edit layer below if it has edits (with its
// collapsible orphan edits) and the document at the end. It only paints and notifies; the state is kept by the controller.
import { svgIcon } from '../shell/icons';
import { toggleRadioMenu } from '../shell/radiomenu';
import { LAYER_DRAG_TYPE, type PlaceTarget, type StackRow } from './rows';
import { DOCUMENT_COLOR } from './stack';

export interface LayerPanelCallbacks {
  onAdd(): void;
  onToggle(id: string, on: boolean): void;
  onToggleEdits(id: string, on: boolean): void;
  onRemove(id: string): void;
  onMoveLayer(id: string, toIndex: number): void;
  onRelink(id: string): void;
  /** Place the file under the project or a level (Place… menu or drag the row to the Stage). */
  onPlace?(layerId: string, stageParentOrigin: string): void;
  onUnplace?(layerId: string): void;
  /** Deletes an orphan edit (the path of the element that no longer exists in the file). */
  onRemoveEdit?(layerId: string, path: string): void;
  /**
   * The layers hidden with the eye changed: their elements are not drawn, but they remain in the composition
   * (unlike the checkbox, which recomposes without the layer). It belongs to the view: it is not saved.
   */
  onHiddenLayersChange?(hidden: ReadonlySet<string>): void;
}

export interface LayerPanel {
  setStack(rows: StackRow[] | null): void;
  /** Hides or shows a layer in the view, like the eye of its row. false if the id is not a layer. */
  setHidden(id: string, hidden: boolean): boolean;
}

type FileRow = Extract<StackRow, { kind: 'file' }>;

/** Value of the Unplace option in the Place… menu (the ids of the targets are UUIDs). */
const UNPLACE = 'unplace:';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // siempre texto: los nombres vienen de archivos
  return e;
}

function swatch(color: string): HTMLElement {
  const s = el('span', 'layer-swatch');
  if (color) s.style.setProperty('--layer-color', color);
  return s;
}

function checkbox(checked: boolean, label: string, onChange?: (on: boolean) => void): HTMLInputElement {
  const c = el('input', 'layer-check');
  c.type = 'checkbox';
  c.checked = checked;
  c.setAttribute('aria-label', label);
  if (onChange) c.addEventListener('change', () => onChange(c.checked));
  else c.disabled = true;
  return c;
}

export function mountLayerPanel(host: HTMLElement, cb: LayerPanelCallbacks): LayerPanel {
  host.replaceChildren();
  host.classList.add('layer-panel');
  const bar = el('div', 'layer-bar');
  const add = el('button', 'ws-layers-add', '+');
  add.type = 'button';
  add.title = 'Add layer from an .ifcx file';
  add.setAttribute('aria-label', 'Add layer');
  add.disabled = true; // hasta que haya un documento
  add.addEventListener('click', () => cb.onAdd());
  bar.append(add);
  const list = el('ul', 'layer-list');
  list.hidden = true;
  host.append(bar, list);

  // --- Arrastrar para reordenar ------------------------------------------------------
  /** Layer being dragged (the DataTransfer cannot be read during dragover in all engines). */
  let dragId: string | null = null;
  let fileIds: string[] = [];
  /** Insertion position among the links (0..n) according to the row and the half under the pointer. */
  let insertAt: number | null = null;
  /** Where a file can be placed (empty in read-only: no Place…). */
  let targets: PlaceTarget[] = [];

  const clearMarks = () => {
    for (const r of list.querySelectorAll('.drop-before, .drop-after')) r.classList.remove('drop-before', 'drop-after');
  };

  /** Last row of the layer (file, edits and expanded orphans), without selectors: the id is not put in CSS. */
  const lastRowOf = (id: string | undefined): HTMLElement | null =>
    [...list.querySelectorAll<HTMLElement>('.layer-row')].filter((r) => r.dataset.layer === id).at(-1) ?? null;

  /** Insertion for dropping on `li`: before or after its file; the document bounds it at the end. */
  const insertionFor = (li: HTMLElement, clientY: number): { at: number; mark: HTMLElement; before: boolean } | null => {
    const id = li.dataset.layer;
    if (li.dataset.kind === 'document' || !id) {
      const lastId = fileIds.at(-1);
      const mark = lastRowOf(lastId);
      return mark ? { at: fileIds.length, mark, before: false } : null;
    }
    const i = fileIds.indexOf(id);
    if (i < 0) return null;
    // the rows of edits and orphans count as the lower half of their file
    if (li.dataset.kind === 'edits' || li.dataset.kind === 'orphan') return { at: i + 1, mark: li, before: false };
    const r = li.getBoundingClientRect();
    const before = clientY < r.top + r.height / 2;
    return { at: before ? i : i + 1, mark: before ? li : lastRowOf(id) ?? li, before };
  };

  const rowOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? t.closest<HTMLElement>('.layer-row') : null;

  list.addEventListener('dragover', (e) => {
    const li = rowOf(e.target);
    if (!dragId || !li) return;
    const ins = insertionFor(li, e.clientY);
    if (!ins) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    insertAt = ins.at;
    clearMarks();
    ins.mark.classList.add(ins.before ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('dragleave', (e) => {
    if (!(e.relatedTarget instanceof Node) || !list.contains(e.relatedTarget)) clearMarks();
  });
  list.addEventListener('drop', (e) => {
    const li = rowOf(e.target);
    const id = dragId;
    const ins = li ? insertionFor(li, e.clientY) : null;
    const at = ins?.at ?? insertAt;
    dragId = null;
    insertAt = null;
    clearMarks();
    if (!id || at === null) return;
    e.preventDefault();
    const from = fileIds.indexOf(id);
    if (from < 0) return;
    const to = at > from ? at - 1 : at;
    if (to !== from) cb.onMoveLayer(id, to);
  });

  // --- Filas -----------------------------------------------------------------------------
  const fileRow = (r: FileRow): HTMLElement => {
    const li = el('li', 'layer-row layer-file');
    li.dataset.kind = 'file';
    li.dataset.layer = r.id;
    li.classList.toggle('disabled', !r.enabled);
    li.classList.toggle('missing', r.missing);
    li.title = r.missing ? `File not found: ${r.path}` : r.path;

    const grip = el('span', 'layer-grip', '⠿');
    grip.draggable = true;
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');
    grip.addEventListener('dragstart', (e) => {
      dragId = r.id;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', r.id);
        // it can also be dropped on the Stage, on the project or a level, to place it
        e.dataTransfer.setData(LAYER_DRAG_TYPE, r.id);
        e.dataTransfer.effectAllowed = 'copyMove';
      }
      li.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      dragId = null;
      insertAt = null;
      li.classList.remove('dragging');
      clearMarks();
    });

    const check = checkbox(r.enabled, `${r.enabled ? 'Disable' : 'Enable'} layer ${r.name}`, (on) => cb.onToggle(r.id, on));
    li.append(grip, check, swatch(r.color), el('span', 'layer-name', r.name));
    if (cb.onHiddenLayersChange) {
      const off = hiddenLayers.has(r.id);
      li.classList.toggle('is-hidden', off);
      const eye = el('button', 'layer-eye');
      eye.type = 'button';
      eye.append(svgIcon(off ? 'eyeOff' : 'eye', 14));
      eye.setAttribute('aria-pressed', String(off));
      const label = `${off ? 'Show' : 'Hide'} ${r.name} in the view`;
      eye.setAttribute('aria-label', label);
      eye.title = label;
      eye.addEventListener('click', () => {
        if (hiddenLayers.has(r.id)) hiddenLayers.delete(r.id);
        else hiddenLayers.add(r.id);
        cb.onHiddenLayersChange?.(new Set(hiddenLayers));
        repaint();
      });
      li.append(eye);
    }
    const parent = r.placedIn !== undefined ? targets.find((t) => t.id === r.placedIn) : undefined;
    if (r.placedIn !== undefined) {
      const tag = el('span', 'layer-tag', 'placed');
      tag.title = `Placed under ${r.placedInName ?? parent?.name ?? 'the document'}`;
      li.append(tag);
    }
    if (targets.length && (cb.onPlace || cb.onUnplace)) li.append(placeButton(r));
    if (r.missing) {
      const relink = el('button', 'layer-relink', 'Relink…');
      relink.type = 'button';
      relink.title = 'Choose the new location of the file';
      relink.addEventListener('click', () => cb.onRelink(r.id));
      li.append(relink);
    }
    const rm = el('button', 'layer-remove', '×');
    rm.type = 'button';
    rm.title = 'Remove layer';
    rm.setAttribute('aria-label', `Remove layer ${r.name}`);
    rm.addEventListener('click', () => cb.onRemove(r.id));
    li.append(el('span', 'layer-tag', 'link'), rm);
    return li;
  };

  /** Place…: a menu with the project and the levels (the current one marked) and Unplace if it is already placed. */
  const placeButton = (r: FileRow): HTMLButtonElement => {
    const b = el('button', 'layer-relink layer-place', 'Place…');
    b.type = 'button';
    b.title = 'Place this file under the project or a level (or drag it onto any node of the Stage)';
    b.setAttribute('aria-label', `Place ${r.name}`);
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      const options = targets.map((t) => ({ value: t.id, label: t.name }));
      if (r.placedIn !== undefined) options.push({ value: UNPLACE, label: 'Unplace' });
      toggleRadioMenu(b, options, r.placedIn ?? null, (v) => {
        if (v === UNPLACE) cb.onUnplace?.(r.id);
        else cb.onPlace?.(r.id, v);
      });
    });
    return b;
  };

  /** Layers with the orphans expanded (it survives repainting the stack). */
  const openOrphans = new Set<string>();

  const editsRow = (r: FileRow): HTMLElement => {
    const li = el('li', 'layer-row layer-edits');
    li.dataset.kind = 'edits';
    li.dataset.layer = r.id;
    li.classList.toggle('disabled', !r.enabled || !r.editsEnabled);
    const label = `Edits · ${r.name}`;
    const check = checkbox(r.editsEnabled, `${r.editsEnabled ? 'Disable' : 'Enable'} ${label}`, (on) => cb.onToggleEdits(r.id, on));
    const n = r.editCount;
    const m = r.orphans.length;
    const count = `${n} ${n === 1 ? 'edit' : 'edits'}${m > 0 ? ` · ${m} orphaned` : ''}`;
    li.append(el('span', 'layer-grip-space'), check);
    if (m > 0) li.append(orphanToggle(r));
    li.append(el('span', 'layer-name', `↳ ${label}`), el('span', 'layer-count', count));
    return li;
  };

  /** Button that expands or collapses the orphan list of the layer. */
  const orphanToggle = (r: FileRow): HTMLButtonElement => {
    const open = openOrphans.has(r.id);
    const b = el('button', 'layer-toggle', open ? '▾' : '▸');
    b.type = 'button';
    b.title = open ? 'Hide orphaned edits' : 'Show orphaned edits';
    b.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} orphaned edits of ${r.name}`);
    b.setAttribute('aria-expanded', String(open));
    b.addEventListener('click', () => {
      if (open) openOrphans.delete(r.id);
      else openOrphans.add(r.id);
      repaint();
    });
    return b;
  };

  /** An orphan edit: its path and a × that deletes it. */
  const orphanRow = (r: FileRow, path: string): HTMLElement => {
    const li = el('li', 'layer-row layer-orphan');
    li.dataset.kind = 'orphan';
    li.dataset.layer = r.id;
    li.title = `Element no longer exists in ${r.name}`;
    const rm = el('button', 'layer-remove', '×');
    rm.type = 'button';
    rm.title = 'Remove orphaned edit';
    rm.setAttribute('aria-label', `Remove orphaned edit ${path}`);
    rm.addEventListener('click', () => cb.onRemoveEdit?.(r.id, path));
    li.append(el('span', 'layer-grip-space'), el('span', 'layer-warn', '⚠'), el('span', 'layer-name', path), rm);
    return li;
  };

  const documentRow = (r: Extract<StackRow, { kind: 'document' }>): HTMLElement => {
    const li = el('li', 'layer-row layer-doc');
    li.dataset.kind = 'document';
    li.title = r.path ?? r.name;
    li.append(
      el('span', 'layer-grip-space'),
      checkbox(true, `Document ${r.name}`),
      swatch(DOCUMENT_COLOR),
      el('span', 'layer-name', r.name),
      el('span', 'layer-tag', 'Document'),
    );
    return li;
  };

  let current: StackRow[] | null = null;
  /** Layers hidden with the eye (by id); a removed layer drops out of the set. */
  const hiddenLayers = new Set<string>();
  function repaint(): void {
    const rows = current;
    add.disabled = !rows;
    list.hidden = !rows;
    fileIds = (rows ?? []).filter((r): r is FileRow => r.kind === 'file').map((r) => r.id);
    const before = hiddenLayers.size;
    for (const id of [...hiddenLayers]) if (!fileIds.includes(id)) hiddenLayers.delete(id);
    if (hiddenLayers.size !== before) cb.onHiddenLayersChange?.(new Set(hiddenLayers));
    targets = (rows ?? []).flatMap((r) => (r.kind === 'document' ? r.targets ?? [] : []));
    const items: HTMLElement[] = [];
    for (const r of rows ?? []) {
      if (r.kind === 'document') continue;
      items.push(fileRow(r));
      if (r.editCount > 0) {
        items.push(editsRow(r));
        if (r.orphans.length > 0 && openOrphans.has(r.id)) items.push(...r.orphans.map((p) => orphanRow(r, p)));
      }
    }
    for (const r of rows ?? []) if (r.kind === 'document') items.push(documentRow(r));
    list.replaceChildren(...items);
  }

  return {
    setStack(rows) {
      current = rows;
      repaint();
    },
    setHidden(id, hidden) {
      if (!fileIds.includes(id)) return false;
      if (hiddenLayers.has(id) === hidden) return true;
      if (hidden) hiddenLayers.add(id);
      else hiddenLayers.delete(id);
      cb.onHiddenLayersChange?.(new Set(hiddenLayers));
      repaint();
      return true;
    },
  };
}
