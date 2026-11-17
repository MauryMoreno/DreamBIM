// an over already saved in the file of the pile can also be reset
// documento); editarlo crea un over en el documento y asignarlo escribe `inherits.material`.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

import { DocumentController, type ControllerDeps, type DocWorkspace } from '../src/document/controller';
import { newSession, sessionModel } from '../src/modeling/session';
import type { LoadedModel } from '../src/model/load';
import { openPath } from '../src/model/open';
import { editPath } from '../src/composer/edits';
import { NOT_EDITABLE } from '../src/ribbon/filemenu';
import { hexToRgb, K_DIFFUSE, K_GLTF, K_MATERIAL } from '../src/materials/nodes';
import type { MaterialDef } from '../src/materials/state';

class FakeWs implements DocWorkspace {
  models: LoadedModel[] = [];
  setModel(m: LoadedModel | null) { if (m) this.models.push(m); }
  updateModel(m: LoadedModel) { this.models.push(m); }
  setEditable() {}
  setDirty() {}
  showPlan() {}
  setComposer() {}
}

const LIB = 'C:/b/materiales/lib.ifcx';
const PILOTE = 'C:/b/pil/pilote.ifcx';
const GRAY = [0.62, 0.62, 0.6];
const GREEN_HEX = '#33b34d';

const libText = JSON.stringify({
  header: { id: 'lib', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' },
  imports: [],
  schemas: {},
  data: [
    { path: 'M', attributes: { [K_MATERIAL]: { code: 'Hormigon', uri: '' }, [K_DIFFUSE]: GRAY, 'prj::material::densidad': 2500 } },
    { path: 'G', attributes: { [K_MATERIAL]: { code: 'Glass' }, [K_DIFFUSE]: [0.6, 0.8, 0.9], 'bsi::ifc::presentation::opacity': 0.4 } },
  ],
});
const wall = { 'bsi::ifc::class': { code: 'IfcWall' } };
const piloteText = JSON.stringify({
  header: { id: 'p', ifcxVersion: 'ifcx_alpha', dataVersion: '1', author: 'x', timestamp: 't' },
  imports: [{ uri: '../materiales/lib.ifcx' }],
  schemas: {},
  data: [
    { path: 'P', children: { e1: 'E1', e2: 'E2' }, attributes: { 'bsi::ifc::class': { code: 'IfcProject' } } },
    { path: 'E1', inherits: { material: 'M' }, attributes: wall },
    { path: 'E2', attributes: { ...wall, [K_MATERIAL]: { code: 'Old' } } },
  ],
});

/** it rejects a repeated code, an empty name and an invalid color or opacity, changing nothing */
async function openPilote(extra: Record<string, string> = {}, readOnly = false, pilote = piloteText) {
  const disk = new Map<string, string>([[LIB, libText], [PILOTE, pilote], ...Object.entries(extra)]);
  tauri.invoke.mockImplementation(async (cmd: string, a: { path: string; contents: string }) => {
    if (cmd === 'read_text_file') {
      const t = disk.get(a.path);
      if (t === undefined) throw new Error(`not found: ${a.path}`);
      return t;
    }
    if (cmd === 'write_text_file') disk.set(a.path, a.contents);
  });
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => PILOTE),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (p: string) => {
      const t = disk.get(p);
      if (t === undefined) throw new Error(`not found: ${p}`);
      return t;
    }),
    writeText: vi.fn(async (p: string, t: string) => void disk.set(p, t)),
    exists: vi.fn(async (p: string) => disk.has(p)),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  const ctrl = new DocumentController(deps);
  const { model, session } = await openPath(PILOTE);
  await ctrl.opened(model, readOnly ? null : session);
  const shown = () => ws.models.at(-1)!;
  /** Atributos compuestos de un elemento del pilote. */
  const attrs = (origin: string) => shown().result.byOrigin.get(origin)![0].attributes;
  const nodeOf = (code: string) => ctrl.materialNodes.find((n) => n.def.code === code)!;
  return { ctrl, ws, deps, disk, session, shown, attrs, nodeOf };
}

beforeEach(() => {
  vi.clearAllMocks();
  tauri.invoke.mockResolvedValue(undefined);
});

