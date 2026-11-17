import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { svgIcon } from '../src/shell/icons';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import type { CameraState, LevelInfo } from '../src/render/levels';
import type { QuantityRow } from '../src/render/viewer';
import type { ComposedNode } from '../src/ifcx/types';
import { loadModel, type LoadedModel } from '../src/model/load';
import { offlineFetcher } from '../src/model/schemas';
import {
  mountWorkspace, GANTT_HEIGHT, NOT_STUDIO, PLAN_TOP_CLEARANCE, type ComposerActions, type WorkspaceOptions, type WorkspaceViewer,
} from '../src/workspace/workspace';
import { DEFAULT_LAYOUT, loadLayout, saveLayout } from '../src/workspace/layoutstate';
import { newDocument, stairOf, toIfcx } from '../src/modeling/document';
import { STATUS_HINT, hoverText } from '../src/workspace/statusbar';
import { CUT_COLORS, GRID_COLORS, HIDDEN_FACE_COLORS, initTheme, setThemePref } from '../src/shell/theme';
import { editPath } from '../src/composer/edits';
import { worldOrigin } from '../src/composer/xform';
import { LAYER_DRAG_TYPE, type StackRow } from '../src/composer/rows';
import { FakeTransformControls } from './fake-transform';
import { mountBuiltBotColumn } from '../src/assistant/builtbot/column';

const LEVELS: LevelInfo[] = [
  { path: '/p/n0', name: 'Level 0', minZ: 0, maxZ: 3 },
  { path: '/p/n1', name: 'Level 1', minZ: 3, maxZ: 6 },
];

/** Fake viewer: it records the calls and simulates the camera (without WebGL). */
class FakeViewer implements WorkspaceViewer {
  readonly camera = new THREE.PerspectiveCamera();
  readonly scene = new THREE.Scene();
  calls: [string, ...unknown[]][] = [];
  walking = false;
  walkLocked = false;
  walkFlying = false;
  levelsOut: LevelInfo[] = LEVELS;
  modelFootprint: { minX: number; minY: number; maxX: number; maxY: number } | null = { minX: 0, minY: 0, maxX: 10, maxY: 4 };
  cam: CameraState = { position: [1, 1, 1], target: [0, 0, 0], fov: 45, projection: 'perspective' };
  onPick: (p: string | null, toggle?: boolean) => void = () => {};
  onHover: (p: string | null) => void = () => {};
  onWalkChange: () => void = () => {};

  private log(name: string, ...args: unknown[]) {
    this.calls.push([name, ...args]);
  }
  setModel(root: ComposedNode | null) {
    this.log('setModel', root);
    return { nodes: 0, meshes: 0, curves: 0, points: 0, triangles: 0, failed: 0 };
  }
  disposeModel() { this.log('disposeModel'); }
  setEmptyGrid(e: number | null) { this.log('setEmptyGrid', e); }
  levels() { return this.levelsOut; }
  select(p: string | null) { this.log('select', p); }
  fit(p?: string | string[] | null, animate?: boolean) { this.log('fit', p, animate); }
  view(n: 'iso' | 'top' | 'front' | 'right') {
    this.log('view', n);
    this.cam = { ...this.cam, position: [n.length, 0, 0] }; // the camera changes with each view
  }
  orient(d: { x: number; y: number; z: number }) { this.log('orient', [d.x, d.y, d.z]); }
  setProjection(m: 'perspective' | 'orthographic') {
    this.log('setProjection', m);
    this.cam = { ...this.cam, projection: m };
  }
  getCameraState() { return this.cam; }
  setCameraState(s: CameraState) {
    this.log('setCameraState', s);
    this.cam = s;
  }
  setSectionBox(on: boolean) { this.log('setSectionBox', on); }
  setSectionAt(on: boolean, z: number) { this.log('setSectionAt', on, z); }
  setLevelFocus(f: { current: string; underlay: string[] } | null) { this.log('setLevelFocus', f); }
  setGridZ(z: number | null) { this.log('setGridZ', z); }
  setXray(on: boolean) { this.log('setXray', on); }
  setShadows(on: boolean) { this.log('setShadows', on); }
  setLod(o: { enabled: boolean; force?: number }) { this.log('setLod', o); }
  setGrid(on: boolean) { this.log('setGrid', on); }
  setGridColors(c: number, l: number) { this.log('setGridColors', c, l); }
  setCutColor(c: number) { this.log('setCutColor', c); }
  setEdgeColor(c: number) { this.log('setEdgeColor', c); }
  setHiddenFaceColor(c: number) { this.log('setHiddenFaceColor', c); }
  setHidden(p: Set<string>) { this.log('setHidden', [...p]); }
  setColorOverride(fn: ((p: string) => { color: string; opacity: number } | null) | null) { this.log('setColorOverride', fn); }
  quantitiesOut: QuantityRow[] = [];
  quantities() { this.log('quantities'); return this.quantitiesOut; }
  selectMany(p: string[] | null) { this.log('selectMany', p); }
  setAssistantColors(c: ReadonlyMap<string, unknown> | null) { this.log('setAssistantColors', c); }
  setSavedColors(c: ReadonlyMap<string, unknown> | null) { this.log('setSavedColors', c); }
  pickOut: string | null = null;
  pick(_e: MouseEvent) { return this.pickOut; }
  setVisualStyle(st: string) { this.log('setVisualStyle', st); }
  enterWalk() {
    this.log('enterWalk');
    this.walking = true;
    this.onWalkChange();
    return true;
  }
  exitWalk() {
    this.log('exitWalk');
    this.walking = false;
    this.onWalkChange();
  }
  screenshot() { this.log('screenshot'); return 'data:image/png;base64,'; }
  thumbnail() { return null; }
  requestRender() { this.log('requestRender'); }
  private objects = new Map<string, THREE.Object3D>();
  /** One object per path (a unit box at the origin), like those of the drawn model. */
  objectOf(p: string) {
    let o = this.objects.get(p);
    if (!o) {
      o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      this.scene.add(o);
      this.objects.set(p, o);
    }
    return o;
  }
  setControlsEnabled(on: boolean) { this.log('setControlsEnabled', on); }
  refreshTransforms() {}

  named(n: string) { return this.calls.filter((c) => c[0] === n); }
  last(n: string) { return this.named(n).at(-1); }
  reset() { this.calls = []; }
}

let wall: LoadedModel;
beforeAll(async () => {
  const path = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/hello-wall.ifcx');
  vi.stubGlobal('fetch', () => { throw new Error('sin red'); });
  wall = await loadModel('hello-wall', path, readFileSync(path, 'utf8'), offlineFetcher);
  vi.unstubAllGlobals();
});

function mount(extra: Partial<WorkspaceOptions<FakeViewer>> = {}) {
  document.body.innerHTML = '<div id="titlebar"><span class="tb-title"></span></div><div id="workspace"></div>';
  const host = document.getElementById('workspace')!;
  let fake!: FakeViewer;
  const ws = mountWorkspace(host, { createViewer: () => (fake = new FakeViewer()), ...extra });
  return { ws, fake, host };
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const action = (a: string) => $<HTMLButtonElement>(`button[data-action="${a}"]`);
const tabLabels = () => [...document.querySelectorAll('.ws-tab .ws-tab-label')].map((t) => t.textContent);
const activeTab = () => $('.ws-tab.active .ws-tab-label').textContent;
const key = (k: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const ifcClass = (n: ComposedNode) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code;
const firstElementWithClass = (n: ComposedNode): ComposedNode | null => {
  if ((n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall') return n;
  for (const c of n.children) {
    const f = firstElementWithClass(c);
    if (f) return f;
  }
  return null;
};

describe('mountWorkspace: layout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('it mounts ribbon with File, panels, dividers, tabs, view with ViewCube, view bar and status', () => {
    mount();
    const tabbar = $('.ribbon-tabbar');
    expect(tabbar.firstElementChild?.textContent).toBe('File');
    expect(tabbar.firstElementChild?.classList.contains('file-tab')).toBe(true);
    expect($('.ws-props .ws-panel-title').textContent).toBe('Properties');
    expect($('.ws-browser .ws-panel-title').textContent).toBe('Project Browser');
    expect($('.ws-left').style.flex).toBe('0 0 280px');
    expect([...document.querySelectorAll('.ws-right [role="tab"]')].map((t) => t.textContent)).toEqual(['Stage', 'Layer', 'References']);
    expect($('.ws-right .ws-move')).toBeTruthy();
    expect($('.ws-right').style.flex).toBe('0 0 260px');
    expect(document.querySelectorAll('.splitter')).toHaveLength(5);
    expect($('.ws-right > .ws-move-split.splitter-h').nextElementSibling).toBe($('.ws-move')); // alto del cuadro Move
    expect($('.ws-stack > .ws-library.lib-panel')).toBeTruthy(); // Library bajo la vista
    expect($('.ws-library').style.flex).toBe('0 0 230px');
    expect($('.ws-view .viewcube')).toBeTruthy();
    expect($('.ws-viewbar').textContent).toContain('1 : 100');
    expect($('.ws-status-msg').textContent).toBe(STATUS_HINT);
    // solo Sombras funciona en la barra de control de vista
    const vb = [...document.querySelectorAll<HTMLButtonElement>('.ws-viewbar button')];
    expect(vb.filter((b) => !b.disabled).map((b) => b.getAttribute('aria-label'))).toEqual(['Visual Style', 'Shadows']);
  });

  it('it activates the empty-document grid and marks it pressed in the ribbon', () => {
    const { fake } = mount();
    expect(fake.last('setEmptyGrid')).toEqual(['setEmptyGrid', 40]);
    expect(action('grid').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('mountWorkspace: modelo y vistas', () => {
  it('New (null): it empties the viewer and opens {3D} with the title Untitled', () => {
    const { ws, fake } = mount();
    ws.setModel(null);
    expect(fake.named('disposeModel')).toHaveLength(1);
    expect(fake.last('setModel')).toEqual(['setModel', null]);
    expect(tabLabels()).toEqual(['{3D}']);
    expect(document.title).toBe('Dream BIM — Untitled — {3D}');
    expect($('.pb-empty').textContent).toBe('No model loaded');
  });

  it('al cargar libera el modelo anterior antes de construir el nuevo', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    ws.setModel(wall);
    const order = fake.calls.map((c) => c[0]).filter((n) => n === 'disposeModel' || n === 'setModel');
    expect(order).toEqual(['disposeModel', 'setModel', 'disposeModel', 'setModel']);
    expect(document.title).toBe('Dream BIM — hello-wall — {3D}');
  });

  it('activating views: projection, cut, direction and title; it goes back to {3D} with the saved camera', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    const cam3d: CameraState = { position: [9, 8, 7], target: [1, 2, 3], fov: 45, projection: 'perspective' };
    fake.cam = cam3d;
    fake.reset();

    // double click on a plan in the browser
    const row = [...document.querySelectorAll<HTMLElement>('.pb-node')].find((r) => r.dataset.label === 'Level 1')!;
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(tabLabels()).toEqual(['{3D}', 'Floor Plan: Level 1']);
    expect(activeTab()).toBe('Floor Plan: Level 1');
    expect(fake.last('setProjection')).toEqual(['setProjection', 'orthographic']);
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', true, 6 + PLAN_TOP_CLEARANCE]); // highest level: no top
    expect(fake.last('view')).toEqual(['view', 'top']);
    expect(document.title).toBe('Dream BIM — hello-wall — Floor Plan: Level 1');
    expect($('.ws-status-level').textContent).toBe('Level 1');
    expect(action('section').getAttribute('aria-pressed')).toBe('true');

    // alzado lateral desde la cinta
    action('side').click();
    expect(activeTab()).toBe('Elevation: Side');
    expect(fake.last('view')).toEqual(['view', 'right']);
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', false, 0]);
    expect($('.ws-status-level').textContent).toBe('');

    // back to {3D} through its tab: the camera is restored, without view('iso')
    fake.reset();
    [...document.querySelectorAll<HTMLElement>('.ws-tab')].find((t) => t.textContent?.includes('{3D}'))!.click();
    expect(fake.last('setProjection')).toEqual(['setProjection', 'perspective']);
    expect(fake.last('setCameraState')).toEqual(['setCameraState', cam3d]);
    expect(fake.named('view')).toEqual([]);
    expect(action('section').getAttribute('aria-pressed')).toBe('false');
  });

  it('Floor Plan de la cinta: abre la del primer nivel; sin niveles, solo vista superior', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    action('plan').click();
    expect(activeTab()).toBe('Floor Plan: Level 0');
    action('view3d').click();
    action('plan').click(); // a plan is already open: it activates it
    expect(tabLabels()).toEqual(['{3D}', 'Floor Plan: Level 0']);
    expect(activeTab()).toBe('Floor Plan: Level 0');

    fake.levelsOut = [];
    ws.setModel(wall);
    fake.reset();
    action('plan').click();
    expect(tabLabels()).toEqual(['{3D}']);
    expect(fake.calls).toEqual([['view', 'top']]);
  });

  it('a new document without geometry shows its level in Floor Plans', async () => {
    const { ws, fake } = mount();
    fake.levelsOut = [];
    const f = await toIfcx(newDocument(), '2026-10-23T00:00:00Z');
    ws.setModel(await loadModel('Untitled', null, JSON.stringify(f), offlineFetcher));
    expect($('.ws-browser .pb-views').textContent).toContain('Floor Plans');
    expect($('.ws-browser .pb-views').textContent).toContain('Level 1');
  });

  it('showPlan abre la planta del primer nivel de un documento nuevo (Floor Plan: Level 1)', async () => {
    const { ws, fake } = mount();
    fake.levelsOut = [];
    const f = await toIfcx(newDocument(), '2026-10-23T00:00:00Z');
    ws.setModel(await loadModel('Untitled', null, JSON.stringify(f), offlineFetcher));
    ws.showPlan();
    expect(tabLabels()).toEqual(['{3D}', 'Floor Plan: Level 1']);
    expect(activeTab()).toBe('Floor Plan: Level 1');
    expect(document.title).toBe('Dream BIM — Untitled — Floor Plan: Level 1');
  });

  it('a new view frames the whole model even if there is a selection', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    fake.onPick(firstElementWithClass(wall.result.root)!.path);
    const w = firstElementWithClass(wall.result.root)!.path;
    fake.reset();
    action('front').click();
    // without a later fit: a fit without a direction would cancel the turn of view() and the view would be crooked
    expect(fake.named('fit')).toEqual([]);
    const seq = fake.calls.filter((c) => c[0] === 'select' || c[0] === 'view');
    expect(seq).toEqual([['select', null], ['view', 'front'], ['select', w]]);
  });

  it('closing the active tab activates the one on its left; without tabs the notice is shown', () => {
    const { ws } = mount();
    ws.setModel(wall);
    action('front').click();
    $<HTMLButtonElement>('.ws-tab.active .ws-tab-close').click();
    expect(tabLabels()).toEqual(['{3D}']);
    expect(activeTab()).toBe('{3D}');
    $<HTMLButtonElement>('.ws-tab.active .ws-tab-close').click();
    expect(tabLabels()).toEqual([]);
    expect($('.ws-view').classList.contains('no-view')).toBe(true);
    expect(document.title).toBe('Dream BIM — hello-wall');
    ws.show3D();
    expect(tabLabels()).toEqual(['{3D}']);
  });
});

describe('mountWorkspace: ribbon, keyboard, selection and state', () => {
  it('Detail ▾ sets the level of detail in the viewer and marks the chosen option', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    fake.reset();
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitemradio"]')]
      .filter((i) => /^(Refined|Original|LOD \d)$/.test(i.textContent ?? ''));
    action('lod').click();
    expect(items().find((i) => i.getAttribute('aria-checked') === 'true')?.textContent).toBe('Original');
    items().find((i) => i.textContent === 'LOD 2')!.click();
    expect(fake.calls).toEqual([['setLod', { enabled: true, force: 2 }]]);
    action('lod').click();
    expect(items().find((i) => i.getAttribute('aria-checked') === 'true')?.textContent).toBe('LOD 2');
  });

  it('the View buttons call the viewer like the web viewer bar', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    fake.reset();
    action('fit').click();
    action('xray').click();
    action('shadows').click();
    action('grid').click();
    action('section').click();
    expect(fake.calls).toEqual([
      ['fit', null, undefined],
      ['setXray', true],
      ['setShadows', true],
      ['setGrid', false],
      ['setSectionBox', true],
    ]);
    // la barra de control de vista sigue a Sombras
    expect($('.ws-viewbar button[aria-label="Shadows"]').getAttribute('aria-pressed')).toBe('true');
    action('walk').click();
    expect(fake.walking).toBe(true);
    expect(action('walk').getAttribute('aria-pressed')).toBe('true');
    action('walk').click();
    expect(fake.walking).toBe(false);
    expect(action('walk').getAttribute('aria-pressed')).toBe('false');
    action('screenshot').click();
    expect(fake.named('screenshot')).toHaveLength(1);
  });

  it('atajos F, 1–4, X, C, G, S, P y Esc sincronizan la cinta; se ignoran al escribir', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    fake.reset();
    for (const k of ['f', '1', '2', '3', '4']) key(k);
    expect(fake.calls).toEqual([
      ['fit', null, undefined],
      ['view', 'iso'],
      ['view', 'top'],
      ['view', 'front'],
      ['view', 'right'],
    ]);
    key('x');
    expect(action('xray').getAttribute('aria-pressed')).toBe('true');
    key('X');
    expect(action('xray').getAttribute('aria-pressed')).toBe('false');
    key('c');
    expect(action('section').getAttribute('aria-pressed')).toBe('true');
    key('g');
    expect(action('grid').getAttribute('aria-pressed')).toBe('false');
    key('s');
    expect(action('shadows').getAttribute('aria-pressed')).toBe('true');
    key('p');
    expect(fake.walking).toBe(true);
    expect(action('walk').getAttribute('aria-pressed')).toBe('true');
    key('x'); // durante el recorrido solo P / Esc
    expect(action('xray').getAttribute('aria-pressed')).toBe('false');
    key('Escape');
    expect(fake.walking).toBe(false);
    expect(action('walk').getAttribute('aria-pressed')).toBe('false');

    fake.reset();
    const input = $<HTMLInputElement>('.stage-search');
    key('x', input);
    key('1', input);
    expect(fake.calls).toEqual([]);

    // fuera del espacio de trabajo no hace nada
    document.getElementById('workspace')!.hidden = true;
    key('1');
    expect(fake.calls).toEqual([]);
  });

  it('onPick llena Propiedades y selecciona en visor y navegador; Esc deselecciona', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path);
    expect(fake.last('select')).toEqual(['select', w.path]);
    expect($('.prop-type-family').textContent).toBeTruthy();
    expect($('.prop-count').textContent).toBe('1 element selected');
    expect(document.querySelector('.ws-stage .stage-row.selected')).toBeTruthy();
    key('Escape');
    expect(fake.last('select')).toEqual(['select', null]);
    expect($('.prop-empty').textContent).toBe('Nothing selected');
  });

  describe('multiple selection and temporary Assistant color', () => {
    const named = (root: ComposedNode, name: string): ComposedNode => {
      const f = (n: ComposedNode): ComposedNode | null => (n.name === name ? n : n.children.map(f).find(Boolean) ?? null);
      return f(root)!;
    };
    const two = () => {
      const m = mount();
      m.ws.setModel(wall);
      return { ...m, w0: named(wall.result.root, 'Wall').path, w1: named(wall.result.root, 'Window').path };
    };

    it('Ctrl+click adds, click replaces and Esc empties', () => {
      const { ws, fake, w0, w1 } = two();
      fake.onPick(w0, false);
      fake.onPick(w1, true);
      expect(ws.agent.selection()).toEqual([w0, w1]);
      expect(fake.last('selectMany')).toEqual(['selectMany', [w0, w1]]);
      expect($('.prop-count').textContent).toBe('2 elements selected');
      fake.onPick(w0, false);
      expect(ws.agent.selection()).toEqual([w0]);
      expect(fake.last('select')).toEqual(['select', w0]);
      key('Escape');
      expect(ws.agent.selection()).toEqual([]);
    });

    it('Ctrl+click on the only selected one removes it', () => {
      const { ws, fake, w0 } = two();
      fake.onPick(w0, false);
      fake.onPick(w0, true);
      expect(ws.agent.selection()).toEqual([]);
      expect(fake.last('select')).toEqual(['select', null]);
      expect($('.prop-empty').textContent).toBe('Nothing selected');
    });

    it('agent.selectMany selects several paths and the last one is the main one', () => {
      const { ws, fake, w0, w1 } = two();
      ws.agent.selectMany([w0, w1]);
      expect(ws.agent.selection()).toEqual([w0, w1]);
      expect(fake.last('selectMany')).toEqual(['selectMany', [w0, w1]]);
    });

    it('highlight acumula, muestra el chip, y el chip lo limpia', () => {
      const { ws, fake, w0, w1 } = two();
      ws.agent.highlight([w0], { color: '#ff0000', opacity: 1 });
      ws.agent.highlight([w1], { color: '#0000ff', opacity: 1 });
      expect([...(fake.last('setAssistantColors')![1] as Map<string, unknown>).keys()]).toEqual([w0, w1]);
      $('.ws-assistant-colors').click();
      expect(fake.last('setAssistantColors')).toEqual(['setAssistantColors', null]);
      expect(document.querySelector('.ws-assistant-colors')).toBeNull();
    });

    it('clearHighlight limpia sin chip, y abrir otro modelo quita el resaltado', () => {
      const { ws, fake, w0 } = two();
      ws.agent.highlight([w0], { color: '#ff0000', opacity: 1 });
      ws.agent.clearHighlight();
      expect(fake.last('setAssistantColors')).toEqual(['setAssistantColors', null]);
      ws.agent.highlight([w0], { color: '#ff0000', opacity: 1 });
      ws.setModel(wall);
      expect(fake.last('setAssistantColors')).toEqual(['setAssistantColors', null]);
      expect(document.querySelector('.ws-assistant-colors')).toBeNull();
    });

    it('clearHighlight(paths) removes only those paths and the chip goes away with the last one', () => {
      const { ws, fake, w0, w1 } = two();
      ws.agent.highlight([w0, w1], { color: '#ff0000', opacity: 1 });
      ws.agent.clearHighlight([w0]);
      expect([...(fake.last('setAssistantColors')![1] as Map<string, unknown>).keys()]).toEqual([w1]);
      expect(document.querySelector('.ws-assistant-colors')).not.toBeNull();
      ws.agent.clearHighlight([w1]);
      expect(fake.last('setAssistantColors')).toEqual(['setAssistantColors', null]);
      expect(document.querySelector('.ws-assistant-colors')).toBeNull();
    });

    it('the saved colors of the model go to the viewer on opening and on updating', () => {
      const { ws, fake, w0 } = two();
      const saved = new Map([[w0, { color: '#0000ff', opacity: 1 }]]);
      ws.updateModel({ ...wall, savedColors: saved });
      expect(fake.last('setSavedColors')).toEqual(['setSavedColors', saved]);
      ws.setModel(wall);
      expect(fake.last('setSavedColors')).toEqual(['setSavedColors', null]);
    });

    it('the Properties counter stays at N after locking editing and repainting the Stage', () => {
      const { ws, fake, w0, w1 } = two();
      fake.onPick(w0, false);
      fake.onPick(w1, true);
      ws.setEditable(false);
      expect($('.prop-count').textContent).toBe('2 elements selected');
    });

    it('Ctrl+click in the Stage on the only selected one leaves the row unhighlighted', () => {
      const { ws, w0 } = two();
      const row = () => document.querySelector<HTMLElement>(`.ws-stage .stage-row[data-path="${CSS.escape(w0)}"]`)!;
      ws.agent.select(w0);
      expect(row().classList.contains('selected')).toBe(true);
      row().dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      expect(ws.agent.selection()).toEqual([]);
      expect(row().classList.contains('selected')).toBe(false);
    });

    it('agent.materials joins the material nodes and the codes of the model with their number of elements', () => {
      const actions = {
        nodes: () => [{
          path: 'n-C30', def: { name: 'Concrete C30', code: 'C30', color: '#8a8a8a', opacity: 1 },
          source: { role: 'layer', name: 'doc', uri: null, layerId: 'document' }, site: 'document', overridden: [],
        }],
        setMaterial: vi.fn(), duplicateMaterial: vi.fn(), deleteMaterial: vi.fn(), assignMaterial: vi.fn(), confirm: vi.fn(),
      };
      const modeHost = document.createElement('div');
      const { ws, fake } = mount({ modeHost, materials: actions as never });
      ws.setModel(wall);
      const row = (element: string, materialCode: string | null) => ({ element, name: element, cls: 'IfcWall', storey: 'N00', material: '', materialCode, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 1 });
      fake.quantitiesOut = [row('/e1', 'C30'), row('/e2', 'C30'), row('/e3', 'LADRILLO')] as never;
      expect(ws.agent.materials()).toEqual([
        { code: 'C30', name: 'Concrete C30', color: '#8a8a8a', opacity: 1, elements: 2 },
        expect.objectContaining({ code: 'LADRILLO', name: 'LADRILLO', elements: 1 }),
      ]);
    });

    it('agent.provenance da la procedencia de un elemento y null con una ruta desconocida', () => {
      const { ws, w0 } = two();
      expect(ws.agent.provenance(w0)!.sources.length).toBeGreaterThan(0);
      expect(ws.agent.provenance('/no/existe')).toBeNull();
    });
  });

  it('onHover escribe "<nombre> · <clase>" en la barra de estado y vuelve a la ayuda sin elemento', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    fake.onHover(w.path);
    expect($('.ws-status-msg').textContent).toBe(hoverText(w));
    expect($('.ws-status-msg').textContent).toMatch(/ · IfcWall$/);
    fake.onHover(null);
    expect($('.ws-status-msg').textContent).toBe('Click to select an element.');
  });
});

