// Material Editor: preview and fields of the chosen material. Each field is confirmed with `change` (or Enter).
import {
  createMaterialPreview, PREVIEW_SHAPES, webglAvailable, type MaterialPreview, type PreviewShape,
} from '../render/materialpreview';
import type { CatalogEntry } from './catalog';
import { K_DENSITY, K_DESCRIPTION, K_DIFFUSE, K_GLTF, K_MATERIAL, K_NAME, K_OPACITY } from './nodes';
import type { MaterialDef, MaterialTexture } from './state';
import { readTextureFile } from './textureimage';

export interface MaterialEditor {
  show(entry: CatalogEntry | null): void;
  setEditable(on: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface MaterialEditorCallbacks {
  onChange(code: string, def: MaterialDef): void;
  /** Carries the overrides of this model to the library of the material. */
  onPromote(code: string): void;
  /** Quita las sobrescrituras de este modelo. */
  onReset(code: string): void;
}

/** Side of the preview canvas, in CSS pixels. */
const PREVIEW_SIZE = 176;
const SHAPE_KEY = 'ifcx-studio.materialPreviewShape';
const SHAPE_LABEL: Record<PreviewShape, string> = { sphere: 'Sphere', plane: 'Plane', cube: 'Cube' };

function savedShape(): PreviewShape {
  try {
    const v = localStorage.getItem(SHAPE_KEY);
    return PREVIEW_SHAPES.find((x) => x === v) ?? 'sphere';
  } catch {
    return 'sphere';
  }
}

function saveShape(shape: PreviewShape): void {
  try {
    localStorage.setItem(SHAPE_KEY, shape);
  } catch {
    // no storage: the shape is only valid for this session
  }
}

/** La vista previa real; null si este entorno no tiene WebGL. */
const defaultPreview = (canvas: HTMLCanvasElement): MaterialPreview | null =>
  webglAvailable() ? createMaterialPreview(canvas, PREVIEW_SIZE) : null;

export function mountMaterialEditor(
  host: HTMLElement,
  cb: MaterialEditorCallbacks,
  makePreview: (canvas: HTMLCanvasElement) => MaterialPreview | null = defaultPreview,
  readImage: (file: File) => Promise<string> = readTextureFile,
): MaterialEditor {
  const root = el('section', 'ws-panel mat-editor');
  root.setAttribute('aria-label', 'Material');
  const body = el('div', 'ws-panel-body mat-body');
  const empty = el('p', 'mat-empty', 'Select a material to edit it.');
  const form = el('form', 'mat-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  const source = el('p', 'mat-source');
  const actions = el('div', 'mat-actions');
  const previewBox = el('div', 'mat-preview');
  const canvas = el('canvas', 'mat-preview-canvas');
  canvas.setAttribute('aria-label', 'Material preview');
  const shapes = el('div', 'mat-shapes');
  shapes.setAttribute('role', 'group');
  shapes.setAttribute('aria-label', 'Preview shape');
  const note = el('p', 'mat-preview-note', 'Preview not available');
  note.hidden = true;
  previewBox.append(canvas, shapes, note);
  // --- Texture: color image of the material and the meters it covers ---
  const textureBox = el('div', 'mat-texture');
  const thumb = el('img', 'mat-texture-thumb');
  thumb.alt = 'Texture';
  const textureNote = el('p', 'mat-texture-note');
  const chooseBtn = el('button', 'mat-action mat-texture-choose', 'Choose image…');
  chooseBtn.type = 'button';
  const removeBtn = el('button', 'mat-action mat-texture-remove', 'Remove');
  removeBtn.type = 'button';
  const fileInput = el('input', 'mat-texture-file');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  const textureBar = el('div', 'mat-actions');
  textureBar.append(chooseBtn, removeBtn, fileInput);
  const sizeRow = el('div', 'mat-texture-size');
  const sizeField = (label: string) => {
    const wrap = el('label', 'mat-field');
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    wrap.append(el('span', 'mat-field-label', label), input);
    sizeRow.append(wrap);
    return input;
  };
  const texWidth = sizeField('Width (m)');
  const texHeight = sizeField('Height (m)');
  textureBox.append(el('span', 'mat-field-label', 'Texture'), thumb, textureNote, textureBar, sizeRow);
  body.append(empty, source, previewBox, textureBox, form, actions);
  root.append(el('header', 'ws-panel-title', 'Material'), body);
  host.replaceChildren(root);

  const wraps = new Map<HTMLInputElement, HTMLElement>();
  const field = (label: string, type: string, attrs: Partial<HTMLInputElement> = {}) => {
    const wrap = el('label', 'mat-field');
    const input = el('input');
    input.type = type;
    Object.assign(input, attrs);
    wrap.append(el('span', 'mat-field-label', label), input);
    form.append(wrap);
    wraps.set(input, wrap);
    return input;
  };
  const name = field('Name', 'text');
  const code = field('Code', 'text');
  const color = field('Color', 'color');
  const opacity = field('Opacity', 'number', { min: '0', max: '100', step: '1' });
  const density = field('Density (kg/m³)', 'number', { min: '0', step: 'any' });
  const description = field('Description', 'text');
  const uri = field('URI', 'text');
  const inputs = [name, code, color, opacity, density, description, uri];
  /** Which attribute of the node each field overrides. */
  const keyOf = new Map<HTMLInputElement, string>([
    [name, K_NAME], [code, K_MATERIAL], [uri, K_MATERIAL], [color, K_DIFFUSE], [opacity, K_OPACITY], [density, K_DENSITY], [description, K_DESCRIPTION],
  ]);
  const actionBtn = (label: string, onClick: () => void) => {
    const b = el('button', 'mat-action', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  let current: CatalogEntry | null = null;
  let editable = true;
  /** Texture of the chosen material as confirmed. */
  let texture: MaterialTexture | undefined;
  /** Último error al leer una imagen; se borra al cambiar de material. */
  let textureError = '';

  // --- Preview: created the first time there is a material to show ---
  let shape = savedShape();
  let preview: MaterialPreview | null = null;
  let previewTried = false;
  const shapeBtns = new Map<PreviewShape, HTMLButtonElement>();
  for (const sh of PREVIEW_SHAPES) {
    const b = el('button', 'mat-shape', SHAPE_LABEL[sh]);
    b.type = 'button';
    b.addEventListener('click', () => {
      shape = sh;
      saveShape(sh);
      markShape();
      preview?.setShape(sh);
    });
    shapeBtns.set(sh, b);
    shapes.append(b);
  }
  function markShape(): void {
    for (const [sh, b] of shapeBtns) b.setAttribute('aria-pressed', String(sh === shape));
  }
  markShape();

  function ensurePreview(): void {
    if (previewTried) return;
    previewTried = true;
    try {
      preview = makePreview(canvas);
    } catch {
      preview = null;
    }
    note.hidden = preview !== null;
    canvas.hidden = preview === null;
    shapes.hidden = preview === null;
    preview?.setShape(shape);
  }

  function showPreview(color: string, opacity: number, tex: MaterialTexture | undefined = texture): void {
    ensurePreview();
    preview?.setMaterial({ color, opacity, ...(tex ? { texture: tex } : {}) });
  }

  function sync(): void {
    previewBox.hidden = current === null;
    textureBox.hidden = current === null;
    const on = editable && current !== null;
    for (const i of inputs) i.disabled = !on;
    chooseBtn.disabled = !on;
    fileInput.disabled = !on;
    removeBtn.disabled = !on || !texture;
    texWidth.disabled = texHeight.disabled = !on || !texture;
    empty.hidden = current !== null;
    form.hidden = current === null;
    source.hidden = current === null;
    for (const b of actions.querySelectorAll('button')) b.disabled = !editable;
  }

  /** Which file the material is from, what this model overrides and the actions that come from there. */
  function describe(e: CatalogEntry): void {
    source.textContent =
      e.site === null ? 'Not defined in any file' : e.site === 'document' ? 'Defined in this model' : `Defined in ${e.sourceName}`;
    for (const [input, wrap] of wraps) wrap.classList.toggle('mat-field-overridden', e.overridden.includes(keyOf.get(input)!));
    textureBox.classList.toggle('mat-field-overridden', e.overridden.includes(K_GLTF));
    actions.replaceChildren();
    if (e.overridden.length === 0) return;
    if (e.site === 'library') actions.append(actionBtn('Change in library', () => cb.onPromote(e.def.code)));
    actions.append(actionBtn('Reset', () => cb.onReset(e.def.code)));
  }

  function renderTexture(): void {
    thumb.hidden = !texture;
    if (texture) thumb.setAttribute('src', texture.image);
    else thumb.removeAttribute('src');
    sizeRow.hidden = !texture;
    texWidth.value = texture ? String(texture.width) : '';
    texHeight.value = texture ? String(texture.height) : '';
    const text = textureError || (texture ? '' : 'No texture');
    textureNote.textContent = text;
    textureNote.hidden = text === '';
  }

  function fill(e: CatalogEntry): void {
    const d = e.def;
    name.value = d.name;
    code.value = d.code;
    color.value = d.color;
    opacity.value = String(Math.round(d.opacity * 100));
    density.value = d.density === undefined ? '' : String(d.density);
    description.value = d.description ?? '';
    uri.value = d.uri ?? '';
    texture = d.texture ? { ...d.texture } : undefined;
    textureError = '';
    renderTexture();
    showPreview(d.color, d.opacity);
  }

  const read = (): MaterialDef => ({
    name: name.value,
    code: code.value,
    color: color.value,
    opacity: Number(opacity.value) / 100,
    ...(description.value ? { description: description.value } : {}),
    ...(uri.value ? { uri: uri.value } : {}),
    ...(density.value !== '' ? { density: Number(density.value) } : {}),
    ...(texture ? { texture } : {}),
  });

  for (const i of inputs) i.addEventListener('change', () => current && cb.onChange(current.def.code, read()));
  // color y opacidad se ven al mover el control, antes de confirmar el cambio
  const live = () => {
    const op = Number(opacity.value) / 100;
    if (current && Number.isFinite(op) && op >= 0 && op <= 1) showPreview(color.value, op);
  };
  color.addEventListener('input', live);
  opacity.addEventListener('input', live);

  // --- Texture: choose, remove and adjust the size ---
  const commit = () => current && cb.onChange(current.def.code, read());
  chooseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    const shown = current;
    if (!file || !shown) return;
    try {
      fileInput.value = '';
    } catch {
      // the same file cannot be chosen again until the material changes: it does not matter
    }
    try {
      const image = await readImage(file);
      if (current !== shown) return; // while it was being read, another material was chosen
      texture = { image, width: texture?.width ?? 1, height: texture?.height ?? 1 };
      textureError = '';
      renderTexture();
      sync();
      live();
      commit();
    } catch (err) {
      if (current !== shown) return;
      textureError = err instanceof Error ? err.message : 'Could not read that image';
      renderTexture();
    }
  });
  removeBtn.addEventListener('click', () => {
    texture = undefined;
    textureError = '';
    renderTexture();
    sync();
    live();
    commit();
  });
  /** Typed size, or null if it is not a positive number. */
  const typedSize = (): { width: number; height: number } | null => {
    const w = Number(texWidth.value);
    const h = Number(texHeight.value);
    return texWidth.value !== '' && texHeight.value !== '' && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
  };
  for (const input of [texWidth, texHeight]) {
    input.addEventListener('input', () => {
      const size = typedSize();
      if (current && texture) showPreview(color.value, Number(opacity.value) / 100, size ? { ...texture, ...size } : texture);
    });
    input.addEventListener('change', () => {
      const size = typedSize();
      if (size && texture) {
        texture = { ...texture, ...size };
        commit();
      } else renderTexture(); // an impossible size goes back to the confirmed one
    });
  }
  sync();

  return {
    show(e) {
      current = e;
      if (e) {
        fill(e);
        describe(e);
      }
      sync();
    },
    setEditable(on) {
      editable = on;
      sync();
    },
  };
}