describe('materiales por referencia: leer', () => {
  it('lista los materiales de la biblioteca importada, sin sobrescrituras', async () => {
    const t = await openPilote();
    expect(t.ctrl.materialNodes.map((n) => [n.def.code, n.site, n.overridden])).toEqual([
      ['Glass', 'library', []],
      ['Hormigon', 'library', []],
    ]);
    expect(t.nodeOf('Hormigon').source.location).toContain('materiales/lib.ifcx');
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
  });
});

describe('materiales por referencia: editar crea un over', () => {
  it('cambiar el color escribe un over en el documento y deja la biblioteca sin tocar', async () => {
    const t = await openPilote();
    const def = t.nodeOf('Hormigon').def;
    expect(await t.ctrl.setMaterial('Hormigon', { ...def, color: GREEN_HEX })).toBe(true);
    expect(t.ctrl.history.undo).toBe('Change Material');
    expect(t.nodeOf('Hormigon').overridden).toEqual([K_DIFFUSE]);
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
    expect(t.session!.dirty).toBe(true);
    expect(t.disk.get(LIB)).toBe(libText);

    expect(await t.ctrl.save()).toBe(true);
    expect(t.disk.get(LIB)).toBe(libText);
    const saved = JSON.parse(t.disk.get(PILOTE)!);
    expect(saved.data.find((n: { path: string }) => n.path === 'M').attributes[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
  });

  it('Reset quita el over y vuelve el valor de la biblioteca; sin over no hace nada', async () => {
    const t = await openPilote();
    expect(await t.ctrl.resetMaterial('Hormigon')).toBe(false);
    await t.ctrl.setMaterial('Hormigon', { ...t.nodeOf('Hormigon').def, color: GREEN_HEX, opacity: 0.5 });
    expect(await t.ctrl.resetMaterial('Hormigon')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Reset Material');
    expect(t.nodeOf('Hormigon').overridden).toEqual([]);
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
  });

  it('a material the model brings without a node is assigned as a code', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', { ...t.nodeOf('Hormigon').def, color: GREEN_HEX });
    await t.ctrl.save();
    expect(t.nodeOf('Hormigon').overridden).toEqual([K_DIFFUSE]);
    expect(await t.ctrl.resetMaterial('Hormigon')).toBe(true);
    expect(t.nodeOf('Hormigon').overridden).toEqual([]);
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
    await t.ctrl.undo();
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
  });

  it('deshacer devuelve el color anterior y el documento queda sin cambios', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', { ...t.nodeOf('Hormigon').def, color: GREEN_HEX });
    await t.ctrl.undo();
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
    expect(t.session!.dirty).toBe(false);
  });

  it('un cambio que no cambia nada no apila ni marca cambios', async () => {
    const t = await openPilote();
    expect(await t.ctrl.setMaterial('Hormigon', t.nodeOf('Hormigon').def)).toBe(true);
    expect(t.ctrl.history.undo).toBeNull();
    expect(t.session!.dirty).toBe(false);
  });

  it('on save the old file is left empty, and without saving or with Save As it is not touched', async () => {
    const t = await openPilote();
    const def = t.nodeOf('Hormigon').def;
    expect(await t.ctrl.setMaterial('Hormigon', { ...def, code: 'Glass' })).toBe(false);
    expect(t.deps.toast).toHaveBeenLastCalledWith('A material with code Glass already exists', 'info');
    expect(await t.ctrl.setMaterial('Hormigon', { ...def, name: '  ' })).toBe(false);
    expect(t.deps.toast).toHaveBeenLastCalledWith('A material needs a name and a code', 'info');
    expect(await t.ctrl.setMaterial('Hormigon', { ...def, color: 'rojo' })).toBe(false);
    expect(await t.ctrl.setMaterial('Hormigon', { ...def, opacity: 2 })).toBe(false);
    expect(t.deps.toast).toHaveBeenLastCalledWith('Enter a valid color and opacity', 'info');
    expect(t.ctrl.history.undo).toBeNull();
  });
});

describe('materiales por referencia: asignar', () => {
  it('asignar un material de nodo escribe inherits y le gana al material propio del elemento', async () => {
    const t = await openPilote();
    expect(await t.ctrl.assignMaterial(['E2'], 'Glass')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Assign Material');
    expect((t.attrs('E2')[K_MATERIAL] as { code: string }).code).toBe('Glass');
    expect(t.attrs('E2')[K_DIFFUSE]).toEqual([0.6, 0.8, 0.9]);
    await t.ctrl.undo();
    expect((t.attrs('E2')[K_MATERIAL] as { code: string }).code).toBe('Old');
    expect(t.session!.dirty).toBe(false);
  });

  it('quitar el material deja el elemento sin material ni color heredado', async () => {
    const t = await openPilote();
    expect(await t.ctrl.assignMaterial(['E1'], null)).toBe(true);
    expect(t.attrs('E1')[K_MATERIAL]).toBeUndefined();
    expect(t.attrs('E1')[K_DIFFUSE]).toBeUndefined();
  });

  it('Save writes the new library and the document that imports it, and no auxiliary file', async () => {
    const t = await openPilote();
    expect(await t.ctrl.assignMaterial(['E1'], 'Old')).toBe(true);
    expect((t.attrs('E1')[K_MATERIAL] as { code: string }).code).toBe('Old');
    expect(t.attrs('E1')[K_DIFFUSE]).toBeUndefined();
  });

  it('asignar lo que el elemento ya tiene no apila ni marca cambios', async () => {
    const t = await openPilote();
    expect(await t.ctrl.assignMaterial(['E1'], 'Hormigon')).toBe(true);
    expect(t.ctrl.history.undo).toBeNull();
    expect(t.session!.dirty).toBe(false);
  });

  it('en solo lectura avisa y no cambia nada', async () => {
    const t = await openPilote({}, true);
    expect(await t.ctrl.assignMaterial(['E1'], 'Glass')).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith(NOT_EDITABLE, 'info');
  });
});

describe('materiales por referencia: archivo auxiliar de versiones anteriores', () => {
  const legacy = JSON.stringify({
    header: { id: 'studio-materials/pilote', ifcxVersion: '', dataVersion: '', author: '', timestamp: '' },
    imports: [],
    schemas: {},
    data: [
      { path: 'studio-material-Glass', attributes: { 'studio::material::def': { name: 'Glass', code: 'Glass', color: '#a53175', opacity: 0.5 } } },
      { path: 'E2', attributes: { [K_MATERIAL]: { code: 'Glass' } } },
    ],
  });

  it('convierte sus asignaciones en inherits, ignora sus colores, avisa y deja el documento con cambios', async () => {
    const t = await openPilote({ 'C:/b/pil/pilote.materials.ifcx': legacy });
    expect((t.attrs('E2')[K_MATERIAL] as { code: string }).code).toBe('Glass');
    expect(t.attrs('E2')[K_DIFFUSE]).toEqual([0.6, 0.8, 0.9]);
    expect(t.nodeOf('Glass').def.color).not.toBe('#a53175');
    expect(t.session!.dirty).toBe(true);
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Converted 1 material assignment'), 'info');
  });

  it('without a path there is nowhere to create the library: it warns and changes nothing', async () => {
    const side = 'C:/b/pil/pilote.materials.ifcx';
    const t = await openPilote({ [side]: legacy });
    expect(JSON.parse(t.disk.get(side)!).data).toHaveLength(2);
    expect(await t.ctrl.save()).toBe(true);
    expect(JSON.parse(t.disk.get(side)!).data).toEqual([]);

    const u = await openPilote({ [side]: legacy });
    u.deps.pickSavePath.mockResolvedValue('C:/b/otro/nuevo.ifcx');
    expect(await u.ctrl.saveAs()).toBe(true);
    expect(JSON.parse(u.disk.get(side)!).data).toHaveLength(2);
  });

  it('un archivo roto avisa y se abre igual', async () => {
    const t = await openPilote({ 'C:/b/pil/pilote.materials.ifcx': '{ roto' });
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Could not read pilote.materials.ifcx'), 'error');
    expect(t.ctrl.hasDocument).toBe(true);
  });
});

/** Documento de Studio con dos muros, abierto desde disco. */
async function openDoc() {
  const s = newSession();
  s.path = 'C:/p/casa.ifcx';
  const lvl = s.doc.levels[0].id;
  s.addWall([0, 0], [4, 0], lvl);
  s.addWall([0, 4], [4, 4], lvl);
  s.dirty = false;
  const model = await sessionModel(s);
  const walls = [...model.result.byPath.values()]
    .filter((n) => (n.attributes['bsi::ifc::class'] as { code?: string } | undefined)?.code === 'IfcWall')
    .map((n) => editPath(n, model.result));
  const ws = new FakeWs();
  const deps = {
    ws,
    pickSavePath: vi.fn(async () => 'D:/otro/Nuevo.ifcx'),
    askSaveChanges: vi.fn(async () => 'save' as const),
    toast: vi.fn(),
    remember: vi.fn(async () => {}),
    buildModel: sessionModel,
    readText: vi.fn(async (p: string): Promise<string> => { throw new Error(`not found: ${p}`); }),
    writeText: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    confirm: vi.fn(async () => true),
  } satisfies ControllerDeps;
  const ctrl = new DocumentController(deps);
  vi.spyOn(s, 'saveTo').mockResolvedValue(undefined);
  await ctrl.opened(model, s);
  const attrs = (origin: string) => ws.models.at(-1)!.result.byOrigin.get(origin)![0].attributes;
  return { ctrl, ws, deps, s, walls, attrs };
}

const C30: MaterialDef = { name: 'Concrete C30', code: 'C30', color: '#8a8a8a', opacity: 1 };

describe('materiales por referencia: documento de Studio', () => {
  it('un material nuevo nace en una biblioteca junto al documento y asignarlo escribe inherits en su capa over', async () => {
    const t = await openDoc();
    expect(await t.ctrl.setMaterial(null, C30)).toBe(true);
    expect(t.ctrl.history.undo).toBe('New Material');
    expect(t.ctrl.materialNodes.map((n) => [n.def.code, n.site])).toEqual([['C30', 'library']]);
    expect(t.s.doc.imports).toEqual(['materiales.ifcx']);
    expect(await t.ctrl.assignMaterial([t.walls[0]], 'C30')).toBe(true);
    expect((t.attrs(t.walls[0])[K_MATERIAL] as { code: string }).code).toBe('C30');
    expect(t.attrs(t.walls[0])[K_DIFFUSE]).toEqual(hexToRgb('#8a8a8a'));
    expect(t.attrs(t.walls[1])[K_MATERIAL]).toBeUndefined();
    expect(t.s.doc.overs.some((n) => n.path === t.walls[0] && n.inherits?.material)).toBe(true);
  });

  it('duplicar da un code libre y borrar quita el nodo y sus asignaciones en un paso; deshacer los devuelve', async () => {
    const t = await openDoc();
    await t.ctrl.setMaterial(null, C30);
    await t.ctrl.assignMaterial([t.walls[0]], 'C30');
    expect(await t.ctrl.duplicateMaterial('C30')).toBe('C30-copy');
    expect(await t.ctrl.duplicateMaterial('C30')).toBe('C30-copy-2');
    expect(t.ctrl.materialNodes.find((n) => n.def.code === 'C30-copy')!.def.name).toBe('Concrete C30 copy');
    expect(await t.ctrl.duplicateMaterial('NO')).toBeNull();
    expect(await t.ctrl.deleteMaterial('C30')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Delete Material');
    expect(t.ctrl.materialNodes.map((n) => n.def.code)).toEqual(['C30-copy', 'C30-copy-2']);
    expect(t.attrs(t.walls[0])[K_MATERIAL]).toBeUndefined();
    await t.ctrl.undo();
    expect((t.attrs(t.walls[0])[K_MATERIAL] as { code: string }).code).toBe('C30');
  });

  it('the model stays whole after saving without rewriting it', async () => {
    const t = await openDoc();
    await t.ctrl.setMaterial(null, C30);
    expect(await t.ctrl.save()).toBe(true);
    expect(t.s.saveTo).toHaveBeenCalledTimes(1);
    expect(t.deps.writeText).toHaveBeenCalledTimes(1);
    expect(t.deps.writeText).toHaveBeenCalledWith('C:/p/materiales.ifcx', expect.any(String));
    const lib = JSON.parse((t.deps.writeText.mock.calls[0] as unknown as [string, string])[1]);
    expect(lib.data[0].attributes[K_MATERIAL]).toEqual({ code: 'C30' });
  });

  it('undoing after promoting and saving returns the over, and the next Save restores the library', async () => {
    const t = await openDoc();
    t.s.path = null;
    expect(await t.ctrl.setMaterial(null, C30)).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith('Save the model before creating a material library', 'info');
    expect(t.ctrl.history.undo).toBeNull();
  });
});

const green = (def: MaterialDef): MaterialDef => ({ ...def, color: GREEN_HEX });
const libOnDisk = (t: { disk: Map<string, string> }) => JSON.parse(t.disk.get(LIB)!);
const libNode = (lib: { data: { path: string; attributes?: Record<string, unknown> }[] }, path: string) => lib.data.find((n) => n.path === path);

describe('materiales por referencia: Change in library', () => {
  it('promover el over lleva el valor a la biblioteca, quita el over y escribe solo la biblioteca al guardar', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', green(t.nodeOf('Hormigon').def));
    expect(await t.ctrl.promoteMaterial('Hormigon')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Change Material in Library');
    expect(t.nodeOf('Hormigon').overridden).toEqual([]);
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
    expect(t.disk.get(LIB)).toBe(libText);

    expect(await t.ctrl.save()).toBe(true);
    expect(libNode(libOnDisk(t), 'M')!.attributes![K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
    expect(libNode(libOnDisk(t), 'M')!.attributes!['prj::material::densidad']).toBe(2500);
    expect(t.disk.get(PILOTE)).toBe(piloteText);
    expect(t.session!.dirty).toBe(false);
    // undoing beyond the first change of the library, already saved, also restores the file
    expect(t.shown().warnings.some((w) => w.startsWith('File not found'))).toBe(false);
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
  });

  it('sin over no hace nada; en una biblioteca de solo lectura avisa', async () => {
    const t = await openPilote();
    expect(await t.ctrl.promoteMaterial('Hormigon')).toBe(false);
    expect(t.ctrl.history.undo).toBeNull();

    const remote = piloteText.replace('../materiales/lib.ifcx', 'https://example.org/lib.ifcx');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => libText })));
    const r = await openPilote({}, false, remote);
    expect(r.nodeOf('Hormigon').site).toBe('readonly');
    await r.ctrl.setMaterial('Hormigon', green(r.nodeOf('Hormigon').def));
    expect(await r.ctrl.promoteMaterial('Hormigon')).toBe(false);
    expect(r.deps.toast).toHaveBeenLastCalledWith('This material comes from a file Dream BIM cannot write', 'info');
    vi.unstubAllGlobals();
  });

  it('editing a material the model brings only as a code creates its node and the elements inherit it', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', green(t.nodeOf('Hormigon').def));
    await t.ctrl.promoteMaterial('Hormigon');
    await t.ctrl.save();
    expect(libNode(libOnDisk(t), 'M')!.attributes![K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));

    expect(await t.ctrl.undo()).toBe(true);
    expect(t.nodeOf('Hormigon').overridden).toEqual([K_DIFFUSE]);
    expect(t.session!.dirty).toBe(true);
    expect(await t.ctrl.save()).toBe(true);
    expect(libOnDisk(t)).toEqual(JSON.parse(libText));
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
  });

  it('deleting a material from the library removes it from the file and from the elements; undoing returns them', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', green(t.nodeOf('Hormigon').def));
    await t.ctrl.promoteMaterial('Hormigon');
    await t.ctrl.save();
    await t.ctrl.undo();
    await t.ctrl.undo();
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
    expect(t.session!.dirty).toBe(true);
    expect(await t.ctrl.save()).toBe(true);
    expect(libOnDisk(t)).toEqual(JSON.parse(libText));
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
  });

  it('si falla la escritura de la biblioteca avisa, el documento sigue con cambios y Save devuelve false', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', green(t.nodeOf('Hormigon').def));
    await t.ctrl.promoteMaterial('Hormigon');
    t.deps.writeText.mockRejectedValueOnce(new Error('disco lleno'));
    expect(await t.ctrl.save()).toBe(false);
    expect(t.deps.toast).toHaveBeenCalledWith(expect.stringContaining('Could not save lib.ifcx'), 'error');
    expect(t.session!.dirty).toBe(true);
    expect(await t.ctrl.save()).toBe(true);
    expect(libNode(libOnDisk(t), 'M')!.attributes![K_DIFFUSE]).toEqual(hexToRgb(GREEN_HEX));
  });
});