describe('mountWorkspace: tema', () => {
  beforeEach(() => {
    localStorage.clear();
    initTheme();
    setThemePref('light');
  });

  it('it paints the grid with the colors of the current theme on mounting', () => {
    const { fake } = mount();
    expect(fake.last('setGridColors')).toEqual(['setGridColors', GRID_COLORS.light.center, GRID_COLORS.light.line]);
  });

  it('al cambiar el tema pide al visor los colores de rejilla de ese tema', () => {
    const { fake } = mount();
    setThemePref('dark');
    expect(fake.last('setGridColors')).toEqual(['setGridColors', GRID_COLORS.dark.center, GRID_COLORS.dark.line]);
    setThemePref('light');
    expect(fake.last('setGridColors')).toEqual(['setGridColors', GRID_COLORS.light.center, GRID_COLORS.light.line]);
  });

  it('the walls cut in plan are filled with the background color (opaque) and their edge contrasts, like Revit', () => {
    const { fake } = mount();
    expect(fake.last('setCutColor')).toEqual(['setCutColor', HIDDEN_FACE_COLORS.light]);
    expect(fake.last('setEdgeColor')).toEqual(['setEdgeColor', CUT_COLORS.light]);
    setThemePref('dark');
    expect(fake.last('setCutColor')).toEqual(['setCutColor', HIDDEN_FACE_COLORS.dark]);
    expect(fake.last('setEdgeColor')).toEqual(['setEdgeColor', CUT_COLORS.dark]); // borde claro sobre relleno oscuro
    expect(CUT_COLORS.dark).not.toBe(HIDDEN_FACE_COLORS.dark);
  });

  it('Hidden Line paints the faces with the background color: white in light and dark in dark, like Revit', () => {
    const { fake } = mount();
    expect(fake.last('setHiddenFaceColor')).toEqual(['setHiddenFaceColor', HIDDEN_FACE_COLORS.light]);
    setThemePref('dark');
    expect(fake.last('setHiddenFaceColor')).toEqual(['setHiddenFaceColor', HIDDEN_FACE_COLORS.dark]);
    expect(HIDDEN_FACE_COLORS.light).toBe(0xffffff);
    expect(HIDDEN_FACE_COLORS.dark).not.toBe(CUT_COLORS.dark); // caras oscuras bajo aristas claras
  });

  it('los colores oscuros de la rejilla son distintos de los claros', () => {
    expect(GRID_COLORS.dark).not.toEqual(GRID_COLORS.light);
  });
});

describe('mountWorkspace: dibujo de muros', () => {
  const click = (x = 0, y = 0) => {
    const c = $('.ws-canvas');
    c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }));
    c.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }));
  };
  function setup() {
    const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
    const pts: [number, number][] = [[1, 2], [4, 6]];
    let i = 0;
    const m = mount({ editor, pickPoint: () => pts[Math.min(i++, pts.length - 1)] });
    m.ws.setModel(wall);
    m.ws.setEditable(true);
    return { ...m, editor };
  }

  it('in an IFCx that is not from Studio it is edited, but Wall, Floor and Level are not enabled', () => {
    const m = setup();
    m.ws.setEditable(true, false);
    for (const a of ['wall', 'floor', 'level']) {
      expect(action(a).disabled).toBe(true);
      expect(action(a).title).toContain(NOT_STUDIO);
    }
    action('wall').click();
    m.ws.showPlan();
    click(1, 2);
    click(4, 6);
    expect(m.editor.addWall).not.toHaveBeenCalled();
    m.ws.setEditable(true);
    expect(action('wall').disabled).toBe(false);
  });

  it('el muro se dibuja con el id de Studio del nivel de la planta, no con su ruta compuesta', async () => {
    const d = newDocument();
    const f = await toIfcx(d, 'x');
    const studioModel = await loadModel('s', null, JSON.stringify(f), offlineFetcher);
    const storey = [...studioModel.result.byPath.values()].find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    expect(storey.path).not.toBe(d.levels[0].id); // the path is /<root>/Project/…/<id>
    const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
    const pts: [number, number][] = [[1, 2], [4, 6]];
    let i = 0;
    const { ws, fake } = mount({ editor, pickPoint: () => pts[Math.min(i++, pts.length - 1)] });
    fake.levelsOut = [{ path: storey.path, name: 'Level 1', minZ: 0, maxZ: 3 }];
    ws.setModel(studioModel);
    ws.setEditable(true);
    action('wall').click();
    click();
    click();
    expect(editor.addWall).toHaveBeenCalledWith([1, 2], [4, 6], d.levels[0].id);
  });

  it('Wall empieza deshabilitado con su tooltip y setEditable lo habilita', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(action('wall').disabled).toBe(true);
    ws.setEditable(false);
    expect(action('wall').title).toBe('Only models created in Dream BIM can be edited');
    ws.setEditable(true);
    expect(action('wall').disabled).toBe(false);
    expect(action('wall').title).toBe('');
  });

  it('Wall desde {3D} abre la planta del primer nivel y muestra el prompt', () => {
    setup();
    action('wall').click();
    expect(activeTab()).toBe('Floor Plan: Level 0');
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
    expect(action('wall').getAttribute('aria-pressed')).toBe('true');
  });

  it('two clicks without moving call editor.addWall once with the points and the level of the plan', () => {
    const { editor } = setup();
    action('wall').click();
    click();
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall end point. Esc to finish.');
    expect(editor.addWall).not.toHaveBeenCalled();
    click();
    expect(editor.addWall).toHaveBeenCalledTimes(1);
    expect(editor.addWall).toHaveBeenCalledWith([1, 2], [4, 6], '/p/n0');
  });

  it('a drag of more than 4 px does not count as a click', () => {
    setup();
    action('wall').click();
    const c = $('.ws-canvas');
    c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    c.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 20, clientY: 0 }));
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
  });

  it('while the tool is active onPick does not change the selection', () => {
    const { fake } = setup();
    action('wall').click();
    fake.reset();
    fake.onPick(firstElementWithClass(wall.result.root)!.path);
    expect(fake.named('select')).toEqual([]);
  });

  it('Esc twice leaves the tool and releases the button', () => {
    const { fake } = setup();
    action('wall').click();
    click();
    fake.reset();
    key('Escape');
    expect(action('wall').getAttribute('aria-pressed')).toBe('true');
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
    key('Escape');
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
    expect($('.ws-status-msg').textContent).toBe(STATUS_HINT);
    expect(fake.named('select')).toEqual([]); // Esc fue de la herramienta, no deselecciona
  });

  it('pulsar Wall de nuevo con la herramienta activa sale', () => {
    setup();
    action('wall').click();
    action('wall').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
    expect($('.ws-status-msg').textContent).toBe(STATUS_HINT);
  });

  it('switching to a view that is not a plan cancels the tool', () => {
    const { editor } = setup();
    action('wall').click();
    action('view3d').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
    click();
    click();
    expect(editor.addWall).not.toHaveBeenCalled();
  });

  it('setModel cancela la herramienta', () => {
    const { ws } = setup();
    action('wall').click();
    ws.setModel(wall);
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
  });

  it('without levels it warns and does not leave the button pressed', () => {
    const { ws, fake } = setup();
    fake.levelsOut = [];
    ws.setModel(wall);
    ws.setEditable(true);
    action('wall').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
  });

  it('el Body elegido sube hasta su IfcWall y Delete llama a deleteWall con su origin', () => {
    const { fake, editor, ws } = setup();
    const w = firstElementWithClass(wall.result.root)!;
    const body = w.children[0] ?? w;
    fake.onPick(body.path);
    expect(fake.last('select')).toEqual(['select', w.path]);
    key('Delete');
    expect(editor.deleteWall).toHaveBeenCalledWith(w.origin);
    expect(fake.last('select')).toEqual(['select', null]);

    fake.onPick(body.path);
    ws.setEditable(false);
    key('Delete');
    expect(editor.deleteWall).toHaveBeenCalledTimes(1);
  });

  it('updateModel does not close tabs or move the camera and restores the selection', () => {
    const { ws, fake } = setup();
    action('plan').click();
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path);
    fake.reset();
    ws.updateModel(wall);
    expect(tabLabels()).toEqual(['{3D}', 'Floor Plan: Level 0']);
    expect(activeTab()).toBe('Floor Plan: Level 0');
    expect(fake.named('disposeModel')).toHaveLength(1);
    expect(fake.named('setModel')).toHaveLength(1);
    expect(fake.named('view')).toEqual([]);
    expect(fake.named('fit')).toEqual([]);
    expect(fake.named('setCameraState')).toEqual([]);
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', true, 3 + PLAN_TOP_CLEARANCE]); // hasta el nivel siguiente
    expect(fake.last('select')).toEqual(['select', w.path]);
  });

  it('setDirty(true) puts * after the name in the title', () => {
    const { ws } = mount();
    ws.setModel(null);
    ws.setDirty(true);
    expect(document.title).toBe('Dream BIM — Untitled* — {3D}');
    ws.setDirty(false);
    expect(document.title).toBe('Dream BIM — Untitled — {3D}');
  });

  it('setDirty(true) en una planta: Untitled* — Floor Plan: Level 1', async () => {
    const { ws, fake } = mount();
    fake.levelsOut = [];
    const f = await toIfcx(newDocument(), '2026-10-23T00:00:00Z');
    ws.setModel(await loadModel('Untitled', null, JSON.stringify(f), offlineFetcher));
    action('plan').click();
    ws.setDirty(true);
    expect(document.title).toBe('Dream BIM — Untitled* — Floor Plan: Level 1');
  });

  it('al entrar en recorrido la herramienta se detiene y los clics no crean muros', () => {
    const { editor } = setup();
    action('wall').click();
    click();
    action('walk').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
    click();
    click();
    expect(editor.addWall).not.toHaveBeenCalled();
  });

  it('when moving the mouse the status bar shows the length; Esc goes back to the prompt', () => {
    const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
    let p: [number, number] = [0, 0];
    const { ws } = mount({ editor, pickPoint: () => p });
    ws.setModel(wall);
    ws.setEditable(true);
    action('wall').click();
    const c = $('.ws-canvas');
    c.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
    click();
    p = [3, 4];
    c.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall end point. Esc to finish. — Length: 5.00 m · Angle: 53.13°');
    key('Escape');
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
  });

  describe('ajuste de cierre de cadena', () => {
    function chain(projectPoint: (p: [number, number]) => { x: number; y: number } | null) {
      const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
      const pts: [number, number][] = [[0, 0], [4, 0], [4.5, 3], [0.02, 0.01]];
      let i = 0;
      const { ws } = mount({ editor, pickPoint: () => pts[Math.min(i++, pts.length - 1)], projectPoint });
      ws.setModel(wall);
      ws.setEditable(true);
      action('wall').click();
      return { editor };
    }

    it('un clic a <= 8 px del primer punto usa el punto EXACTO', () => {
      const { editor } = chain(() => ({ x: 100, y: 100 }));
      click(500, 500);
      click(500, 500);
      click(500, 500);
      click(104, 103);
      expect(editor.addWall).toHaveBeenLastCalledWith([4.5, 3], [0, 0], '/p/n0');
    });

    it('a click more than 8 px away keeps the raw point', () => {
      const { editor } = chain(() => ({ x: 100, y: 100 }));
      click(500, 500);
      click(500, 500);
      click(500, 500);
      click(120, 100);
      expect(editor.addWall).toHaveBeenLastCalledWith([4.5, 3], [0.02, 0.01], '/p/n0');
    });

    it('con un solo muro dibujado no ajusta al propio inicio', () => {
      const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
      const { ws } = mount({ editor, pickPoint: (() => { let k = 0; return () => (k++ ? [4, 0] : [0, 0]) as [number, number]; })(), projectPoint: () => ({ x: 100, y: 100 }) });
      ws.setModel(wall);
      ws.setEditable(true);
      action('wall').click();
      click(100, 100);
      click(100, 100);
      expect(editor.addWall).toHaveBeenCalledWith([0, 0], [4, 0], '/p/n0');
    });
  });
  describe('ortogonalidad', () => {
    const status = () => $('.ws-status-msg').textContent;
    const move = (shiftKey = false) =>
      $('.ws-canvas').dispatchEvent(new MouseEvent('pointermove', { bubbles: true, shiftKey }));
    const clickShift = (shiftKey: boolean) => {
      const c = $('.ws-canvas');
      c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      c.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, shiftKey }));
    };
    function begin() {
      const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
      let p: [number, number] = [0, 0];
      const { ws, fake } = mount({ editor, pickPoint: () => p });
      ws.setModel(wall);
      ws.setEditable(true);
      action('wall').click();
      clickShift(false); // inicio en [0, 0]
      const guide = () => fake.scene.children.filter((c) => c.name === 'wall-guide').length;
      return { editor, guide, set: (q: [number, number]) => (p = q) };
    }

    it('near 0° the wall is straightened and the bar shows the angle', () => {
      const { editor, set } = begin();
      set([5, 0.2]);
      move();
      expect(status()).toContain('Length: 5.00 m · Angle: 0.00°');
      clickShift(false);
      expect(editor.addWall).toHaveBeenCalledWith([0, 0], [5, 0], '/p/n0');
    });

    it('click with Shift forces the nearest axis', () => {
      const { editor, set } = begin();
      set([3, 2]);
      clickShift(true);
      expect(editor.addWall).toHaveBeenCalledWith([0, 0], [3, 0], '/p/n0');
    });

    it('pressing and releasing Shift without moving the mouse updates the status bar', () => {
      const { set } = begin();
      set([3, 2]);
      move();
      expect(status()).toContain('Length: 3.61 m · Angle: 33.69°');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }));
      expect(status()).toContain('Length: 3.00 m · Angle: 0.00°');
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', shiftKey: false }));
      expect(status()).toContain('Length: 3.61 m · Angle: 33.69°');
    });

    it('the guide appears near an axis, disappears far from it and with Esc', () => {
      const { set, guide } = begin();
      set([5, 0.2]);
      move();
      expect(guide()).toBe(1);
      set([5, 2]);
      move();
      expect(guide()).toBe(0);
      set([5, 0.2]);
      move();
      expect(guide()).toBe(1);
      key('Escape');
      expect(guide()).toBe(0);
      expect(status()).toBe('Click to enter wall start point.');
    });
  });
});

