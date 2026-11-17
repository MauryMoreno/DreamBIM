import { describe, expect, it } from 'vitest';
import { ViewTabs } from '../src/workspace/viewtabs';
import { viewLabel, type ViewRef } from '../src/browser/views';
import type { CameraState } from '../src/render/levels';

const v3d: ViewRef = { kind: '3d' };
const plan0: ViewRef = { kind: 'plan', level: { path: '/p0', name: 'Ground Floor', minZ: 0, maxZ: 3 } };
const plan1: ViewRef = { kind: 'plan', level: { path: '/p1', name: 'Floor 1', minZ: 3, maxZ: 6 } };
const front: ViewRef = { kind: 'elevation', side: 'front' };

const cam = (x: number): CameraState => ({ position: [x, 0, 0], target: [0, 0, 0], fov: 45, projection: 'perspective' });

describe('ViewTabs', () => {
  it('opening {3D} twice leaves a single tab', () => {
    const t = new ViewTabs();
    const a = t.open(v3d);
    const b = t.open({ kind: '3d' });
    expect(a).toBe(b);
    expect(t.list()).toHaveLength(1);
    expect(t.active?.id).toBe(a);
  });

  it('abrir una vista ya abierta la activa', () => {
    const t = new ViewTabs();
    const a = t.open(v3d);
    t.open(plan0);
    expect(t.open(v3d)).toBe(a);
    expect(t.active?.id).toBe(a);
    expect(t.list()).toHaveLength(2);
  });

  it('distingue plantas de niveles distintos', () => {
    const t = new ViewTabs();
    expect(t.open(plan0)).not.toBe(t.open(plan1));
    expect(t.list()).toHaveLength(2);
  });

  it('abrir tres vistas y cerrar la activa (la tercera) deja activa la segunda', () => {
    const t = new ViewTabs();
    t.open(v3d);
    const second = t.open(plan0);
    const third = t.open(front);
    expect(t.active?.id).toBe(third);
    t.close(third);
    expect(t.active?.id).toBe(second);
    expect(t.list().map((x) => x.id)).not.toContain(third);
  });

  it('cerrar la primera activa activa la nueva primera; cerrar una inactiva no cambia la activa', () => {
    const t = new ViewTabs();
    const first = t.open(v3d);
    const second = t.open(plan0);
    const third = t.open(front);
    t.activate(first);
    t.close(first);
    expect(t.active?.id).toBe(second);
    t.close(third);
    expect(t.active?.id).toBe(second);
    t.close(second);
    expect(t.active).toBeNull();
    expect(t.list()).toEqual([]);
  });

  it('saveCamera and then activate on another and back: active.camera is the saved state', () => {
    const t = new ViewTabs();
    const a = t.open(v3d);
    const b = t.open(plan0);
    expect(t.active?.camera).toBeNull();
    t.saveCamera(a, cam(7));
    t.activate(b);
    t.activate(a);
    expect(t.active?.camera).toEqual(cam(7));
    expect(t.active?.view).toEqual(v3d);
  });

  it('el texto de list() usa viewLabel y marca la activa', () => {
    const t = new ViewTabs();
    t.open(v3d);
    t.open(plan0);
    t.open(front);
    expect(t.list()).toEqual([
      { id: expect.any(String), label: viewLabel(v3d), active: false },
      { id: expect.any(String), label: viewLabel(plan0), active: false },
      { id: expect.any(String), label: viewLabel(front), active: true },
    ]);
    expect(t.list()[1].label).toBe('Floor Plan: Ground Floor');
  });

  it('activate y close con un id desconocido no hacen nada', () => {
    const t = new ViewTabs();
    const a = t.open(v3d);
    t.activate('nope');
    t.close('nope');
    t.saveCamera('nope', cam(1));
    expect(t.active?.id).toBe(a);
    expect(t.list()).toHaveLength(1);
  });

  it('clear cierra todas', () => {
    const t = new ViewTabs();
    t.open(v3d);
    t.open(plan0);
    t.clear();
    expect(t.active).toBeNull();
    expect(t.list()).toEqual([]);
  });

  it('refreshLevels actualiza nombre y cotas de las plantas abiertas sin cambiar su id', () => {
    const t = new ViewTabs();
    const id = t.open(plan0);
    t.open(v3d);
    t.refreshLevels([{ path: '/p0', name: 'Ground', minZ: 1, maxZ: 4 }]);
    expect(t.list().find((x) => x.id === id)!.label).toBe('Floor Plan: Ground');
    expect(t.list().map((x) => x.id)).toContain(id);
    t.activate(id);
    expect(t.active!.view).toEqual({ kind: 'plan', level: { path: '/p0', name: 'Ground', minZ: 1, maxZ: 4 } });
    expect(t.list().find((x) => x.label === '{3D}')).toBeDefined();
  });

  it('each view remembers its visual style: by default Hidden Line in plans and Shaded in the rest', () => {
    const t = new ViewTabs();
    const a = t.open(v3d);
    expect(t.active!.style).toBe('shaded');
    const p = t.open(plan0);
    expect(t.active!.style).toBe('hidden');
    t.setStyle(p, 'wireframe');
    t.activate(a);
    t.setStyle(a, 'consistent');
    t.activate(p);
    expect(t.active!.style).toBe('wireframe');
    t.refreshLevels([{ path: '/p0', name: 'Otro', minZ: 0, maxZ: 3 }]);
    expect(t.active!.style).toBe('wireframe');
    t.activate(a);
    expect(t.active!.style).toBe('consistent');
    expect(t.open(front) && t.active!.style).toBe('shaded');
  });
});