describe('materiales por referencia: crear, duplicar y borrar en la biblioteca', () => {
  const BRICK: MaterialDef = { name: 'Brick', code: 'BRICK', color: '#aa5533', opacity: 1, density: 1800 };

  it('un material nuevo nace en la biblioteca que el modelo ya importa', async () => {
    const t = await openPilote();
    expect(await t.ctrl.setMaterial(null, BRICK)).toBe(true);
    expect(t.nodeOf('BRICK').site).toBe('library');
    expect(t.nodeOf('BRICK').source.location).toContain('materiales/lib.ifcx');
    await t.ctrl.save();
    const node = libOnDisk(t).data.find((n: { attributes?: Record<string, unknown> }) => (n.attributes?.[K_MATERIAL] as { code?: string })?.code === 'BRICK');
    expect(node.attributes[K_DIFFUSE]).toEqual(hexToRgb('#aa5533'));
    expect(node.attributes['prj::material::densidad']).toBe(1800);
    expect(libOnDisk(t).schemas['prj::material::densidad']).toBeDefined();
  });

  it('sin biblioteca importada crea materiales.ifcx junto al modelo y lo importa', async () => {
    const bare = JSON.stringify({ ...JSON.parse(piloteText), imports: [] });
    const t = await openPilote({}, false, bare);
    expect(await t.ctrl.setMaterial(null, BRICK)).toBe(true);
    expect(await t.ctrl.save()).toBe(true);
    expect(t.disk.has('C:/b/pil/materiales.ifcx')).toBe(true);
    expect(JSON.parse(t.disk.get(PILOTE)!).imports.map((i: { uri: string }) => i.uri)).toContain('materiales.ifcx');
    expect(t.nodeOf('BRICK').site).toBe('library');
  });

  it('si materiales.ifcx ya existe junto al modelo sin importarse no lo pisa', async () => {
    const bare = JSON.stringify({ ...JSON.parse(piloteText), imports: [] });
    const t = await openPilote({ 'C:/b/pil/materiales.ifcx': libText }, false, bare);
    await t.ctrl.setMaterial(null, BRICK);
    await t.ctrl.save();
    expect(t.disk.get('C:/b/pil/materiales.ifcx')).toBe(libText);
    expect(t.disk.has('C:/b/pil/materiales-2.ifcx')).toBe(true);
  });

  it('giving it a texture creates an over the element inherits, with the repeat per meter', async () => {
    const t = await openPilote();
    expect(await t.ctrl.setMaterial('Old', { name: 'Old', code: 'Old', color: '#aa5533', opacity: 1 })).toBe(true);
    expect(t.nodeOf('Old').site).toBe('library');
    expect(t.attrs('E2')[K_DIFFUSE]).toEqual(hexToRgb('#aa5533'));
    expect((t.attrs('E2')[K_MATERIAL] as { code: string }).code).toBe('Old');
  });

  it('duplicar crea el nodo copia en la biblioteca con un code libre', async () => {
    const t = await openPilote();
    expect(await t.ctrl.duplicateMaterial('Hormigon')).toBe('Hormigon-copy');
    expect(await t.ctrl.duplicateMaterial('Hormigon')).toBe('Hormigon-copy-2');
    expect(t.nodeOf('Hormigon-copy').def.name).toBe('Hormigon copy');
    expect(t.nodeOf('Hormigon-copy').site).toBe('library');
    expect(await t.ctrl.duplicateMaterial('NO')).toBeNull();
  });

  it('removing it deletes gltf::material from the element, and when taking it to the library also from its file', async () => {
    const t = await openPilote();
    await t.ctrl.assignMaterial(['E2'], 'Glass');
    expect(await t.ctrl.deleteMaterial('Glass')).toBe(true);
    expect(t.ctrl.history.undo).toBe('Delete Material');
    expect(t.ctrl.materialNodes.map((n) => n.def.code)).toEqual(['Hormigon']);
    expect(t.attrs('E2')[K_MATERIAL]).toBeUndefined();
    await t.ctrl.save();
    expect(libNode(libOnDisk(t), 'G')).toBeUndefined();
    expect(libNode(libOnDisk(t), 'M')).toBeDefined();

    await t.ctrl.undo();
    expect(t.ctrl.materialNodes.map((n) => n.def.code)).toEqual(['Glass', 'Hormigon']);
    expect((t.attrs('E2')[K_MATERIAL] as { code: string }).code).toBe('Glass');
    expect(await t.ctrl.save()).toBe(true);
    expect(libNode(libOnDisk(t), 'G')).toBeDefined();
  });
});