describe('mountWorkspace: niveles y Properties editable', () => {
  /** Documento de Studio con (opcionalmente) un muro, su modelo cargado y un `studio` falso. */
  async function studioSetup(conMuro = false) {
    const d = newDocument();
    if (conMuro) {
      d.walls.push({
        id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.2, bodyId: 'b1', axisId: 'a1',
        baseLevelId: d.levels[0].id, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
      });
    }
    const f = await toIfcx(d, 'x');
    const m = await loadModel('s', null, JSON.stringify(f), offlineFetcher);
    const nodes = [...m.result.byPath.values()];
    const storey = nodes.find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    const studio = {
      levels: () => d.levels,
      walls: () => d.walls,
      floor: () => undefined,
      setFloorConstraints: vi.fn(async () => true),
      wall: (id: string) => d.walls.find((w) => w.id === id),
      addLevel: vi.fn(async () => d.levels[0].id),
      renameLevel: vi.fn(async () => true),
      setLevelElevation: vi.fn(async () => true),
      setWallConstraints: vi.fn(async () => true),
    };
    const ctx = mount({ studio });
    ctx.fake.levelsOut = [{ path: storey.path, name: 'Level 1', minZ: 0, maxZ: 3 }];
    ctx.ws.setModel(m);
    return { ...ctx, d, m, storey, studio, wallNode: nodes.find((n) => n.origin === 'w1') };
  }

  it('Level is disabled without editing and active with it', async () => {
    const { ws } = await studioSetup();
    expect(action('level').disabled).toBe(true);
    expect(action('level').title).toBe('Only models created in Dream BIM can be edited');
    ws.setEditable(true);
    expect(action('level').disabled).toBe(false);
    expect(action('level').title).toBe('');
  });

  it('pulsar Level crea un nivel y lo selecciona: Properties muestra su storey editable', async () => {
    const { ws, studio } = await studioSetup();
    ws.setEditable(true);
    action('level').click();
    await vi.waitFor(() => expect($('.prop-type-family').textContent).toBe('IfcBuildingStorey'));
    expect(studio.addLevel).toHaveBeenCalledTimes(1);
    const celda = (l: string) => [...document.querySelectorAll('td.prop-name')].find((t) => t.textContent === l)!.nextElementSibling!;
    expect((celda('Name').querySelector('input') as HTMLInputElement).value).toBe('Level 1');
    expect((celda('Elevation').querySelector('input') as HTMLInputElement).value).toBe('0.000');
  });

  it('un clic simple en Floor Plans selecciona el nivel sin resaltar nada en 3D', async () => {
    const { ws, fake } = await studioSetup();
    ws.setEditable(true);
    const fila = [...document.querySelectorAll<HTMLElement>('.pb-views .pb-node')].find(
      (n) => n.querySelector('.pb-label')?.textContent === 'Level 1',
    )!;
    fila.click();
    expect($('.prop-type-family').textContent).toBe('IfcBuildingStorey');
    expect(fake.last('select')).toEqual(['select', null]);
    expect(activeTab()).toBe('{3D}'); // un clic simple no abre la planta
  });

  it('with editing, the Properties of a wall bring dropdowns; without it, read-only', async () => {
    const { ws, fake, wallNode } = await studioSetup(true);
    ws.setEditable(true);
    fake.onPick(wallNode!.path);
    expect($('.prop-select')).toBeTruthy();
    expect(document.querySelectorAll('.prop-input').length).toBeGreaterThan(0);
    ws.setEditable(false);
    fake.onPick(wallNode!.path);
    expect(document.querySelector('.prop-select, .prop-input')).toBeNull();
  });
});

describe('mountWorkspace: editing levels with their plan open', () => {
  it('updateModel refreshes the plan tab and repositions its cut plane', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    ws.showPlan();
    expect(activeTab()).toBe('Floor Plan: Level 0');
    fake.levelsOut = [{ path: '/p/n0', name: 'Ground', minZ: 1, maxZ: 4 }, { ...LEVELS[1], minZ: 5 }];
    ws.updateModel(wall);
    expect(activeTab()).toBe('Floor Plan: Ground');
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', true, 5 + PLAN_TOP_CLEARANCE]); // the next level moved to 5 m
    expect(fake.last('setGridZ')).toEqual(['setGridZ', 1]);
    expect(document.title).toContain('Floor Plan: Ground');
  });
});

describe('mountWorkspace: niveles en la vista 3D', () => {
  const marksInScene = (fake: FakeViewer) => fake.scene.children.filter((c) => c.name === 'level-mark');
  const labels = () => [...document.querySelectorAll<HTMLElement>('.ws-level-overlay .level-label')];
  const chooseLevels = (style: string) => {
    action('levels').click();
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((i) => i.textContent?.toLowerCase() === style)!.click();
  };
  const pointerUp = (x: number, y: number) =>
    $('.ws-canvas').dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x, clientY: y }));
  const family = () => $('.prop-type-family').textContent;

  // front elevation: each level is a horizontal line; plan: the rectangle is seen
  let proj: (x: number, y: number, z: number) => { x: number; y: number };
  beforeEach(() => {
    localStorage.clear();
    proj = (x, _y, z) => ({ x: x * 10, y: -z * 10 });
  });

  /** Documento de Studio con dos niveles (0 y 3 m) y un muro en el primero. */
  async function setup3D(style: string | null = 'outline') {
    const d = newDocument();
    d.levels.push({ id: crypto.randomUUID(), name: 'Level 2', elevation: 3 });
    d.walls.push({
      id: 'w1', start: [0, 0], end: [4, 0], thickness: 0.2, bodyId: 'b1', axisId: 'a1',
      baseLevelId: d.levels[0].id, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
    });
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const nodes = [...m.result.byPath.values()];
    const storeys = d.levels.map((l) => nodes.find((n) => n.origin === l.id)!);
    if (style) localStorage.setItem('ifcx-studio.levels-style', style);
    const ctx = mount({ projectWorld: (x, y, z) => proj(x, y, z) });
    ctx.fake.levelsOut = storeys.map((n, i) => ({ path: n.path, name: d.levels[i].name, minZ: d.levels[i].elevation, maxZ: d.levels[i].elevation + 3 }));
    ctx.ws.setModel(m);
    return { ...ctx, storeys, wallPath: nodes.find((n) => n.origin === 'w1')!.path, m };
  }

  it('por defecto no se dibuja ninguno; al seleccionar un nivel sale su plano y al soltarlo se quita', async () => {
    const { fake, storeys } = await setup3D(null);
    expect(marksInScene(fake)).toHaveLength(0);
    expect(labels()).toHaveLength(0);
    // desde la regla de niveles de la derecha
    $(`.level-list .level-item[data-path="${storeys[1].path}"]`).click();
    expect(marksInScene(fake).filter((o) => o instanceof THREE.Mesh)).toHaveLength(1);
    expect(labels().map((l) => l.textContent)).toEqual(['Level 2 3.000']);
    expect($('.prop-type-name').textContent).toBe('Level 2');
    pointerUp(900, 900);
    fake.onPick(null);
    expect(marksInScene(fake)).toHaveLength(0);
  });

  it('with Outline all of them are drawn; the plans hide them and {3D} restores them', async () => {
    const { fake, ws } = await setup3D();
    expect(marksInScene(fake)).toHaveLength(2);
    expect(labels().map((l) => l.textContent)).toEqual(['Level 1 0.000', 'Level 2 3.000']);
    ws.showPlan();
    expect(marksInScene(fake)).toHaveLength(0);
    expect(labels()).toHaveLength(0);
    ws.show3D();
    expect(marksInScene(fake)).toHaveLength(2);
  });

  it('they are also drawn in the elevations', async () => {
    const { fake } = await setup3D();
    action('front').click();
    expect(marksInScene(fake)).toHaveLength(2);
  });

  it('Levels ▾ cambia el estilo, lo recuerda y Off lo quita todo', async () => {
    const { fake } = await setup3D();
    chooseLevels('plane');
    expect(marksInScene(fake).filter((o) => o instanceof THREE.Mesh)).toHaveLength(2);
    expect(localStorage.getItem('ifcx-studio.levels-style')).toBe('plane');
    chooseLevels('off');
    expect(marksInScene(fake)).toHaveLength(0);
    expect(labels()).toHaveLength(0);
    expect(localStorage.getItem('ifcx-studio.levels-style')).toBe('off');
  });

  it('a click on the line of a level selects it even if the viewer brings a wall', async () => {
    const { fake, wallPath } = await setup3D();
    pointerUp(50, -35); // at 5 px from the Level 2 line (z = 3)
    fake.onPick(wallPath);
    expect(family()).toBe('IfcBuildingStorey');
    expect($('.prop-type-name').textContent).toBe('Level 2');
    expect(fake.last('select')).toEqual(['select', null]);
    expect(labels().filter((l) => l.classList.contains('selected')).map((l) => l.textContent)).toEqual(['Level 2 3.000']);
  });

  it('with Plane, a click inside the plane selects the wall if there is one and the level if not', async () => {
    const { fake, wallPath } = await setup3D();
    chooseLevels('plane');
    proj = (x, y) => ({ x: x * 10, y: -y * 10 }); // plan: the rectangle occupies x -20…120, y -60…20
    pointerUp(50, -20);
    fake.onPick(wallPath);
    expect(family()).toBe('IfcWall');
    pointerUp(50, -20);
    fake.onPick(null);
    expect(family()).toBe('IfcBuildingStorey');
    expect($('.prop-type-name').textContent).toBe('Level 2'); // the one with the highest elevation
  });

  it('un clic en la etiqueta selecciona el nivel', async () => {
    await setup3D();
    labels()[0].click();
    expect($('.prop-type-name').textContent).toBe('Level 1');
  });

  it('un clic lejos de todo deselecciona', async () => {
    const { fake, wallPath } = await setup3D();
    fake.onPick(wallPath);
    pointerUp(900, 900);
    fake.onPick(null);
    expect($('.prop-empty').textContent).toBe('Nothing selected');
  });

  it('setModel(null) quita las marcas y las etiquetas', async () => {
    const { fake, ws } = await setup3D();
    ws.setModel(null);
    expect(marksInScene(fake)).toHaveLength(0);
    expect(document.querySelector('.ws-level-overlay')!.children).toHaveLength(0);
  });
});

describe('mountWorkspace: lista de niveles bajo el ViewCube', () => {
  const rows = () => [...document.querySelectorAll<HTMLElement>('.level-list .level-item')];
  const active = () => rows().filter((r) => r.classList.contains('active')).map((r) => r.querySelector('.level-item-name')!.textContent);

  it('it has one row per level, from top to bottom', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(rows().map((r) => r.querySelector('.level-item-name')!.textContent)).toEqual(['Level 1', 'Level 0']);
    expect(rows().map((r) => r.querySelector('.level-item-z')!.textContent)).toEqual(['3.000 m', '0.000 m']);
  });

  it('en una planta resalta el nivel de esa planta', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(active()).toEqual([]);
    ws.showPlan();
    expect(active()).toEqual(['Level 0']);
  });

  it('sigue visible con Levels ▾ en Off y sin modelo queda oculta', () => {
    const { ws } = mount();
    ws.setModel(wall);
    action('levels').click();
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((i) => i.textContent === 'Off')!.click();
    expect(rows()).toHaveLength(2);
    ws.setModel(null);
    expect(document.querySelector<HTMLElement>('.level-list')!.hidden).toBe(true);
  });
});

describe('mountWorkspace: Options Bar de Wall y cursor', () => {
  const bar = () => $('.ws-optionsbar');
  const chain = () => $<HTMLInputElement>('.ws-optionsbar input[type="checkbox"]');
  const click = () => {
    const c = $('.ws-canvas');
    c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    c.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  };
  function setup(pts: [number, number][] = [[0, 0], [4, 0], [10, 10], [14, 10]]) {
    const editor = { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() };
    let i = 0;
    const m = mount({ editor, pickPoint: () => pts[Math.min(i++, pts.length - 1)] });
    m.ws.setModel(wall);
    m.ws.setEditable(true);
    return { ...m, editor };
  }
  beforeEach(() => localStorage.clear());

  it('solo se ve con Wall activa, con Chain marcada, y el cursor del lienzo pasa a cruz', () => {
    setup();
    expect(bar().hidden).toBe(true);
    expect($('.ws-canvas').classList.contains('drawing')).toBe(false);
    action('wall').click();
    expect(bar().hidden).toBe(false);
    expect(bar().textContent).toContain('Modify | Place Wall');
    expect(bar().textContent).toContain('Chain');
    expect(chain().checked).toBe(true);
    expect($('.ws-canvas').classList.contains('drawing')).toBe(true);
    key('Escape');
    expect(bar().hidden).toBe(true);
    expect($('.ws-canvas').classList.contains('drawing')).toBe(false);
  });

  it('sin Chain cada muro es independiente', () => {
    const { editor } = setup();
    action('wall').click();
    chain().click();
    for (let k = 0; k < 4; k++) click();
    expect(editor.addWall.mock.calls.map((c) => [c[0], c[1]])).toEqual([[[0, 0], [4, 0]], [[10, 10], [14, 10]]]);
  });

  it('with Chain (default) the same clicks chain three walls', () => {
    const { editor } = setup();
    action('wall').click();
    for (let k = 0; k < 4; k++) click();
    expect(editor.addWall).toHaveBeenCalledTimes(3);
  });

  it('cambiar Chain a mitad de una cadena la corta', () => {
    setup();
    action('wall').click();
    click();
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall end point. Esc to finish.');
    chain().click();
    expect($('.ws-status-msg').textContent).toBe('Click to enter wall start point.');
  });

  it('Chain se recuerda entre sesiones', () => {
    setup();
    action('wall').click();
    chain().click();
    expect(localStorage.getItem('ifcx-studio.wall-chain')).toBe('off');
    setup();
    action('wall').click();
    expect(chain().checked).toBe(false);
  });
});

describe('mountWorkspace: rango de vista de una planta', () => {
  const L3: LevelInfo[] = [
    { path: '/p/n0', name: 'Level 0', minZ: 0, maxZ: 3 },
    { path: '/p/n1', name: 'Level 1', minZ: 3, maxZ: 6 },
    { path: '/p/n2', name: 'Level 2', minZ: 6, maxZ: 9 },
  ];
  function setup() {
    const m = mount();
    m.fake.levelsOut = L3;
    m.ws.setModel(wall);
    return m;
  }
  const openPlan = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('.pb-views .pb-node')]
      .find((r) => r.dataset.label === name)!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

  it('un nivel intermedio: el suyo normal, los de debajo y encima atenuados, corte en el siguiente y rejilla en su cota', () => {
    const { fake } = setup();
    openPlan('Level 1');
    expect(fake.last('setLevelFocus')).toEqual(['setLevelFocus', { current: '/p/n1', underlay: ['/p/n0', '/p/n2'] }]);
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', true, 6 + PLAN_TOP_CLEARANCE]); // sin comerse la cara superior de los muros
    expect(fake.last('setGridZ')).toEqual(['setGridZ', 3]);
  });

  it('the lowest level only has one above; the highest only one below and has no top', () => {
    const { fake } = setup();
    openPlan('Level 0');
    expect(fake.last('setLevelFocus')).toEqual(['setLevelFocus', { current: '/p/n0', underlay: ['/p/n1'] }]);
    expect(fake.last('setGridZ')).toEqual(['setGridZ', 0]);
    openPlan('Level 2');
    expect(fake.last('setLevelFocus')).toEqual(['setLevelFocus', { current: '/p/n2', underlay: ['/p/n1'] }]);
    expect(fake.last('setSectionAt')).toEqual(['setSectionAt', true, 9 + PLAN_TOP_CLEARANCE]);
  });

  it('{3D} y los alzados muestran todo el modelo con la rejilla abajo', () => {
    const { fake, ws } = setup();
    openPlan('Level 1');
    ws.show3D();
    expect(fake.last('setLevelFocus')).toEqual(['setLevelFocus', null]);
    expect(fake.last('setGridZ')).toEqual(['setGridZ', null]);
    openPlan('Level 1');
    action('front').click();
    expect(fake.last('setLevelFocus')).toEqual(['setLevelFocus', null]);
  });
});

describe('mountWorkspace: projection of the 3D view', () => {
  const cubeMenu = () => document.querySelector('.viewcube')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const items = () => [...document.querySelectorAll<HTMLElement>('.ribbon-menu [role="menuitemradio"]')];
  const pick = (label: string) => items().find((i) => i.textContent === label)!.click();

  it('clic derecho en el ViewCube de {3D} cambia entre perspectiva y paralela, y la vista la conserva', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    cubeMenu();
    expect(items().map((i) => i.textContent)).toEqual(['Perspective', 'Parallel']);
    expect(items().find((i) => i.getAttribute('aria-checked') === 'true')?.textContent).toBe('Perspective');
    pick('Parallel');
    expect(fake.last('setProjection')).toEqual(['setProjection', 'orthographic']);
    expect(document.querySelector('.ribbon-menu')).toBeNull();
    ws.showPlan();
    ws.show3D();
    expect(fake.getCameraState().projection).toBe('orthographic');
  });

  it('in plans there is no menu: they are always parallel', () => {
    const { ws } = mount();
    ws.setModel(wall);
    ws.showPlan();
    cubeMenu();
    expect(document.querySelector('.ribbon-menu')).toBeNull();
  });
});

describe('mountWorkspace: estilos visuales', () => {
  const styleBtn = () => $<HTMLButtonElement>('button.ws-vb-btn[aria-label="Visual Style"]');
  const items = () => [...document.querySelectorAll<HTMLElement>('.ribbon-menu [role="menuitemradio"]')];
  const checked = () => items().find((i) => i.getAttribute('aria-checked') === 'true')?.textContent;
  const choose = (label: string) => {
    styleBtn().click();
    items().find((i) => i.textContent === label)!.click();
  };

  it('the Visual Style button opens the five options, with that of the view marked', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(styleBtn().disabled).toBe(false);
    styleBtn().click();
    expect(items().map((i) => i.textContent)).toEqual(['Wireframe', 'Hidden Line', 'Shaded', 'Consistent Colors', 'Textures']);
    expect(checked()).toBe('Shaded');
  });

  it('choosing a style applies it to the viewer and closes the menu', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    choose('Hidden Line');
    expect(fake.last('setVisualStyle')).toEqual(['setVisualStyle', 'hidden']);
    expect(document.querySelector('.ribbon-menu')).toBeNull();
  });

  it('cada vista conserva su estilo: la planta empieza en Hidden Line y {3D} recupera el suyo', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    expect(fake.last('setVisualStyle')).toEqual(['setVisualStyle', 'shaded']);
    choose('Consistent Colors');
    ws.showPlan();
    expect(fake.last('setVisualStyle')).toEqual(['setVisualStyle', 'hidden']);
    choose('Wireframe');
    ws.show3D();
    expect(fake.last('setVisualStyle')).toEqual(['setVisualStyle', 'consistent']);
    styleBtn().click();
    expect(checked()).toBe('Consistent Colors');
  });

  it('the icon of the button changes with the chosen style and with that of each view', () => {
    const { ws } = mount();
    ws.setModel(wall);
    const icon = () => styleBtn().querySelector('svg')!.innerHTML;
    expect(styleBtn().dataset.style).toBe('shaded');
    expect(icon()).toBe(svgIcon('styleShaded').innerHTML);
    choose('Wireframe');
    expect(styleBtn().dataset.style).toBe('wireframe');
    expect(icon()).toBe(svgIcon('styleWireframe').innerHTML);
    expect(styleBtn().querySelectorAll('svg')).toHaveLength(1);
    ws.showPlan();
    expect(icon()).toBe(svgIcon('styleHidden').innerHTML);
    ws.show3D();
    expect(icon()).toBe(svgIcon('styleWireframe').innerHTML);
  });
});

describe('mountWorkspace: boceto de suelos', () => {
  const ROOM_WALLS = [
    { id: 's', start: [0, 0], end: [6, 0] },
    { id: 'e', start: [6, 0], end: [6, 4] },
    { id: 'n', start: [6, 4], end: [0, 4] },
    { id: 'w', start: [0, 4], end: [0, 0] },
  ] as const;
  const clickAt = () => {
    const c = $('.ws-canvas');
    c.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    c.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
  };
  const ctxTabs = () => [...document.querySelectorAll('[role="tab"]')].filter((t) => t.textContent === 'Modify | Create Floor Boundary');
  const sketchObjects = (fake: FakeViewer) => fake.scene.children.filter((c) => c.name.startsWith('sketch-'));

  async function sketchSetup(withWalls = false) {
    const d = newDocument();
    if (withWalls) {
      for (const w of ROOM_WALLS) {
        d.walls.push({
          id: w.id, start: [...w.start], end: [...w.end], thickness: 0.2, bodyId: `b${w.id}`, axisId: `a${w.id}`,
          baseLevelId: d.levels[0].id, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
        });
      }
    }
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const nodes = [...m.result.byPath.values()];
    const storey = nodes.find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    let p: [number, number] = [0, 0];
    const editor = {
      addWall: vi.fn(), deleteWall: vi.fn(), deleteFloor: vi.fn(),
      addFloor: vi.fn(async (_b: [number, number][], _l: string): Promise<string | null> => null),
    };
    const studio = {
      levels: () => d.levels,
      walls: () => d.walls,
      floor: () => undefined,
      setFloorConstraints: vi.fn(async () => true),
      wall: (id: string) => d.walls.find((w) => w.id === id),
      addLevel: vi.fn(async () => d.levels[0].id),
      renameLevel: vi.fn(async () => true),
      setLevelElevation: vi.fn(async () => true),
      setWallConstraints: vi.fn(async () => true),
    };
    const ctx = mount({ editor, studio, pickPoint: () => p });
    ctx.fake.levelsOut = [{ path: storey.path, name: 'Level 1', minZ: 0, maxZ: 3 }];
    ctx.ws.setModel(m);
    ctx.ws.setEditable(true);
    const at = (x: number, y: number) => {
      p = [x, y];
      clickAt();
    };
    const rect = (x1: number, y1: number, x2: number, y2: number) => {
      action('sketchRect').click();
      at(x1, y1);
      at(x2, y2);
    };
    return { ...ctx, d, m, storey, editor, at, rect };
  }
  type Setup = Awaited<ReturnType<typeof sketchSetup>>;

  it('Floor opens the plan and shows the sketch tab with Pick Walls active', async () => {
    const { ws } = await sketchSetup();
    ws.show3D();
    action('floor').click();
    expect(activeTab()).toBe('Floor Plan: Level 1');
    expect(ctxTabs()).toHaveLength(1);
    expect(ctxTabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(action('sketchPick').getAttribute('aria-pressed')).toBe('true');
    expect($('.ws-status-msg').textContent).toBe('Pick walls to create lines.');
  });

  it('during the sketch Wall, Floor and Level are disabled and come back when finished', async () => {
    await sketchSetup();
    action('floor').click();
    for (const a of ['wall', 'floor', 'level']) expect(action(a).disabled).toBe(true);
    action('sketchCancel').click();
    for (const a of ['wall', 'floor', 'level']) expect(action(a).disabled).toBe(false);
  });

  it('Rectangle y Finish crean el suelo en el nivel de la planta y limpian el boceto', async () => {
    const { editor, fake, rect, d } = await sketchSetup();
    action('floor').click();
    rect(0, 0, 4, 3);
    expect(sketchObjects(fake).length).toBeGreaterThan(0);
    action('sketchFinish').click();
    expect(editor.addFloor).toHaveBeenCalledTimes(1);
    const [boundary, levelId] = editor.addFloor.mock.calls[0];
    expect(boundary).toHaveLength(4);
    expect(levelId).toBe(d.levels[0].id);
    expect(ctxTabs()).toHaveLength(0);
    expect(sketchObjects(fake)).toHaveLength(0);
    expect(action('floor').getAttribute('aria-pressed')).toBe('false');
  });

  it('tras Finish el suelo que devuelve el editor queda seleccionado', async () => {
    const { editor, fake, rect, m } = await sketchSetup(true);
    const elemento = [...m.result.byPath.values()].find((n) => n.origin === 's')!; // hace de suelo nuevo
    editor.addFloor.mockResolvedValue('s');
    action('floor').click();
    rect(0, 0, 4, 3);
    action('sketchFinish').click();
    await vi.waitFor(() => expect(fake.last('select')).toEqual(['select', elemento.path]));
  });

  it('con el contorno abierto Finish avisa y sigue en el boceto', async () => {
    const { editor, at } = await sketchSetup();
    action('floor').click();
    action('sketchLine').click();
    at(0, 0);
    at(4, 0);
    action('sketchFinish').click();
    expect(editor.addFloor).not.toHaveBeenCalled();
    expect(document.querySelector('#toasts')!.textContent).toContain('Boundary must be a single closed loop.');
    expect(ctxTabs()).toHaveLength(1);
  });

  it('Pick Walls: cuatro muros elegidos por dentro dan el contorno interior', async () => {
    const { editor, at } = await sketchSetup(true);
    action('floor').click();
    for (const [x, y] of [[3, 0.05], [5.95, 2], [3, 3.95], [0.05, 2]]) at(x, y);
    action('sketchFinish').click();
    expect(editor.addFloor).toHaveBeenCalledTimes(1);
    const corners = editor.addFloor.mock.calls[0][0].map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);
    expect(corners).toHaveLength(4);
    for (const c of [[0.1, 0.1], [5.9, 0.1], [5.9, 3.9], [0.1, 3.9]]) expect(corners).toContainEqual(c);
  });

  it('Cancel y Esc sin herramienta descartan el boceto sin crear nada', async () => {
    const { editor, fake, rect } = await sketchSetup();
    action('floor').click();
    rect(0, 0, 4, 3);
    action('sketchCancel').click();
    expect(ctxTabs()).toHaveLength(0);
    expect(sketchObjects(fake)).toHaveLength(0);

    action('floor').click();
    rect(0, 0, 4, 3);
    key('Escape'); // deja Rectangle
    expect($('.ws-status-msg').textContent).toBe('Select a line, or click Finish Edit Mode.');
    expect(action('sketchRect').getAttribute('aria-pressed')).toBe('false');
    key('Escape'); // sale
    expect(ctxTabs()).toHaveLength(0);
    expect(editor.addFloor).not.toHaveBeenCalled();
  });

  it('Del deletes the selected line and does not touch the walls', async () => {
    const { editor, fake, rect, at } = await sketchSetup();
    action('floor').click();
    rect(0, 0, 4, 3);
    key('Escape'); // sin herramienta de dibujo
    at(2, 0.01); // sobre el lado inferior
    key('Delete');
    expect(editor.deleteWall).not.toHaveBeenCalled();
    action('sketchFinish').click(); // ahora le falta un lado
    expect(editor.addFloor).not.toHaveBeenCalled();
    expect(sketchObjects(fake).length).toBeGreaterThan(0);
  });

  it.each([
    ['cambiar de vista', () => action('view3d').click()],
    ['cerrar el documento', (c: Setup) => c.ws.setModel(null)],
    ['pasar a solo lectura', (c: Setup) => c.ws.setEditable(false)],
  ])('%s con el boceto a medias no deja restos', async (_n, act) => {
    const ctx = await sketchSetup();
    action('floor').click();
    ctx.rect(0, 0, 4, 3);
    act(ctx);
    expect(ctxTabs()).toHaveLength(0);
    expect(sketchObjects(ctx.fake)).toHaveLength(0);
    expect(action('floor').getAttribute('aria-pressed')).toBe('false');
  });

  it('without editing Floor is disabled with the read-only notice', async () => {
    const { ws } = await sketchSetup();
    ws.setEditable(false);
    expect(action('floor').disabled).toBe(true);
    expect(action('floor').title).toBe('Only models created in Dream BIM can be edited');
  });

  it('Floor y Wall no conviven: empezar un suelo detiene el muro', async () => {
    await sketchSetup();
    action('wall').click();
    action('floor').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
  });

  it('Supr sobre un suelo seleccionado lo borra', async () => {
    const { editor, fake, storey } = await sketchSetup();
    // el nodo seleccionado hace de IfcSlab
    (storey.attributes['bsi::ifc::class'] as { code: string }).code = 'IfcSlab';
    fake.onPick(storey.path);
    key('Delete');
    expect(editor.deleteFloor).toHaveBeenCalledWith(storey.origin);
    expect(editor.deleteWall).not.toHaveBeenCalled();
  });
});