describe('materiales por referencia: texturas', () => {
  const IMG = 'data:image/jpeg;base64,AAAA';
  const textured = (def: MaterialDef, width = 2, height = 0.5): MaterialDef => ({ ...def, texture: { image: IMG, width, height } });
  const gltf = (a: Record<string, unknown>) => a[K_GLTF] as { pbrMetallicRoughness: { baseColorTexture: string }; extensions: { KHR_texture_transform: { scale: number[] } } } | undefined;

  it('changing the size of a library texture replaces its whole gltf (what Studio does not edit is lost)', async () => {
    const t = await openPilote();
    expect(await t.ctrl.setMaterial('Hormigon', textured(t.nodeOf('Hormigon').def))).toBe(true);
    expect(t.nodeOf('Hormigon').overridden).toEqual([K_GLTF]);
    expect(t.nodeOf('Hormigon').def.texture).toEqual({ image: IMG, width: 2, height: 0.5 });
    expect(gltf(t.attrs('E1'))!.pbrMetallicRoughness.baseColorTexture).toBe(IMG);
    expect(gltf(t.attrs('E1'))!.extensions.KHR_texture_transform.scale).toEqual([0.5, 2]);
    expect(t.disk.get(LIB)).toBe(libText);
  });

  it('Change in library escribe la textura en el archivo de la biblioteca', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', textured(t.nodeOf('Hormigon').def));
    expect(await t.ctrl.promoteMaterial('Hormigon')).toBe(true);
    expect(t.nodeOf('Hormigon').overridden).toEqual([]);
    expect(await t.ctrl.save()).toBe(true);
    expect(libNode(libOnDisk(t), 'M')!.attributes![K_GLTF]).toEqual(gltf(t.attrs('E1')));
    expect(t.attrs('E1')[K_DIFFUSE]).toEqual(GRAY);
  });

  it('Controller: placing library pieces and deleting them in a single undo step.', async () => {
    const t = await openPilote();
    await t.ctrl.setMaterial('Hormigon', textured(t.nodeOf('Hormigon').def));
    await t.ctrl.promoteMaterial('Hormigon');
    await t.ctrl.setMaterial('Hormigon', { ...t.nodeOf('Hormigon').def, texture: undefined });
    expect(t.attrs('E1')[K_GLTF]).toBeUndefined();
    await t.ctrl.promoteMaterial('Hormigon');
    await t.ctrl.save();
    expect(libNode(libOnDisk(t), 'M')!.attributes![K_GLTF]).toBeUndefined();
    expect(t.attrs('E1')[K_GLTF]).toBeUndefined();
  });

  it('it places two doors of the same file: one layer, two placements, one step', async () => {
    const withNormal = JSON.parse(libText);
    withNormal.data[0].attributes[K_GLTF] = {
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9, baseColorTexture: IMG },
      normalTexture: { texture: 'data:image/jpeg;base64,BBBB', scale: 1 },
      extensions: { KHR_texture_transform: { scale: [1, 1] } },
    };
    const t = await openPilote({ [LIB]: JSON.stringify(withNormal) });
    expect(t.nodeOf('Hormigon').def.texture).toEqual({ image: IMG, width: 1, height: 1 });
    await t.ctrl.setMaterial('Hormigon', textured(t.nodeOf('Hormigon').def, 4, 4));
    expect((t.attrs('E1')[K_GLTF] as Record<string, unknown>).normalTexture).toBeUndefined();
    expect(gltf(t.attrs('E1'))!.extensions.KHR_texture_transform.scale).toEqual([0.25, 0.25]);
  });

  it('cambiar solo el color de un material con textura no toca su gltf', async () => {
    const withNormal = JSON.parse(libText);
    withNormal.data[0].attributes[K_GLTF] = {
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9, baseColorTexture: IMG },
      normalTexture: { texture: 'data:image/jpeg;base64,BBBB', scale: 1 },
    };
    const t = await openPilote({ [LIB]: JSON.stringify(withNormal) });
    await t.ctrl.setMaterial('Hormigon', { ...t.nodeOf('Hormigon').def, color: GREEN_HEX });
    expect(t.nodeOf('Hormigon').overridden).toEqual([K_DIFFUSE]);
    expect((t.attrs('E1')[K_GLTF] as Record<string, unknown>).normalTexture).toBeDefined();
  });
});