describe('mountWorkspace: Stage and Layer panels', () => {
  const actions = (over: Partial<ComposerActions> = {}): ComposerActions => ({
    onAdd: vi.fn(), onToggle: vi.fn(), onToggleEdits: vi.fn(), onRemove: vi.fn(), onMoveLayer: vi.fn(), onRelink: vi.fn(),
    ...over,
  });
  const noStage = (root: ComposedNode | null = null) => ({ root, sourceOf: new Map(), colors: new Map(), marks: new Map() });
  const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.ws-right [role="tab"]')].find((t) => t.textContent === name)!;

  it('the right column has Stage, Layer and References tabs, Stage active, clicking Layer swaps the panels', () => {
    mount();
    expect($('.ws-right [role="tablist"]')).toBeTruthy();
    expect(tab('Stage').getAttribute('aria-selected')).toBe('true');
    expect(tab('Layer').getAttribute('aria-selected')).toBe('false');
    expect($('.ws-stage').hidden).toBe(false);
    expect($('.ws-layer').hidden).toBe(true);
    tab('Layer').click();
    expect(tab('Layer').getAttribute('aria-selected')).toBe('true');
    expect(tab('Stage').getAttribute('aria-selected')).toBe('false');
    expect($('.ws-stage').hidden).toBe(true);
    expect($('.ws-layer').hidden).toBe(false);
    expect($('.ws-move').hidden).toBe(false); // the Move footer stays under the two tabs
    tab('Stage').click();
    expect($('.ws-stage').hidden).toBe(false);
    expect($('.ws-layer').hidden).toBe(true);
  });

  it('the composer tabs are reachable by keyboard: arrows, Home and End focus and activate', () => {
    mount();
    const press = (k: string) => tab('Stage').parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    expect(tab('Stage').tabIndex).toBe(0);
    expect(tab('Layer').tabIndex).toBe(-1);
    expect(tab('References').tabIndex).toBe(-1);
    press('ArrowRight');
    expect(tab('Layer').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Layer'));
    expect($('.ws-layer').hidden).toBe(false);
    press('ArrowRight');
    expect(tab('References').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('References'));
    expect($('.ws-refs').hidden).toBe(false);
    expect($('.ws-layer').hidden).toBe(true);
    press('ArrowRight'); // da la vuelta
    expect(tab('Stage').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Stage'));
    press('ArrowLeft'); // it goes backwards
    expect(tab('References').getAttribute('aria-selected')).toBe('true');
    press('Home');
    expect(tab('Stage').getAttribute('aria-selected')).toBe('true');
    expect($('.ws-stage').hidden).toBe(false);
    press('End');
    expect(tab('References').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('References'));
  });

  it('the References tab lists the linked files of the open model and follows the selection', async () => {
    const { ws } = mount();
    ws.setModel(wall);
    tab('References').click();
    expect($('.ws-refs').hidden).toBe(false);
    expect($('.ws-stage').hidden).toBe(true);
    expect(document.querySelectorAll('.ws-refs .refs-row').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.ws-refs .refs-role')!.textContent).toBe('Document');
    ws.setModel(null);
    expect(document.querySelectorAll('.ws-refs .refs-row')).toHaveLength(0);
  });

  it('selecting a plan in the Project Browser moves the Stage highlight to its level', () => {
    const storey = [...wall.result.byPath.values()].find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    expect(storey).toBeTruthy();
    const { ws, fake } = mount();
    fake.levelsOut = [{ path: storey.path, name: 'Planta X', minZ: 0, maxZ: 3 }];
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path);
    expect($(`.ws-stage .stage-row[data-origin="${w.origin}"]`).classList.contains('selected')).toBe(true);
    const plan = [...document.querySelectorAll<HTMLElement>('.ws-browser .pb-node')].find((n) => n.dataset.label === 'Planta X')!;
    plan.click();
    expect($(`.ws-stage .stage-row[data-origin="${w.origin}"]`).classList.contains('selected')).toBe(false);
    expect(document.querySelector<HTMLElement>('.ws-stage .stage-row.selected')?.dataset.origin).toBe(storey.origin);
  });

  it('selecting in the view reveals the element in the Stage (without forcing the tab)', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    ws.setComposer([{ kind: 'document', name: 'hello-wall', path: null }], noStage(wall.result.root));
    tab('Layer').click();
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path);
    const r = $(`.ws-stage .stage-row[data-origin="${w.origin}"]`);
    expect(r.classList.contains('selected')).toBe(true);
    expect($('.ws-stage').hidden).toBe(true); // the Layer tab stays active
    key('Escape');
    expect(document.querySelector('.ws-stage .stage-row.selected')).toBeNull();
  });

  it('the eye in the Stage hides the element in the view', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    ws.setComposer([{ kind: 'document', name: 'hello-wall', path: null }], noStage(wall.result.root));
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path); // seleccionar despliega el Stage hasta su fila
    const eye = () => $(`.ws-stage .stage-row[data-origin="${w.origin}"] .stage-eye`);
    eye().click();
    expect(fake.last('setHidden')).toEqual(['setHidden', [w.path]]);
    eye().click();
    expect(fake.last('setHidden')).toEqual(['setHidden', []]);
  });

  it('a click in the Stage selects the element in the view and Properties', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    fake.onPick(w.path); // despliega hasta el muro
    fake.onPick(null);
    fake.reset();
    $(`.ws-stage .stage-row[data-origin="${w.origin}"]`).click();
    expect(fake.last('select')).toEqual(['select', w.path]);
    expect($('.prop-count').textContent).toBe('1 element selected');
    $(`.ws-stage .stage-row[data-origin="${w.origin}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(fake.last('fit')).toEqual(['fit', w.path, undefined]);
  });

  describe('a reused element (two instances of one origin)', () => {
    /** R / {a / c, b / c}: C reutilizado bajo dos padres. */
    const reusedModel = () =>
      loadModel('r', null, JSON.stringify({
        data: [
          { path: 'R', children: { a: 'A', b: 'B' } },
          { path: 'A', children: { c: 'C' } },
          { path: 'B', children: { c: 'C' } },
          { path: 'C' },
        ],
      }), offlineFetcher);
    const rowAt = (p: string) => $(`.ws-stage .stage-row[data-path="${p}"]`);

    it('clicking the second instance in the Stage selects (and fits) the second path', async () => {
      const m = await reusedModel();
      expect(m.result.byOrigin.get('C')!.map((n) => n.path)).toEqual(['/R/a/c', '/R/b/c']);
      const { ws, fake } = mount();
      ws.setModel(m);
      rowAt('/R/b/c').click();
      expect(fake.last('select')).toEqual(['select', '/R/b/c']);
      expect(rowAt('/R/b/c').classList.contains('selected')).toBe(true);
      expect(rowAt('/R/a/c').classList.contains('selected')).toBe(false);
      rowAt('/R/b/c').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(fake.last('fit')).toEqual(['fit', '/R/b/c', undefined]);
    });

    it('selecting the second instance in the view reveals the second Stage row', async () => {
      const m = await reusedModel();
      const { ws, fake } = mount();
      ws.setModel(m);
      fake.onPick('/R/b/c');
      expect(rowAt('/R/b/c').classList.contains('selected')).toBe(true);
      expect(rowAt('/R/a/c').classList.contains('selected')).toBe(false);
    });
  });

  it('the eye of a layer hides in the view the elements that come from it (topmost only), together with the Stage eyes', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    // the element and what hangs from it come from layer 7; the rest, from the document
    const sourceOf = new Map<string, string>([...wall.result.byPath.values()].map((n) => [n.origin, 'document']));
    const mark = (n: ComposedNode) => { sourceOf.set(n.origin, '7'); n.children.forEach(mark); };
    mark(w);
    const fileRow = { kind: 'file' as const, id: '7', name: 'a.ifcx', path: 'C:/p/a.ifcx', color: '#3182bd', enabled: true,
      missing: false, editCount: 0, editsEnabled: true, orphans: [] };
    ws.setComposer([fileRow, { kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    $('.ws-layer .layer-eye').click();
    expect(fake.last('setHidden')).toEqual(['setHidden', [w.path]]);
    // with an eye of the Stage as well, both are hidden
    const storey = w.parent!;
    fake.onPick(w.path);
    $(`.ws-stage .stage-row[data-path="${storey.path}"] .stage-eye`).click();
    expect(new Set(fake.last('setHidden')![1] as string[])).toEqual(new Set([w.path, storey.path]));
    $('.ws-layer .layer-eye').click();
    expect(fake.last('setHidden')).toEqual(['setHidden', [storey.path]]);
  });

  it('dragging a Stage row onto another node of its layer relocates it through the composer', () => {
    const reparent = vi.fn(async () => true);
    const { ws, fake } = mount({ composer: actions({ reparent }) });
    ws.setModel(wall);
    const w = firstElementWithClass(wall.result.root)!;
    const to = w.parent!.parent!;
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, '7']));
    ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    fake.onPick(w.path); // despliega hasta el muro
    const fire = (type: string, target: HTMLElement) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { dataTransfer: { dropEffect: 'none', effectAllowed: 'all', setData: () => {} } });
      target.dispatchEvent(e);
    };
    const from = $(`.ws-stage .stage-row[data-path="${w.path}"]`);
    const onto = $(`.ws-stage .stage-row[data-path="${to.path}"]`);
    fire('dragstart', from);
    fire('dragover', onto);
    fire('drop', onto);
    expect(reparent).toHaveBeenCalledWith('7', w.origin, to.origin, { node: w.path, parent: to.path });
  });

  it('a Layer row dropped on a level in the Stage places it through the composer; dragging over the Stage tab opens it', () => {
    const onPlace = vi.fn();
    const { ws, fake } = mount({ composer: actions({ onPlace }) });
    ws.setEditable(true);
    ws.setModel(wall);
    const storey = [...wall.result.byPath.values()].find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, 'document']));
    ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    fake.onPick(storey.path); // despliega hasta el nivel
    tab('Layer').click();
    const fire = (type: string, target: HTMLElement) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, {
        dataTransfer: { dropEffect: 'none', effectAllowed: 'copyMove', types: [LAYER_DRAG_TYPE], getData: () => '5', setData: () => {} },
      });
      target.dispatchEvent(e);
      return e;
    };
    // passing over the Stage tab opens it (the two tabs are not seen at once)
    expect(fire('dragover', tab('Stage')).defaultPrevented).toBe(true);
    expect($('.ws-stage').hidden).toBe(false);
    const onto = $(`.ws-stage .stage-row[data-origin="${storey.origin}"]`);
    fire('dragover', onto);
    fire('drop', onto);
    expect(onPlace).toHaveBeenCalledWith('5', storey.origin);
  });

  it('in a read-only document a Layer row dropped on a level in the Stage is not allowed', () => {
    const onPlace = vi.fn();
    const { ws, fake } = mount({ composer: actions({ onPlace }) });
    ws.setModel(wall); // sin setEditable(true)
    const storey = [...wall.result.byPath.values()].find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, 'document']));
    ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    fake.onPick(storey.path);
    tab('Layer').click();
    const dt = { dropEffect: 'copy', effectAllowed: 'copyMove', types: [LAYER_DRAG_TYPE], getData: () => '5', setData: () => {} };
    const fire = (type: string, target: HTMLElement) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, { dataTransfer: dt });
      target.dispatchEvent(e);
      return e;
    };
    const onto = $(`.ws-stage .stage-row[data-origin="${storey.origin}"]`);
    expect(fire('dragover', onto).defaultPrevented).toBe(false);
    expect(dt.dropEffect).toBe('none');
    expect(onto.classList.contains('drop-denied')).toBe(true);
    fire('drop', onto);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('the Place… menu of a Layer row calls onPlace and onUnplace', () => {
    const onPlace = vi.fn();
    const onUnplace = vi.fn();
    const { ws } = mount({ composer: actions({ onPlace, onUnplace }) });
    const file = (placedIn?: string): StackRow => ({
      kind: 'file', id: '2', name: 'a.ifcx', path: 'C:/a.ifcx', color: '', enabled: true, missing: false, editCount: 0, editsEnabled: true, orphans: [],
      ...(placedIn ? { placedIn } : {}),
    });
    const doc: StackRow = { kind: 'document', name: 'casa', path: null, targets: [{ id: 'p', name: 'Project' }, { id: 'l1', name: 'Level 1' }] };
    ws.setComposer([file(), doc], noStage());
    tab('Layer').click();
    const items = () => [...document.querySelectorAll<HTMLElement>('.ribbon-menu [role="menuitemradio"]')];
    $<HTMLButtonElement>('.ws-layer .layer-place').click();
    items()[1].click();
    expect(onPlace).toHaveBeenCalledWith('2', 'l1');
    ws.setComposer([file('l1'), doc], noStage());
    $<HTMLButtonElement>('.ws-layer .layer-place').click();
    items().find((i) => i.textContent === 'Unplace')!.click();
    expect(onUnplace).toHaveBeenCalledWith('2');
  });

  it('the Stage search filters the model tree', () => {
    vi.useFakeTimers();
    try {
      const { ws } = mount();
      ws.setModel(wall);
      const w = firstElementWithClass(wall.result.root)!;
      const input = $<HTMLInputElement>('.ws-stage .stage-search');
      input.value = 'zzz-no-such-element';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
      expect(document.querySelectorAll('.ws-stage .stage-row')).toHaveLength(0);
      input.value = 'ifcwall';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(200);
      expect(document.querySelector(`.ws-stage .stage-row[data-origin="${w.origin}"]`)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('«+» is disabled without a document and calls onAdd with one', () => {
    const onAdd = vi.fn();
    const { ws } = mount({ composer: actions({ onAdd }) });
    const add = $<HTMLButtonElement>('.ws-layer .ws-layers-add');
    expect(add.disabled).toBe(true);
    expect(document.querySelectorAll('.ws-layer .layer-row')).toHaveLength(0);
    ws.setComposer([{ kind: 'document', name: 'casa.ifcx', path: null }], noStage());
    expect(add.disabled).toBe(false);
    add.click();
    expect(onAdd).toHaveBeenCalledOnce();
    ws.setComposer(null, noStage());
    expect(add.disabled).toBe(true);
  });

  it('lists the linked layers and the fixed document row, with toggle, edits toggle and remove', () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const onToggleEdits = vi.fn();
    const { ws } = mount({ composer: actions({ onToggle, onRemove, onToggleEdits }) });
    ws.setComposer([
      {
        kind: 'file', id: '2', name: '<b>extra</b>.ifcx', path: 'C:/p/extra.ifcx', color: '',
        enabled: true, missing: false, editCount: 2, editsEnabled: true, orphans: [],
      },
      { kind: 'document', name: 'casa.ifcx', path: null },
    ], noStage());
    const rows = [...document.querySelectorAll<HTMLElement>('.ws-layer .layer-row')];
    expect(rows).toHaveLength(3);
    expect(rows[2].querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(rows[2].querySelector('.layer-remove')).toBeNull();
    expect(rows[0].querySelector('.layer-name')!.textContent).toBe('<b>extra</b>.ifcx'); // texto, no HTML
    const check = rows[0].querySelector<HTMLInputElement>('input')!;
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    expect(onToggle).toHaveBeenCalledWith('2', false);
    const edits = rows[1].querySelector<HTMLInputElement>('input')!;
    edits.checked = false;
    edits.dispatchEvent(new Event('change'));
    expect(onToggleEdits).toHaveBeenCalledWith('2', false);
    rows[0].querySelector<HTMLButtonElement>('.layer-remove')!.click();
    expect(onRemove).toHaveBeenCalledWith('2');
  });
});

describe('mountWorkspace: Move box', () => {
  const actions = (over: Partial<ComposerActions> = {}): ComposerActions => ({
    onAdd: vi.fn(), onToggle: vi.fn(), onToggleEdits: vi.fn(), onRemove: vi.fn(), onMoveLayer: vi.fn(), onRelink: vi.fn(),
    moveBy: vi.fn(async () => true), moveTo: vi.fn(async () => true),
    rotateTo: vi.fn(async () => true), scaleTo: vi.fn(async () => true),
    ...over,
  });
  const box = () => $('.ws-move .movebox');
  const field = (label: string) => $<HTMLInputElement>(`.ws-move input[aria-label="${label}"]`);
  const enter = (label: string, value: string) => {
    const i = field(label);
    i.value = value;
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  /** Studio document with a wall, loaded, editable and with the Stage saying everything belongs to the document. */
  async function studioDoc(composer = actions(), extra: Partial<WorkspaceOptions<FakeViewer>> = {}) {
    const d = newDocument();
    d.levels[0].elevation = 0.5;
    d.walls.push({
      id: 'w1', start: [1, 2], end: [4, 2], thickness: 0.2, bodyId: 'b1', axisId: 'a1',
      baseLevelId: d.levels[0].id, baseOffset: 0, topLevelId: null, topOffset: 0, height: 3,
    });
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const studio = {
      levels: () => d.levels, walls: () => d.walls, floor: () => undefined,
      wall: (id: string) => d.walls.find((w) => w.id === id),
      setFloorConstraints: vi.fn(async () => true), addLevel: vi.fn(async () => null),
      renameLevel: vi.fn(async () => true), setLevelElevation: vi.fn(async () => true), setWallConstraints: vi.fn(async () => true),
    };
    const ctx = mount({ studio, composer, ...extra });
    ctx.ws.setModel(m);
    ctx.ws.setEditable(true);
    const sourceOf = new Map([...m.result.byPath.values()].map((n) => [n.origin, 'document']));
    ctx.ws.setComposer([{ kind: 'document', name: 's', path: null }], { root: m.result.root, sourceOf, colors: new Map(), marks: new Map() });
    const node = (origin: string) => [...m.result.byPath.values()].find((n) => n.origin === origin)!;
    return { ...ctx, d, m, composer, node };
  }

  it('is mounted hidden in the right column foot and shows a selected document wall (X/Y only)', async () => {
    const { fake, node, composer } = await studioDoc();
    expect(box().hidden).toBe(true);
    fake.onPick(node('w1').path);
    expect(box().hidden).toBe(false);
    expect($('.movebox-title').textContent).toMatch(/^Transform · /);
    // the wall rotates in plan (its direction: 0°) and is not scaled
    expect(field('Rotation Z').value).toBe('0.00');
    expect(field('Rotation Z').disabled).toBe(false);
    expect(field('Scale X').disabled).toBe(true);
    expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(['1.00', '2.00', '0.50']);
    expect(field('Z').disabled).toBe(true);
    expect(field('ΔZ').disabled).toBe(true);
    enter('ΔX', '0.5');
    expect(composer.moveBy).toHaveBeenCalledWith({ branch: 'document', origin: 'w1' }, [0.5, 0, 0]);
    fake.onPick(null);
    expect(box().hidden).toBe(true);
  });

  it('the splitter above the box changes its height (dragging up makes it taller)', async () => {
    const { fake, node } = await studioDoc();
    fake.onPick(node('w1').path);
    const split = $('.ws-move-split');
    const host = $('.ws-move');
    host.getBoundingClientRect = () => ({ height: 100 }) as DOMRect;
    $('.ws-right').getBoundingClientRect = () => ({ height: 600 }) as DOMRect;
    Object.defineProperty($('.ws-right'), 'clientHeight', { value: 600, configurable: true });
    split.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientY: 400 }));
    split.dispatchEvent(new PointerEvent('pointermove', { clientY: 340 }));
    split.dispatchEvent(new PointerEvent('pointerup', {}));
    expect(host.style.flex).toBe('0 0 160px');
    split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(host.style.flex).toBe('0 0 132px'); // with the keyboard, without going below the minimum (the four rows)
  });

  it('a level moves only in Z; the building does not move at all', async () => {
    const { fake, d, node, composer } = await studioDoc();
    fake.onPick(node(d.levels[0].id).path);
    expect(box().hidden).toBe(false);
    expect(field('X').disabled).toBe(true);
    expect(field('Z').value).toBe('0.50');
    enter('Z', '3');
    expect(composer.moveTo).toHaveBeenCalledWith({ branch: 'document', origin: d.levels[0].id }, [0, 0, 3]);
    fake.onPick(node(d.ids.building).path);
    expect(box().hidden).toBe(true);
  });

  it('is hidden in read-only documents and without move actions', async () => {
    const { ws, fake, node } = await studioDoc();
    fake.onPick(node('w1').path);
    ws.setEditable(false);
    expect(box().hidden).toBe(true);
    fake.onPick(node('w1').path);
    expect(box().hidden).toBe(true);

    const other = await studioDoc(actions({ moveBy: undefined, moveTo: undefined }));
    other.fake.onPick(other.node('w1').path);
    expect(box().hidden).toBe(true);
  });

  it('the container of a placed file is selected from the Stage and moves in X/Y/Z (offset over its level)', async () => {
    const d = newDocument();
    d.levels[0].elevation = 2;
    d.composer = {
      layers: [{ uri: './a.ifcx', name: 'a.ifcx', color: '', enabled: true, editsEnabled: true, edits: [] }],
      placements: [{ id: 'pc', layerUri: './a.ifcx', parentId: d.levels[0].id, roots: ['R'], offset: [1, 0, 0.5] }],
    };
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const studio = {
      levels: () => d.levels, walls: () => d.walls, floor: () => undefined, wall: () => undefined,
      placement: (id: string) => d.composer.placements.find((p) => p.id === id),
      setFloorConstraints: vi.fn(async () => true), addLevel: vi.fn(async () => null),
      renameLevel: vi.fn(async () => true), setLevelElevation: vi.fn(async () => true), setWallConstraints: vi.fn(async () => true),
    };
    const composer = actions();
    const { ws, fake } = mount({ studio, composer });
    ws.setModel(m);
    ws.setEditable(true);
    const sourceOf = new Map([...m.result.byPath.values()].map((n) => [n.origin, 'document']));
    ws.setComposer([{ kind: 'document', name: 's', path: null }], { root: m.result.root, sourceOf, colors: new Map(), marks: new Map() });
    const container = [...m.result.byPath.values()].find((n) => n.origin === 'pc')!;
    fake.onPick(container.path); // revela la fila en el Stage
    expect(fake.last('select')).toEqual(['select', container.path]); // no sube al nivel
    fake.onPick(null);
    $(`.ws-stage .stage-row[data-origin="pc"]`).click();
    expect(box().hidden).toBe(false);
    expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(['1.00', '0.00', '2.50']);
    expect(['X', 'Y', 'Z'].map((a) => field(a).disabled)).toEqual([false, false, false]);
    enter('ΔZ', '1');
    expect(composer.moveBy).toHaveBeenCalledWith({ branch: 'document', origin: 'pc' }, [0, 0, 1]);
  });

  it('a linked element moves in X/Y/Z through its layer, with its world origin', () => {
    const composer = actions();
    const { ws, fake } = mount({ composer });
    ws.setModel(wall);
    ws.setEditable(true);
    const w = firstElementWithClass(wall.result.root)!;
    ws.setComposer([{ kind: 'document', name: 'casa', path: null }], {
      root: wall.result.root, sourceOf: new Map([[w.origin, '7']]), colors: new Map(), marks: new Map(),
    });
    fake.onPick(w.path);
    expect(box().hidden).toBe(false);
    const o = worldOrigin(w);
    expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(o.map((v) => (v.toFixed(2) === '-0.00' ? '0.00' : v.toFixed(2))));
    expect(['X', 'Y', 'Z'].every((a) => !field(a).disabled)).toBe(true);
    enter('X', '3');
    expect(composer.moveTo).toHaveBeenCalledWith({ branch: '7', path: editPath(w, wall.result), node: w }, [3, o[1], o[2]]);
    // un elemento que el Stage no atribuye a ninguna capa no se mueve
    fake.onPick(wall.result.root.children[0].path);
    expect(box().hidden).toBe(true);
  });

  it('a linked element whose layer edits are switched off gets no Move box and no arrows', () => {
    let made: FakeTransformControls | null = null;
    const composer = actions();
    const { ws, fake } = mount({ composer, makeTransformControls: (cam, dom) => (made = new FakeTransformControls(cam, dom)) });
    ws.setModel(wall);
    ws.setEditable(true);
    const w = firstElementWithClass(wall.result.root)!;
    const stage = { root: wall.result.root, sourceOf: new Map([[w.origin, '7']]), colors: new Map(), marks: new Map() };
    const file = (editsEnabled: boolean): StackRow => ({
      kind: 'file', id: '7', name: 'a.ifcx', path: 'C:/a.ifcx', color: '', enabled: true, missing: false, editCount: 1, editsEnabled, orphans: [],
    });
    ws.setComposer([file(false), { kind: 'document', name: 'casa', path: null }], stage);
    fake.onPick(w.path);
    expect(box().hidden).toBe(true);
    expect(made!.object).toBeUndefined();
    // al volver a activarlas, el cuadro y las flechas aparecen
    ws.setComposer([file(true), { kind: 'document', name: 'casa', path: null }], stage);
    expect(box().hidden).toBe(false);
    expect(made!.object).toBeDefined();
  });

  it('Move on the second instance of a reused linked element writes the edit of that instance', async () => {
    const m = await loadModel('r', null, JSON.stringify({
      data: [
        { path: 'R', children: { a: 'A', b: 'B' } },
        { path: 'A', children: { c: 'C' } },
        { path: 'B', children: { c: 'C' } },
        { path: 'C' },
      ],
    }), offlineFetcher);
    const composer = actions();
    const { ws } = mount({ composer });
    ws.setModel(m);
    ws.setEditable(true);
    const sourceOf = new Map([...m.result.byPath.values()].map((n) => [n.origin, '7']));
    ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: m.result.root, sourceOf, colors: new Map(), marks: new Map() });
    const second = m.result.byPath.get('/R/b/c')!;
    $(`.ws-stage .stage-row[data-path="/R/b/c"]`).click();
    expect(box().hidden).toBe(false);
    enter('X', '3');
    const path = editPath(second, m.result);
    expect(path).not.toBe(editPath(m.result.byPath.get('/R/a/c')!, m.result));
    expect(composer.moveTo).toHaveBeenCalledWith({ branch: '7', path, node: second }, [3, 0, 0]);
  });

  describe('arrows in the view', () => {
    /** Studio with a fake TransformControls: `tc()` is the one the workspace created. */
    async function withArrows(composer = actions()) {
      let made: FakeTransformControls | null = null;
      const ctx = await studioDoc(composer, { makeTransformControls: (cam, dom) => (made = new FakeTransformControls(cam, dom)) });
      return { ...ctx, tc: () => made! };
    }
    const axesShown = (tc: FakeTransformControls) => [tc.showX, tc.showY, tc.showZ];

    it('a selected document wall gets X/Y arrows; dragging previews in the Move box and commits through moveBy', async () => {
      const { fake, node, composer, tc } = await withArrows();
      expect(tc().object).toBeUndefined();
      fake.onPick(node('w1').path);
      expect(tc().object).toBeDefined();
      expect(axesShown(tc())).toEqual([true, true, false]);
      const start = tc().object!.position.clone();
      tc().press('X');
      expect(fake.last('setControlsEnabled')).toEqual(['setControlsEnabled', false]);
      tc().drag(start, [0.5, 0.25, 0]);
      expect(['X', 'Y', 'Z'].map((a) => field(a).value)).toEqual(['1.50', '2.25', '0.50']);
      // el clic que acaba el arrastre no selecciona lo que haya debajo
      fake.onPick(null);
      expect(box().hidden).toBe(false);
      tc().release();
      expect(composer.moveBy).toHaveBeenCalledTimes(1);
      expect(composer.moveBy).toHaveBeenCalledWith({ branch: 'document', origin: 'w1' }, [0.5, 0.25, 0]);
      expect(fake.last('setControlsEnabled')).toEqual(['setControlsEnabled', true]);
      // sin arrastre, un clic en la vista vuelve a seleccionar
      fake.onPick(null);
      expect(tc().object).toBeUndefined();
    });

    it('a rejected move puts the Move box back on the real position', async () => {
      const { fake, node, composer, tc } = await withArrows(actions({ moveBy: vi.fn(async () => false) }));
      fake.onPick(node('w1').path);
      const start = tc().object!.position.clone();
      tc().press('X');
      tc().drag(start, [0.5, 0, 0]);
      tc().release();
      expect(field('X').value).toBe('1.50'); // hasta que llega la respuesta
      expect(composer.moveBy).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0));
      expect(field('X').value).toBe('1.00');
      expect(tc().object!.position.toArray()).toEqual(start.toArray());
    });

    it('Esc during the drag cancels it and keeps the selection', async () => {
      const { fake, node, composer, tc } = await withArrows();
      fake.onPick(node('w1').path);
      const start = tc().object!.position.clone();
      tc().press('Y');
      tc().drag(start, [0, 3, 0]);
      expect(field('Y').value).toBe('5.00');
      key('Escape');
      expect(field('Y').value).toBe('2.00');
      expect(box().hidden).toBe(false);
      tc().release();
      expect(composer.moveBy).not.toHaveBeenCalled();
      expect(tc().object).toBeDefined();
    });

    it('are hidden while drawing, during Walk and in read-only documents', async () => {
      const { ws, fake, node, tc } = await withArrows();
      fake.onPick(node('w1').path);
      action('wall').click();
      expect(tc().object).toBeUndefined();
      key('Escape'); // sale de Wall (en la planta: el muro sigue con X/Y)
      expect(tc().object).toBeDefined();
      action('walk').click();
      expect(tc().object).toBeUndefined();
      action('walk').click();
      expect(tc().object).toBeDefined();
      ws.setEditable(false);
      expect(tc().object).toBeUndefined();
    });

    it('never show Z on a plan view', () => {
      let made: FakeTransformControls | null = null;
      const { ws, fake } = mount({ composer: actions(), makeTransformControls: (cam, dom) => (made = new FakeTransformControls(cam, dom)) });
      ws.setModel(wall);
      ws.setEditable(true);
      const w = firstElementWithClass(wall.result.root)!;
      ws.setComposer([{ kind: 'document', name: 'casa', path: null }], {
        root: wall.result.root, sourceOf: new Map([[w.origin, '7']]), colors: new Map(), marks: new Map(),
      });
      fake.onPick(w.path);
      expect(axesShown(made!)).toEqual([true, true, true]);
      action('plan').click();
      expect(made!.object).toBeDefined();
      expect(axesShown(made!)).toEqual([true, true, false]);
      action('view3d').click();
      expect(axesShown(made!)).toEqual([true, true, true]);
    });
  });
});

describe('mountWorkspace: Properties of linked elements', () => {
  const editableKey = (n: ComposedNode) =>
    Object.entries(n.attributes).find(([k, v]) => typeof v === 'string' && !k.startsWith('usd::') && !k.startsWith('gltf::') && k !== 'bsi::ifc::class')?.[0];

  function linkedWall(edited = false) {
    const setLinkedAttr = vi.fn(async () => true);
    const resetLinkedAttr = vi.fn(async () => true);
    const linkedAttrEdited = vi.fn(() => edited);
    const m = mount({
      composer: {
        onAdd: vi.fn(), onToggle: vi.fn(), onToggleEdits: vi.fn(), onRemove: vi.fn(), onMoveLayer: vi.fn(), onRelink: vi.fn(),
        setLinkedAttr, resetLinkedAttr, linkedAttrEdited,
      },
    });
    m.ws.setModel(wall);
    const w = [...wall.result.byPath.values()].find((n) => ifcClass(n) && ifcClass(n) !== 'IfcBuildingStorey' && editableKey(n))!;
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, '7']));
    m.ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    return { ...m, w, key: editableKey(w)!, setLinkedAttr, resetLinkedAttr, linkedAttrEdited };
  }
  const fieldOf = (key: string) =>
    [...document.querySelectorAll('td.prop-name')].find((t) => (t as HTMLElement).title === key)!.nextElementSibling as HTMLElement;

  it('an element of a linked layer in an editable document has editable attributes that write through the composer', () => {
    const t = linkedWall(true);
    t.ws.setEditable(true);
    t.fake.onPick(t.w.path);
    const input = fieldOf(t.key).querySelector<HTMLInputElement>('input.prop-input')!;
    input.value = 'new value';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(t.setLinkedAttr).toHaveBeenCalledWith('7', t.w, t.key, 'new value');
    fieldOf(t.key).querySelector<HTMLButtonElement>('.prop-reset')!.click();
    expect(t.resetLinkedAttr).toHaveBeenCalledWith('7', t.w, t.key);
  });

  it('read-only documents get no linked editing', () => {
    const t = linkedWall(true);
    t.ws.setEditable(false);
    t.fake.onPick(t.w.path);
    expect(document.querySelector('.ws-props .prop-input, .prop-reset')).toBeNull();
    expect(fieldOf(t.key).textContent).not.toBe('');
  });

  it('with the layer edits switched off, linked attributes are shown read-only', () => {
    const t = linkedWall(true);
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, '7']));
    t.ws.setComposer([
      { kind: 'file', id: '7', name: 'a.ifcx', path: 'C:/a.ifcx', color: '', enabled: true, missing: false, editCount: 1, editsEnabled: false, orphans: [] },
      { kind: 'document', name: 'casa', path: null },
    ], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    t.ws.setEditable(true);
    t.fake.onPick(t.w.path);
    expect(document.querySelector('.ws-props .prop-input, .prop-reset')).toBeNull();
    expect(fieldOf(t.key).textContent).not.toBe('');
  });

  it('elements of the document are not edited as linked', () => {
    const t = linkedWall();
    const sourceOf = new Map([...wall.result.byPath.values()].map((n) => [n.origin, 'document']));
    t.ws.setComposer([{ kind: 'document', name: 'casa', path: null }], { root: wall.result.root, sourceOf, colors: new Map(), marks: new Map() });
    t.ws.setEditable(true);
    t.fake.onPick(t.w.path);
    expect(fieldOf(t.key).querySelector('input')).toBeNull();
  });
});

describe('mountWorkspace: Library', () => {
  const ENTRIES = [{ name: 'Puerta.ifcx', path: 'C:/lib/Puerta.ifcx', isDir: false }];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fire = (type: string, target: HTMLElement) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer: { dropEffect: 'none', effectAllowed: 'copy', types: ['text/plain'], setData: () => {}, getData: () => '' } });
    target.dispatchEvent(e);
    return e;
  };

  /** Studio document with the library at C:/lib and Project and Level 1 as targets. */
  async function libraryDoc(editable = true) {
    const d = newDocument();
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const placeAsset = vi.fn(async () => true);
    const linkAsset = vi.fn(async () => true);
    const composer = {
      onAdd: vi.fn(), onToggle: vi.fn(), onToggleEdits: vi.fn(), onRemove: vi.fn(), onMoveLayer: vi.fn(), onRelink: vi.fn(),
      placeAsset, linkAsset,
    };
    const ctx = mount({
      composer,
      pickPoint: () => [4, 5],
      library: { folder: 'C:/lib', chooseFolder: async () => null, list: async () => ENTRIES },
    });
    ctx.ws.setModel(m);
    ctx.ws.setEditable(editable);
    const targets = [{ id: d.ids.project, name: 'Project' }, { id: d.levels[0].id, name: 'Level 1' }];
    ctx.ws.setComposer([{ kind: 'document', name: 's', path: null, ...(editable ? { targets } : {}) }], {
      root: m.result.root, sourceOf: new Map(), colors: new Map(), marks: new Map(),
    });
    await flush();
    const tile = $('.ws-library .lib-tile');
    return { ...ctx, d, placeAsset, linkAsset, tile };
  }

  it('a tile dropped onto a plan view is placed under its level at the point under the pointer', async () => {
    const { ws, d, placeAsset, tile } = await libraryDoc();
    ws.showPlan();
    fire('dragstart', tile);
    const view = $('.ws-view');
    expect(fire('dragover', view).defaultPrevented).toBe(true);
    expect(view.classList.contains('lib-drop-target')).toBe(true);
    fire('drop', view);
    fire('dragend', tile);
    expect(view.classList.contains('lib-drop-target')).toBe(false);
    expect(placeAsset).toHaveBeenCalledWith('C:/lib/Puerta.ifcx', d.levels[0].id, [4, 5]);
  });

  it('ws.placeAsset places a file under the project, like a double click on a tile', async () => {
    const { ws, d, placeAsset } = await libraryDoc();
    ws.show3D();
    ws.placeAsset('C:/lib/Puerta.ifcx');
    expect(placeAsset).toHaveBeenLastCalledWith('C:/lib/Puerta.ifcx', d.ids.project, undefined);
  });

  it('ws.placeAsset on a read-only document only links the file', async () => {
    const { ws, linkAsset, placeAsset } = await libraryDoc(false);
    ws.placeAsset('C:/lib/Puerta.ifcx');
    expect(linkAsset).toHaveBeenCalledWith('C:/lib/Puerta.ifcx');
    expect(placeAsset).not.toHaveBeenCalled();
  });

  it('in {3D} it goes under the project; a double click places it there without a point', async () => {
    const { ws, d, placeAsset, tile } = await libraryDoc();
    ws.show3D();
    fire('dragstart', tile);
    fire('drop', $('.ws-view'));
    fire('dragend', tile);
    expect(placeAsset).toHaveBeenLastCalledWith('C:/lib/Puerta.ifcx', d.ids.project, [4, 5]);
    tile.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(placeAsset).toHaveBeenLastCalledWith('C:/lib/Puerta.ifcx', d.ids.project, undefined);
  });

  it('dropped onto the Layer tab it is only linked; read-only documents only link', async () => {
    const t = await libraryDoc();
    $<HTMLButtonElement>('#ws-ctab-layer').click();
    fire('dragstart', t.tile);
    expect(fire('dragover', $('.ws-layer')).defaultPrevented).toBe(true);
    fire('drop', $('.ws-layer'));
    fire('dragend', t.tile);
    expect(t.linkAsset).toHaveBeenCalledWith('C:/lib/Puerta.ifcx');
    expect(t.placeAsset).not.toHaveBeenCalled();

    const r = await libraryDoc(false);
    r.ws.show3D();
    fire('dragstart', r.tile);
    fire('drop', $('.ws-view'));
    fire('dragend', r.tile);
    expect(r.linkAsset).toHaveBeenCalledWith('C:/lib/Puerta.ifcx');
    expect(r.placeAsset).not.toHaveBeenCalled();
  });

  it('without a document the tiles cannot be dragged', async () => {
    const { ws, tile } = await libraryDoc();
    expect(tile.draggable).toBe(true);
    ws.setComposer(null, { root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() });
    expect($('.ws-library .lib-tile').draggable).toBe(false);
  });
});

describe('paneles plegables', () => {
  const leftRail = () => $('.ws-left').previousElementSibling as HTMLElement;
  const rightRail = () => $('.ws-right').nextElementSibling as HTMLElement;
  const bottomRail = () => $('.ws-library').nextElementSibling as HTMLElement;
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('plegar Properties deja su cabecera y el Browser ocupa el resto', () => {
    mount();
    $<HTMLButtonElement>('.ws-props .ws-panel-fold').click();
    expect($('.ws-props').classList.contains('is-folded')).toBe(true);
    expect($('.ws-props > .splitter')).toBeNull();
    expect($('.ws-left > .splitter').hidden).toBe(true);
    expect($('.ws-browser').classList.contains('is-folded')).toBe(false);
  });

  it('plegar el Browser hace crecer Properties', () => {
    mount();
    $<HTMLButtonElement>('.ws-browser .ws-panel-fold').click();
    expect($('.ws-browser').classList.contains('is-folded')).toBe(true);
    expect($('.ws-props').classList.contains('is-folded')).toBe(false);
  });

  it('cada hueco tiene su riel oculto al arrancar, menos el Asistente', () => {
    const root = document.createElement('div');
    mount({ assistant: { root, open: vi.fn(async () => {}) } });
    expect(leftRail().hidden).toBe(true);
    expect(rightRail().hidden).toBe(true);
    expect(bottomRail().hidden).toBe(true);
    expect(($('.ws-assistant').nextElementSibling as HTMLElement).hidden).toBe(false);
  });

  it('setPaneCollapsed(left) pliega la columna y el riel dice Properties y Project Browser', () => {
    const { ws } = mount();
    ws.setPaneCollapsed('left', true);
    expect(ws.paneCollapsed('left')).toBe(true);
    expect($('.ws-left').classList.contains('is-collapsed')).toBe(true);
    expect(leftRail().textContent).toContain('Properties');
    expect(leftRail().textContent).toContain('Project Browser');
  });

  it('el riel derecho en Model tiene Stage, Layer y References; clic en Layer despliega y abre Layer', () => {
    const { ws } = mount();
    ws.setPaneCollapsed('right', true);
    expect(rightRail().textContent).toContain('Stage');
    expect(rightRail().textContent).toContain('Layer');
    expect(rightRail().textContent).toContain('References');
    [...rightRail().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Layer')!.click();
    expect(ws.paneCollapsed('right')).toBe(false);
    expect($('#ws-ctab-layer').getAttribute('aria-selected')).toBe('true');
  });

  it('en otro modo los rieles toman el aria-label de los paneles visibles', () => {
    const { ws } = mount({ costs: { materials: () => [], saveFile: async () => true, assign: async () => true, confirm: async () => true } });
    ws.setPaneCollapsed('left', true);
    ws.setMode('costs');
    expect(leftRail().textContent).toContain('Cost System');
  });

  it('switching mode with a collapsed slot leaves it collapsed and on reopening it has the size of the mode', () => {
    const { ws } = mount({ schedule: {
      state: () => ({ calendar: { workdays: [1, 2, 3, 4, 5], holidays: [] }, tasks: [] }),
      change: async () => true,
      materials: () => [],
      confirm: async () => true,
    } });
    ws.setPaneCollapsed('bottom', true);
    ws.setMode('schedule');
    expect($('.ws-library').classList.contains('is-collapsed')).toBe(true);
    ws.setPaneCollapsed('bottom', false);
    expect($('.ws-library').style.flex).toBe(`0 0 ${GANTT_HEIGHT}px`);
  });

  it('doble clic en el divisor izquierdo pliega la izquierda', () => {
    const { ws } = mount();
    $('.ws-upper > .splitter-v').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(ws.paneCollapsed('left')).toBe(true);
  });

  it('plegar Properties y Browser pliega la columna izquierda y al reabrirla se ven los dos', () => {
    const { ws } = mount();
    $<HTMLButtonElement>('.ws-props .ws-panel-fold').click();
    $<HTMLButtonElement>('.ws-browser .ws-panel-fold').click();
    expect(ws.paneCollapsed('left')).toBe(true);
    ws.setPaneCollapsed('left', false);
    expect($('.ws-props').classList.contains('is-folded')).toBe(false);
    expect($('.ws-browser').classList.contains('is-folded')).toBe(false);
  });

  it('arranca con el estado guardado y guarda cada cambio', () => {
    saveLayout({ ...DEFAULT_LAYOUT, left: true });
    const { ws } = mount();
    expect(ws.paneCollapsed('left')).toBe(true);
    ws.setPaneCollapsed('right', true);
    expect(loadLayout().right).toBe(true);
  });

  it('Ctrl+F1 minimiza la cinta y se guarda en el layout', () => {
    mount();
    press('F1');
    expect($('.ribbon').classList.contains('is-minimized')).toBe(true);
    expect(loadLayout().ribbon).toBe(true);
  });

  it('Ctrl+B pliega y despliega la izquierda; Ctrl+Alt+B la derecha; Ctrl+J la de abajo', () => {
    const { ws } = mount();
    press('b');
    expect(ws.paneCollapsed('left')).toBe(true);
    press('b');
    expect(ws.paneCollapsed('left')).toBe(false);
    press('b', { altKey: true });
    expect(ws.paneCollapsed('right')).toBe(true);
    press('j');
    expect(ws.paneCollapsed('bottom')).toBe(true);
  });

  it('los atajos no se disparan escribiendo en un input de Properties', () => {
    const { ws } = mount();
    const input = document.createElement('input');
    $('.ws-props').append(input);
    press('b', {}, input);
    press('j', {}, input);
    press('F1', {}, input);
    expect(ws.paneCollapsed('left')).toBe(false);
    expect(ws.paneCollapsed('bottom')).toBe(false);
    expect(loadLayout().ribbon).toBe(false);
  });

  it('Ctrl+Shift+F pliega todo y lo restaura', () => {
    const { ws } = mount({ assistant: { root: document.createElement('div'), open: vi.fn(async () => {}) } });
    ws.setPaneCollapsed('right', true);
    press('F', { shiftKey: true });
    expect(ws.focused).toBe(true);
    for (const pane of ['left', 'right', 'bottom', 'assistant'] as const) expect(ws.paneCollapsed(pane)).toBe(true);
    expect($('.ribbon').classList.contains('is-minimized')).toBe(true);
    press('F', { shiftKey: true });
    expect(ws.focused).toBe(false);
    expect(ws.paneCollapsed('left')).toBe(false);
    expect(ws.paneCollapsed('bottom')).toBe(false);
    expect(ws.paneCollapsed('right')).toBe(true);
    expect($('.ribbon').classList.contains('is-minimized')).toBe(false);
  });

  it('desplegar algo a mano durante el enfoque sale del enfoque sin restaurar', () => {
    const { ws } = mount();
    ws.toggleFocus();
    ws.setPaneCollapsed('left', false);
    expect(ws.focused).toBe(false);
    expect(ws.paneCollapsed('right')).toBe(true);
    expect(ws.paneCollapsed('bottom')).toBe(true);
  });

  it('el enfoque no se guarda: al volver a montar se ve el layout de antes del enfoque', () => {
    const first = mount();
    first.ws.setPaneCollapsed('right', true);
    first.ws.toggleFocus();
    const second = mount();
    expect(second.ws.focused).toBe(false);
    expect(second.ws.paneCollapsed('right')).toBe(true);
    expect(second.ws.paneCollapsed('left')).toBe(false);
    expect(second.ws.paneCollapsed('bottom')).toBe(false);
  });
});

describe('columna del Asistente', () => {
  const fakeAssistant = () => {
    const root = document.createElement('div');
    root.className = 'fake-assistant';
    return { root, open: vi.fn(async () => {}) };
  };
  const ctrlShiftA = (target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true, shiftKey: true, bubbles: true }));

  it('arranca plegada, toggleAssistant la abre y la pliega, y open se llama solo la primera vez', () => {
    const assistant = fakeAssistant();
    const { ws } = mount({ assistant });
    const col = $('.ws-assistant');
    expect(col.classList.contains('is-collapsed')).toBe(true);
    expect(ws.assistantOpen).toBe(false);
    ws.toggleAssistant();
    expect(col.classList.contains('is-collapsed')).toBe(false);
    expect(ws.assistantOpen).toBe(true);
    expect(col.contains(assistant.root)).toBe(true);
    expect(assistant.open).toHaveBeenCalledTimes(1);
    ws.toggleAssistant();
    expect(col.classList.contains('is-collapsed')).toBe(true);
    ws.toggleAssistant();
    expect(assistant.open).toHaveBeenCalledTimes(1);
    ws.toggleAssistant();
    $<HTMLButtonElement>('.ws-assistant + .ws-rail .ws-rail-item').click();
    expect(ws.assistantOpen).toBe(true);
    expect(assistant.open).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Shift+A alterna la columna, pero no mientras se escribe', () => {
    const { ws } = mount({ assistant: fakeAssistant() });
    ctrlShiftA();
    expect(ws.assistantOpen).toBe(true);
    const area = document.createElement('textarea');
    document.body.append(area);
    ctrlShiftA(area);
    expect(ws.assistantOpen).toBe(true);
    ctrlShiftA();
    expect(ws.assistantOpen).toBe(false);
  });

  it('the one-letter shortcuts do not fire from inside the Assistant column', () => {
    const assistant = fakeAssistant();
    const button = document.createElement('button');
    assistant.root.append(button);
    const { ws } = mount({ assistant });
    ws.toggleAssistant();
    key('x', button); // the focus may stay on a panel button: it does not belong to the viewer
    expect(action('xray').getAttribute('aria-pressed')).toBe('false');
    key('x');
    expect(action('xray').getAttribute('aria-pressed')).toBe('true');
  });

  it('sin asistente no hay columna y toggleAssistant no hace nada', () => {
    const { ws } = mount();
    expect(document.querySelector('.ws-assistant')).toBeNull();
    ws.toggleAssistant();
    expect(ws.assistantOpen).toBe(false);
  });
});

describe('ws.agent (lo que el Asistente maneja)', () => {
  const LAYER = (id: string) => ({
    kind: 'file' as const, id, name: `${id}.ifcx`, path: `C:/p/${id}.ifcx`, color: '#fff',
    enabled: true, missing: false, editCount: 0, editsEnabled: true, orphans: [],
  });
  const emptyStage = { root: null, sourceOf: new Map(), colors: new Map(), marks: new Map() };

  it('without a model: model() is null and screenshot() too', () => {
    const { ws } = mount();
    expect(ws.agent.model()).toBeNull();
    expect(ws.agent.screenshot()).toBeNull();
  });

  it('model() y levels() reflejan el modelo abierto', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(ws.agent.model()).toMatchObject({ name: 'hello-wall', root: wall.result.root });
    expect(ws.agent.levels()).toEqual(LEVELS.map((l) => ({ name: l.name, elevation: l.minZ, path: l.path })));
  });

  it('openView opens the plan of the level by its name, the elevations and the 3D view', () => {
    const { ws } = mount();
    ws.setModel(wall);
    ws.agent.openView({ kind: 'plan', level: 'Level 1' });
    expect(activeTab()).toBe('Floor Plan: Level 1');
    ws.agent.openView({ kind: 'elevation', side: 'side' });
    expect(activeTab()).toBe('Elevation: Side');
    ws.agent.openView({ kind: '3d' });
    expect(activeTab()).toBe('{3D}');
    ws.agent.openView({ kind: 'plan', level: null });
    expect(activeTab()).toBe('Floor Plan: Level 1'); // sin nivel: la planta que ya estaba abierta
  });

  it('openView plan sin nivel y sin plantas abiertas abre la del primer nivel', () => {
    const { ws } = mount();
    ws.setModel(wall);
    ws.agent.openView({ kind: 'plan', level: null });
    expect(activeTab()).toBe('Floor Plan: Level 0');
  });

  it('setToggle presses the ribbon button', () => {
    const { ws } = mount();
    ws.setModel(wall);
    ws.agent.setToggle('xray', true);
    expect(action('xray').getAttribute('aria-pressed')).toBe('true');
    ws.agent.setToggle('xray', false);
    expect(action('xray').getAttribute('aria-pressed')).toBe('false');
  });

  it('select y selection', () => {
    const { ws } = mount();
    ws.setModel(wall);
    const path = [...wall.result.byPath.values()].find((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall')!.path;
    ws.agent.select(path);
    expect(ws.agent.selection()).toEqual([path]);
    ws.agent.select(null);
    expect(ws.agent.selection()).toEqual([]);
  });

  it('fit llama al visor con la ruta o con null', () => {
    const { ws, fake } = mount();
    ws.setModel(wall);
    fake.reset();
    ws.agent.fit('/x');
    ws.agent.fit(null);
    expect(fake.named('fit').map((c) => c[1])).toEqual(['/x', null]);
  });

  it('layers() lista las capas y setLayerHidden las oculta', () => {
    const { ws } = mount();
    ws.setModel(wall);
    ws.setComposer([LAYER('1'), LAYER('2'), { kind: 'document', name: 'casa.ifcx', path: 'C:/p/casa.ifcx' }], emptyStage);
    expect(ws.agent.layers()).toEqual([
      { id: '1', name: '1.ifcx', uri: 'C:/p/1.ifcx', enabled: true, hidden: false },
      { id: '2', name: '2.ifcx', uri: 'C:/p/2.ifcx', enabled: true, hidden: false },
    ]);
    expect(ws.agent.setLayerHidden('2', true)).toBe(true);
    expect(ws.agent.layers()[1].hidden).toBe(true);
    expect(ws.agent.setLayerHidden('zz', true)).toBe(false);
  });

  it('screenshot() returns the PNG of the viewer when a view is open', () => {
    const { ws } = mount();
    ws.setModel(wall);
    expect(ws.agent.screenshot()).toBe('data:image/png;base64,');
  });

  it('libraryFolder() sigue la carpeta del panel Library', async () => {
    const { ws } = mount({ library: { chooseFolder: async () => null, list: async () => [], folder: 'C:/lib' } });
    expect(ws.agent.libraryFolder()).toBe('C:/lib');
    await ws.setLibraryFolder('C:/otra');
    expect(ws.agent.libraryFolder()).toBe('C:/otra');
    await ws.setLibraryFolder(null);
    expect(ws.agent.libraryFolder()).toBeNull();
  });
});

describe('columna del Asistente con BuiltBot', () => {
  it('plegar y desplegar no destruye el iframe de BuiltBot', async () => {
    const assistant = mountBuiltBotColumn({ exists: async () => true });
    const { ws } = mount({ assistant });
    ws.toggleAssistant();
    await assistant.open(); // espera a que el primer open termine de crear el iframe
    const frame = document.querySelector('.ws-assistant iframe');
    expect(frame).not.toBeNull();
    ws.toggleAssistant();
    ws.toggleAssistant();
    expect(document.querySelector('.ws-assistant iframe')).toBe(frame);
  });
});


describe('mountWorkspace: modos', () => {
  let modeHost: HTMLElement;
  const mountModes = (extra: Partial<WorkspaceOptions<FakeViewer>> = {}) => {
    const probe = document.createElement('div');
    const m = mount({ modeHost: probe, ...extra });
    document.getElementById('titlebar')!.append(probe);
    modeHost = probe;
    return m;
  };
  const press = (k: string, target: EventTarget = window, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, ...init }));
  const ribbonTab = (label: string) =>
    [...document.querySelectorAll<HTMLElement>('.ribbon-tab')].find((t) => t.textContent === label)!;
  const visibleRibbonTabs = () =>
    [...document.querySelectorAll<HTMLElement>('.ribbon-tabs [role="tab"]')].filter((t) => !t.hidden).map((t) => t.textContent);
  const selectedMode = () => modeHost.querySelector('[aria-selected="true"]')!.textContent;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('it starts in Model, with the mode tabs in their slot', () => {
    const { ws } = mountModes();
    expect(ws.mode).toBe('model');
    expect(selectedMode()).toBe('Model');
    expect(visibleRibbonTabs()).toEqual(['Architecture', 'Structure', 'Insert', 'Annotate', 'View', 'Manage']);
  });

  it('Ctrl+3 switches to Costs without touching model, camera or selection', () => {
    const { ws, fake } = mountModes();
    ws.setModel(wall);
    ws.agent.select(firstElementWithClass(wall.result.root!)!.path);
    fake.calls = [];
    press('3');
    expect(ws.mode).toBe('costs');
    for (const n of ['setModel', 'disposeModel', 'setCameraState', 'view', 'fit']) {
      expect(fake.calls.some((c) => c[0] === n)).toBe(false);
    }
    expect(fake.calls.some((c) => c[0] === 'select' && c[1] === null)).toBe(false);
    expect($('.ws-props').classList.contains('ws-mode-off')).toBe(true);
    expect($('.ws-left .mode-empty h2').textContent).toBe('Costs mode is coming soon');
    expect(visibleRibbonTabs()).toEqual(['Costs']);
    expect(selectedMode()).toBe('Costs');
  });

  it('Ctrl+2 escribiendo en un campo no cambia de modo', () => {
    const { ws } = mountModes();
    const input = document.createElement('input');
    $('.ws-props').append(input);
    press('2', input);
    expect(ws.mode).toBe('model');
  });

  it('Tab solo no cambia de modo', () => {
    const { ws } = mountModes();
    press('Tab', window, { ctrlKey: false });
    expect(ws.mode).toBe('model');
  });

  it('con un boceto de suelo abierto no se cambia de modo', async () => {
    const d = newDocument();
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const storey = [...m.result.byPath.values()].find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    const editor = { addWall: vi.fn(), deleteWall: vi.fn(), deleteFloor: vi.fn(), addFloor: vi.fn(async () => null) };
    const studio = {
      levels: () => d.levels, walls: () => d.walls, floor: () => undefined, wall: () => undefined,
      setFloorConstraints: vi.fn(async () => true), addLevel: vi.fn(async () => d.levels[0].id),
      renameLevel: vi.fn(async () => true), setLevelElevation: vi.fn(async () => true), setWallConstraints: vi.fn(async () => true),
    };
    const { ws, fake } = mountModes({ editor, studio, pickPoint: () => [0, 0] });
    fake.levelsOut = [{ path: storey.path, name: 'Level 1', minZ: 0, maxZ: 3 }];
    ws.setModel(m);
    ws.setEditable(true);
    action('floor').click();
    expect(ws.setMode('materials')).toBe(false);
    expect(ws.mode).toBe('model');
    expect(selectedMode()).toBe('Model');
    expect(document.querySelector('.toast')?.textContent).toContain('Finish or cancel the floor sketch first');
  });

  it('salir de Model con Wall activo cancela la herramienta', () => {
    const { ws } = mountModes({ editor: { addWall: vi.fn(), deleteWall: vi.fn(), addFloor: vi.fn(async () => null), deleteFloor: vi.fn() } });
    ws.setModel(wall);
    ws.setEditable(true);
    action('wall').click();
    expect(action('wall').getAttribute('aria-pressed')).toBe('true');
    ws.setMode('schedule');
    expect(action('wall').getAttribute('aria-pressed')).toBe('false');
  });

  it('round trip keeps X-Ray and the ribbon tab', () => {
    const { ws } = mountModes();
    ribbonTab('View').click();
    action('xray').click();
    ws.setMode('costs');
    ws.setMode('model');
    expect(action('xray').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.ribbon-tab.active')!.textContent).toBe('View');
  });

  it('ida y vuelta conserva el hidden propio de los paneles (Layer elegida)', () => {
    const { ws } = mountModes();
    const layerTab = [...document.querySelectorAll<HTMLElement>('.ws-ctab')].find((t) => t.textContent === 'Layer')!;
    layerTab.click();
    expect($('.ws-stage').hidden).toBe(true);
    ws.setMode('materials');
    ws.setMode('model');
    expect($('.ws-stage').hidden).toBe(true);
    expect($('.ws-layer').hidden).toBe(false);
  });

  it('each document opens in its last mode; Untitled in Model without being saved', () => {
    const { ws } = mountModes();
    ws.setModel({ ...wall, path: 'C:/a.ifcx' });
    ws.setMode('schedule');
    ws.setModel({ ...wall, path: 'C:/b.ifcx' });
    expect(ws.mode).toBe('model');
    ws.setModel({ ...wall, path: 'C:/A.IFCX' });
    expect(ws.mode).toBe('schedule');
    localStorage.clear();
    ws.setModel({ ...wall, path: null });
    expect(ws.mode).toBe('model');
    ws.setMode('costs');
    expect(localStorage.length).toBe(0);
  });
});

describe('mountWorkspace: modo Materials', () => {
  const actions = () => ({
    nodes: vi.fn(() => [{
      path: 'n-C30', def: { name: 'Concrete C30', code: 'C30', color: '#8a8a8a', opacity: 1 },
      source: { role: 'layer' as const, name: 'doc', uri: null, layerId: 'document' }, site: 'document' as const, overridden: [],
    }]),
    setMaterial: vi.fn(async () => true),
    promoteMaterial: vi.fn(async () => true),
    resetMaterial: vi.fn(async () => true),
    duplicateMaterial: vi.fn(async () => null),
    deleteMaterial: vi.fn(async () => true),
    assignMaterial: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
  });
  const mountMat = (a = actions()) => {
    const modeHost = document.createElement('div');
    const m = mount({ modeHost, materials: a });
    document.getElementById('titlebar')!.append(modeHost);
    return { ...m, a };
  };
  const overrides = (fake: FakeViewer) => fake.calls.filter((c) => c[0] === 'setColorOverride').map((c) => c[1]);
  const dropMaterial = (code: string) => {
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['application/x-ifcx-material'], getData: () => code, dropEffect: '' } });
    $('.ws-view').dispatchEvent(ev);
  };

  beforeEach(() => {
    localStorage.clear(); // el modo se recuerda por documento
    vi.clearAllMocks();
  });

  it('entrar pone el Browser, el Editor y Usage en sus huecos y pinta por material; salir quita el color', () => {
    const { ws, fake } = mountMat();
    ws.setModel(wall);
    ws.setMode('materials');
    expect($('.ws-left .mat-browser')).toBeTruthy();
    expect($('.ws-right .mat-editor')).toBeTruthy();
    expect($('.ws-library .mat-usage')).toBeTruthy();
    expect($('.ws-left .mode-empty')).toBeNull();
    expect(overrides(fake).at(-1)).toBeTypeOf('function');
    ws.setMode('model');
    expect(overrides(fake).at(-1)).toBeNull();
    ws.setMode('materials');
    expect(overrides(fake).at(-1)).toBeTypeOf('function');
  });

  it('la cinta de Materials tiene sus botones y Material Colors arranca pulsado', () => {
    const { ws, fake } = mountMat();
    ws.setMode('materials');
    expect(['matNew', 'matAssign', 'matRule', 'matColors'].every((a) => !!action(a))).toBe(true);
    expect(action('matColors').getAttribute('aria-pressed')).toBe('true');
    action('matColors').click();
    expect(overrides(fake).at(-1)).toBeNull();
  });

  it('dropping a material on an element of the viewer assigns it with its edit path', () => {
    const { ws, fake, a } = mountMat();
    ws.setModel(wall);
    ws.setEditable(true);
    ws.setMode('materials');
    const el = firstElementWithClass(wall.result.root!)!;
    fake.pickOut = el.path;
    dropMaterial('C30');
    expect(a.assignMaterial).toHaveBeenCalledWith([editPath(el, wall.result)], 'C30');
  });

  it('soltar fuera del modo Materials no asigna', () => {
    const { ws, fake, a } = mountMat();
    ws.setModel(wall);
    fake.pickOut = firstElementWithClass(wall.result.root!)!.path;
    dropMaterial('C30');
    expect(a.assignMaterial).not.toHaveBeenCalled();
  });

  it('en solo lectura New, Assign to Selection y Assign by Rule van desactivados con NOT_EDITABLE', () => {
    const { ws } = mountMat();
    ws.setMode('materials');
    ws.setEditable(false);
    for (const x of ['matNew', 'matAssign', 'matRule']) {
      expect(action(x).disabled).toBe(true);
      expect(action(x).title).toBe('Only models created in Dream BIM can be edited');
    }
    ws.setEditable(true);
    expect(action('matNew').disabled).toBe(false);
  });

  it('sin acciones de materiales el modo sigue siendo un marcador', () => {
    const { ws } = mountModes0();
    ws.setMode('materials');
    expect($('.ws-left .mode-empty h2').textContent).toBe('Materials mode is coming soon');
  });

  function mountModes0() {
    const modeHost = document.createElement('div');
    const m = mount({ modeHost });
    document.getElementById('titlebar')!.append(modeHost);
    return m;
  }
});

describe('mountWorkspace: modo Costs', () => {
  const actions = () => ({
    materials: vi.fn(() => []),
    saveFile: vi.fn(async () => true),
    assign: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
  });
  const mountCosts = (a = actions()) => {
    const modeHost = document.createElement('div');
    const m = mount({ modeHost, costs: a });
    document.getElementById('titlebar')!.append(modeHost);
    return { ...m, a };
  };
  const overrides = (fake: FakeViewer) => fake.calls.filter((c) => c[0] === 'setColorOverride').map((c) => c[1]);
  const quantityCalls = (fake: FakeViewer) => fake.calls.filter((c) => c[0] === 'quantities').length;

  beforeEach(() => {
    localStorage.clear(); // el modo se recuerda por documento
    vi.clearAllMocks();
  });

  it('entering puts the system tree, Cost and the BOQ in their slots, with the BOQ at 360 px', () => {
    const { ws } = mountCosts();
    ws.setModel(wall);
    ws.setMode('costs');
    expect($('.ws-left .cost-tree')).toBeTruthy();
    expect($('.ws-right .cost-props')).toBeTruthy();
    expect($('.ws-library .cost-boq')).toBeTruthy();
    expect($('.ws-library').style.flex).toBe('0 0 360px');
    expect($('.ws-left .mode-empty')).toBeNull();
    ws.setMode('model');
    expect($('.ws-library').style.flex).toBe('0 0 230px');
  });

  it('a model without a cost system shows the BOQ text', () => {
    const { ws } = mountCosts();
    ws.setModel(wall);
    ws.setMode('costs');
    expect($('.cost-boq .cost-empty').textContent).toContain('no cost system');
  });

  it('la cinta de Costs tiene Edit Item y Color By, y Color By → Off quita el color', () => {
    const { ws, fake } = mountCosts();
    ws.setModel(wall);
    ws.setMode('costs');
    expect(['costEdit', 'costColor'].every((x) => !!action(x))).toBe(true);
    expect(overrides(fake).at(-1)).toBeTypeOf('function');
    action('costColor').click();
    [...document.querySelectorAll<HTMLElement>('.ribbon-menu [role="menuitemradio"]')].find((i) => i.textContent === 'Off')!.click();
    expect(overrides(fake).at(-1)).toBeNull();
    ws.setMode('model');
    expect(overrides(fake).at(-1)).toBeNull();
  });

  it('updateModel con el modo activo vuelve a medir', () => {
    const { ws, fake } = mountCosts();
    ws.setModel(wall);
    ws.setMode('costs');
    const before = quantityCalls(fake);
    ws.updateModel(wall);
    expect(quantityCalls(fake)).toBe(before + 1);
  });

  it('fuera del modo Costs un cambio del modelo no mide', () => {
    const { ws, fake } = mountCosts();
    ws.setModel(wall);
    ws.updateModel(wall);
    expect(quantityCalls(fake)).toBe(0);
  });

  it('in read-only the commands that change something are disabled', () => {
    const { ws } = mountCosts();
    ws.setMode('costs');
    ws.setEditable(false);
    for (const x of ['costEdit', 'costEditSystem', 'costAssign', 'costClearAssign']) {
      expect(action(x).disabled).toBe(true);
      expect(action(x).title).toBe('Only models created in Dream BIM can be edited');
    }
    ws.setEditable(true);
    expect(action('costAssign').disabled).toBe(false);
  });

  it('the viewer accepts the drag of a cost code only in Costs and delivers it to the mode', async () => {
    const { ws, fake } = mountCosts();
    ws.setModel(wall);
    ws.setEditable(true);
    fake.pickOut = firstElementWithClass(wall.result.root!)!.path;
    const over = () => {
      const ev = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { types: ['application/x-ifcx-cost-code'], getData: () => '', dropEffect: '' } });
      $('.ws-view').dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(over()).toBe(false);
    ws.setMode('costs');
    expect(over()).toBe(true);
  });

  it('sin acciones de costos el modo sigue siendo un marcador', () => {
    const modeHost = document.createElement('div');
    const { ws } = mount({ modeHost });
    document.getElementById('titlebar')!.append(modeHost);
    ws.setMode('costs');
    expect($('.ws-left .mode-empty h2').textContent).toBe('Costs mode is coming soon');
  });
});

describe('mountWorkspace: modo Schedule', () => {
  const task = { id: 'tk-1', name: 'Walls', phase: '', start: '2026-11-05', duration: 5, deps: [], rule: { cls: 'IfcWall' }, elements: [] };
  const actions = () => ({
    state: vi.fn(() => ({ calendar: { workdays: [1, 2, 3, 4, 5], holidays: [] }, tasks: [task] })),
    change: vi.fn(async () => true),
    costs: vi.fn(() => ({ currency: 'USD', items: [] })),
    materials: vi.fn(() => []),
    confirm: vi.fn(async () => true),
  });
  const mountSchedule = (a = actions()) => {
    const modeHost = document.createElement('div');
    const m = mount({ modeHost, schedule: a });
    document.getElementById('titlebar')!.append(modeHost);
    return { ...m, a };
  };

  beforeEach(() => {
    localStorage.clear(); // el modo se recuerda por documento
    vi.clearAllMocks();
  });

  it('entering puts phases, Task and the Gantt in their slots and shows the date bar; Model hides it', () => {
    const { ws } = mountSchedule();
    ws.setModel(wall);
    ws.setMode('schedule');
    expect($('.ws-left .sch-phases')).toBeTruthy();
    expect($('.ws-right .sch-task')).toBeTruthy();
    expect($('.ws-library .sch-gantt')).toBeTruthy();
    expect($('.ws-library').style.flex).toBe('0 0 320px');
    expect($('.ws-viewbar .sch-datebar').hidden).toBe(false);
    expect($('.ws-view .sch-date-overlay').hidden).toBe(false); // la fecha va sobre el modelo
    ws.setMode('model');
    expect($('.ws-viewbar .sch-datebar').hidden).toBe(true);
    expect($('.ws-view .sch-date-overlay').hidden).toBe(true);
  });

  it('lo que oculta el 4D se suma a lo oculto en el Stage, y salir lo devuelve', () => {
    const { ws, fake } = mountSchedule();
    ws.setModel(wall);
    const el = firstElementWithClass(wall.result.root!)!;
    fake.quantitiesOut = [{
      element: el.path, name: '', cls: 'IfcWall', storey: 'Level 1', material: '', materialCode: null, box: [0, 0, 0, 1, 1, 1], volume: 1, area: 1,
    }];
    ws.setMode('schedule');
    // the slider starts at the start of the task: the wall is in progress, nothing hidden
    expect(fake.last('setHidden')).toEqual(['setHidden', []]);
    const range = $<HTMLInputElement>('.sch-range');
    expect(range.disabled).toBe(false);
    ws.setMode('model');
    expect(fake.last('setHidden')).toEqual(['setHidden', []]);
    expect(fake.calls.filter((c) => c[0] === 'setColorOverride').at(-1)![1]).toBeNull();
  });

  it('in read-only the buttons that change the schedule are disabled', () => {
    const { ws } = mountSchedule();
    ws.setMode('schedule');
    ws.setEditable(false);
    for (const x of ['schNew', 'schEdit', 'schDelete', 'schLink', 'schByLevel', 'schCalendar']) {
      expect(action(x).disabled).toBe(true);
      expect(action(x).title).toBe('Only models created in Dream BIM can be edited');
    }
    ws.setEditable(true);
    expect(action('schNew').disabled).toBe(false);
  });

  it('updateModel con el modo activo vuelve a calcular', () => {
    const { ws, fake } = mountSchedule();
    ws.setModel(wall);
    ws.setMode('schedule');
    const before = fake.calls.filter((c) => c[0] === 'quantities').length;
    ws.updateModel(wall);
    expect(fake.calls.filter((c) => c[0] === 'quantities').length).toBe(before + 1);
  });

  it('sin acciones de cronograma el modo sigue siendo un marcador', () => {
    const modeHost = document.createElement('div');
    const { ws } = mount({ modeHost });
    document.getElementById('titlebar')!.append(modeHost);
    ws.setMode('schedule');
    expect($('.ws-left .mode-empty h2').textContent).toBe('Schedule mode is coming soon');
  });
});

describe('mountWorkspace: Supr sobre una escalera', () => {
  it('un pelda�o seleccionado borra la escalera entera, no el descanso como suelo', async () => {
    const d = newDocument();
    d.levels.push({ id: 'l2', name: 'Level 2', elevation: 3 });
    d.stairs.push({
      id: 's', baseLevelId: d.levels[0].id, topLevelId: 'l2',
      shape: 'u', origin: [3, 3], angle: 0, width: 1.1, turn: 'left',
    });
    const m = await loadModel('s', null, JSON.stringify(await toIfcx(d, 'x')), offlineFetcher);
    const nodes = [...m.result.byPath.values()];
    const storey = nodes.find((n) => ifcClass(n) === 'IfcBuildingStorey')!;
    const flight = nodes.find((n) => ifcClass(n) === 'IfcStairFlight')!;
    const editor = {
      addWall: vi.fn(), deleteWall: vi.fn(), deleteFloor: vi.fn(), deleteStair: vi.fn(),
      addFloor: vi.fn(async (_b: [number, number][], _l: string): Promise<string | null> => null),
    };
    const studio = {
      levels: () => d.levels,
      walls: () => d.walls,
      floor: (id: string) => d.floors.find((f) => f.id === id),
      stair: (id: string) => stairOf(d, id),
      setFloorConstraints: vi.fn(async () => true),
      wall: (id: string) => d.walls.find((w) => w.id === id),
      addLevel: vi.fn(async () => d.levels[0].id),
      renameLevel: vi.fn(async () => true),
      setLevelElevation: vi.fn(async () => true),
      setWallConstraints: vi.fn(async () => true),
    };
    const ctx = mount({ editor, studio });
    ctx.fake.levelsOut = [{ path: storey.path, name: 'Level 1', minZ: 0, maxZ: 3 }];
    ctx.ws.setModel(m);
    ctx.ws.setEditable(true);
    ctx.fake.onPick(flight.path);
    key('Delete');
    expect(editor.deleteStair).toHaveBeenCalledWith('s');
    expect(editor.deleteFloor).not.toHaveBeenCalled();
    expect(editor.deleteWall).not.toHaveBeenCalled();
  });
});

describe('mountWorkspace: dispose', () => {
  it('dispose removes every global listener', () => {
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    try {
      const { ws } = mount();
      ws.dispose();
      expect(winAdd.mock.calls.length).toBeGreaterThan(0);
      expect(winRemove.mock.calls.length).toBe(winAdd.mock.calls.length);
      expect(docRemove.mock.calls.length).toBe(docAdd.mock.calls.length);
    } finally {
      winAdd.mockRestore();
      winRemove.mockRestore();
      docAdd.mockRestore();
      docRemove.mockRestore();
    }
  });
});
