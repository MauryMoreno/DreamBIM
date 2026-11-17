import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_SKETCH_TAB, RIBBON, type RibbonTab, type ViewAction } from '../src/ribbon/definition';
import { mountRibbon } from '../src/ribbon/ribbon';
import { mountFileMenu } from '../src/ribbon/filemenu';
import { getThemePref, initTheme, setThemePref } from '../src/shell/theme';
import type { RecentEntry } from '../src/home/recents';

const ALL_ACTIONS: ViewAction[] = [
  'view3d', 'plan', 'front', 'side', 'fit', 'xray', 'section', 'shadows', 'grid', 'levels', 'lod', 'walk', 'screenshot',
];

const tab = (id: string) => RIBBON.find((t) => t.id === id)!;
const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

function mount() {
  document.body.innerHTML = '<div id="ribbon"></div>';
  const el = document.getElementById('ribbon') as HTMLElement;
  const onAction = vi.fn();
  const api = mountRibbon(el, onAction);
  return { el, onAction, api };
}

const btn = (el: HTMLElement, action: string) => el.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;
const tabBtn = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === label)!;

describe('ribbon definition', () => {
  it('the tabs are exactly those of Revit, without File', () => {
    expect(labels(RIBBON)).toEqual(['Architecture', 'Structure', 'Insert', 'Annotate', 'View', 'Manage']);
    expect(RIBBON.map((t) => t.id)).toEqual(['arquitectura', 'estructura', 'insertar', 'anotar', 'vista', 'gestionar']);
  });

  it('Architecture has its groups and only Wall, Floor and Level with an action', () => {
    const arq = tab('arquitectura');
    const group = (name: string) => arq.groups.find((g) => g.label === name)!;
    expect(labels(group('Build').buttons)).toEqual(['Wall', 'Door', 'Window', 'Floor', 'Roof', 'Column']);
    expect(group('Circulation')).toBeDefined();
    expect(labels(group('Datum').buttons)).toEqual(['Level', 'Grid']);
    expect(labels(group('Modify').buttons)).toEqual(['Move', 'Copy', 'Rotate']);
    const withAction = arq.groups.flatMap((g) => g.buttons).filter((b) => b.action);
    expect(withAction.map((b) => [b.id, b.action, b.toggle])).toEqual([
      ['arq-muro', 'wall', true],
      ['arq-suelo', 'floor', true],
      ['arq-nivel', 'level', undefined],
    ]);
  });

  it('solo Vista tiene acciones y cubre las 12', () => {
    for (const t of RIBBON.filter((t) => !['vista', 'arquitectura', 'estructura'].includes(t.id))) {
      expect(t.groups.flatMap((g) => g.buttons).some((b) => b.action)).toBe(false);
    }
    expect(tab('estructura').groups.flatMap((g) => g.buttons).filter((b) => b.action).map((b) => b.action)).toEqual(['level']);
    const actions = tab('vista').groups.flatMap((g) => g.buttons).map((b) => b.action);
    expect([...actions].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it('the button and tab ids are unique', () => {
    const ids = RIBBON.flatMap((t) => t.groups.flatMap((g) => g.buttons.map((b) => b.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mountRibbon', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('it disables every button without an action with the "Coming soon" notice', () => {
    const { el } = mount();
    const inert = [...el.querySelectorAll<HTMLButtonElement>('button.ribbon-btn')].filter((b) => !b.dataset.action);
    expect(inert.length).toBeGreaterThan(10);
    for (const b of inert) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe('Coming soon');
    }
    for (const a of ALL_ACTIONS) expect(btn(el, a).disabled).toBe(false);
  });

  it('pressing a View button calls onAction with its action', () => {
    const { el, onAction } = mount();
    btn(el, 'fit').click();
    expect(onAction).toHaveBeenLastCalledWith('fit', false);
    btn(el, 'plan').click();
    expect(onAction).toHaveBeenLastCalledWith('plan', false);
    expect(btn(el, 'fit').hasAttribute('aria-pressed')).toBe(false);
  });

  it('los botones toggle alternan aria-pressed y lo informan', () => {
    const { el, onAction } = mount();
    const xray = btn(el, 'xray');
    expect(xray.getAttribute('aria-pressed')).toBe('false');
    xray.click();
    expect(xray.getAttribute('aria-pressed')).toBe('true');
    expect(xray.classList.contains('pressed')).toBe(true);
    expect(onAction).toHaveBeenLastCalledWith('xray', true);
    xray.click();
    expect(xray.getAttribute('aria-pressed')).toBe('false');
    expect(onAction).toHaveBeenLastCalledWith('xray', false);
    for (const a of ['section', 'shadows', 'grid', 'walk']) {
      expect(btn(el, a).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('setPressed actualiza el estado sin disparar onAction', () => {
    const { el, onAction, api } = mount();
    api.setPressed('grid', true);
    expect(btn(el, 'grid').getAttribute('aria-pressed')).toBe('true');
    expect(btn(el, 'grid').classList.contains('pressed')).toBe(true);
    api.setPressed('grid', false);
    expect(btn(el, 'grid').getAttribute('aria-pressed')).toBe('false');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('setEnabled disables a button with the given title and re-enables it without a title', () => {
    const { el, api } = mount();
    api.setEnabled('wall', false, 'Solo lectura');
    expect(btn(el, 'wall').disabled).toBe(true);
    expect(btn(el, 'wall').title).toBe('Solo lectura');
    api.setEnabled('wall', true);
    expect(btn(el, 'wall').disabled).toBe(false);
    expect(btn(el, 'wall').title).toBe('');
  });

  it('los dos botones Level (Architecture y Structure) se activan y desactivan juntos', () => {
    const { el, api, onAction } = mount();
    const both = () => [...el.querySelectorAll<HTMLButtonElement>('button[data-action="level"]')];
    expect(both()).toHaveLength(2);
    api.setEnabled('level', false, 'Solo lectura');
    expect(both().map((b) => [b.disabled, b.title])).toEqual([[true, 'Solo lectura'], [true, 'Solo lectura']]);
    api.setEnabled('level', true);
    expect(both().every((b) => !b.disabled && b.title === '')).toBe(true);
    both()[1].click();
    expect(onAction).toHaveBeenCalledWith('level', false);
  });

  describe('button with a menu (Levels ▾)', () => {
    const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
    const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

    it('lleva ▾ y al pulsarlo abre Off / Outline / Plane / Selected sin llamar a onAction', () => {
      const { el, onAction } = mount();
      expect(btn(el, 'levels').textContent).toContain('▾');
      expect(menu()).toBeNull();
      btn(el, 'levels').click();
      expect(menu()).not.toBeNull();
      expect(items().map((i) => i.textContent)).toEqual(['Off', 'Outline', 'Plane', 'Selected']);
      expect(onAction).not.toHaveBeenCalled();
    });

    it('choosing an option calls onAction with its value and closes the menu', () => {
      const { el, onAction } = mount();
      btn(el, 'levels').click();
      items()[2].click();
      expect(onAction).toHaveBeenCalledWith('levels', false, 'plane');
      expect(menu()).toBeNull();
    });

    it('setMenuValue marks only the chosen option', () => {
      const { el, api } = mount();
      api.setMenuValue('levels', 'outline');
      btn(el, 'levels').click();
      expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
      api.setMenuValue('levels', 'off'); // with the menu open it is also updated
      expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
    });

    it('Esc y un clic fuera cierran sin llamar a onAction', () => {
      const { el, onAction } = mount();
      btn(el, 'levels').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(menu()).toBeNull();
      btn(el, 'levels').click();
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(menu()).toBeNull();
      expect(onAction).not.toHaveBeenCalled();
    });

    it('pressing the button with the menu open closes it', () => {
      const { el } = mount();
      btn(el, 'levels').click();
      btn(el, 'levels').click();
      expect(menu()).toBeNull();
    });
  });

  it('empieza en Arquitectura y al elegir Estructura muestra solo su panel', () => {
    const { el } = mount();
    const panels = () => [...el.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels()).toHaveLength(6);
    expect(panels().filter((p) => !p.hidden)).toHaveLength(1);
    expect(tabBtn(el, 'Architecture').getAttribute('aria-selected')).toBe('true');

    tabBtn(el, 'Structure').click();
    const visible = panels().filter((p) => !p.hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(tabBtn(el, 'Structure').getAttribute('aria-controls'));
    expect(tabBtn(el, 'Structure').getAttribute('aria-selected')).toBe('true');
    expect(tabBtn(el, 'Architecture').getAttribute('aria-selected')).toBe('false');
  });

  it('it shows the labels of the groups', () => {
    const { el } = mount();
    const names = [...el.querySelectorAll('.ribbon-group-label')].map((n) => n.textContent);
    expect(names).toContain('Build');
    expect(names).toContain('Graphics');
  });

  it('a double click on a tab minimizes and another double click restores', () => {
    const { el, api } = mount();
    const tab = tabBtn(el, 'Architecture');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(api.minimized).toBe(true);
    expect(el.querySelector('.ribbon')!.classList.contains('is-minimized')).toBe(true);
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(api.minimized).toBe(false);
  });

  it('the button at the end of the tab bar minimizes', () => {
    const { el, api } = mount();
    const button = el.querySelector<HTMLButtonElement>('button.ribbon-minimize')!;
    expect(button.title).toBe('Minimize the ribbon (Ctrl+F1)');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(api.minimized).toBe(true);
    expect(button.title).toBe('Expand the ribbon (Ctrl+F1)');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('minimized, a click on a tab opens it floating (is-peek) and selects it', () => {
    const { el, api } = mount();
    api.setMinimized(true);
    tabBtn(el, 'View').click();
    expect(el.querySelector('.ribbon')!.classList.contains('is-peek')).toBe(true);
    expect(api.activeTab()).toBe('vista');
  });

  it('the floating view closes with Escape, with pointerdown outside and after pressing a button', () => {
    const { el, api, onAction } = mount();
    api.setMinimized(true);
    const open = () => {
      tabBtn(el, 'View').click();
      expect(el.querySelector('.ribbon')!.classList.contains('is-peek')).toBe(true);
    };
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.querySelector('.ribbon')!.classList.contains('is-peek')).toBe(false);
    open();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(el.querySelector('.ribbon')!.classList.contains('is-peek')).toBe(false);
    open();
    btn(el, 'fit').click();
    expect(el.querySelector('.ribbon')!.classList.contains('is-peek')).toBe(false);
    expect(onAction).toHaveBeenCalledWith('fit', false);
  });

  it('onMinimizedChange solo cuando cambia', () => {
    const { api } = mount();
    const changed = vi.fn();
    api.onMinimizedChange(changed);
    api.setMinimized(true);
    api.setMinimized(true);
    api.setMinimized(false);
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });
});

describe('File menu', () => {
  const recents: RecentEntry[] = [
    { path: 'C:/a/casa.ifcx', name: 'casa.ifcx', openedAt: 1, thumbnail: null },
    { path: 'C:/a/torre.ifcx', name: 'torre.ifcx', openedAt: 2, thumbnail: null },
  ];

  function setup(list: RecentEntry[] = recents) {
    document.body.innerHTML = '<button id="file">File</button><div id="outside">outside</div>';
    const anchor = document.getElementById('file') as HTMLButtonElement;
    const acts = {
      onOpen: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onClose: vi.fn(),
      onExit: vi.fn(),
      recents: vi.fn(() => list),
      onOpenRecent: vi.fn(),
    };
    mountFileMenu(anchor, acts);
    const menu = () => document.querySelector<HTMLElement>('.file-menu')!;
    return { anchor, acts, menu };
  }
  const item = (label: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('.file-menu button')].find((b) => b.textContent?.includes(label))!;

  it('it opens and closes with the File button', () => {
    const { anchor, menu } = setup();
    expect(menu().hidden).toBe(true);
    anchor.click();
    expect(menu().hidden).toBe(false);
    expect(anchor.getAttribute('aria-expanded')).toBe('true');
    anchor.click();
    expect(menu().hidden).toBe(true);
    expect(anchor.getAttribute('aria-expanded')).toBe('false');
  });

  it('se cierra con Esc y con un clic fuera', () => {
    const { anchor, menu } = setup();
    anchor.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu().hidden).toBe(true);
    anchor.click();
    document.getElementById('outside')!.click();
    expect(menu().hidden).toBe(true);
  });

  it('a click inside the menu does not close it', () => {
    const { anchor, menu } = setup();
    anchor.click();
    menu().querySelector<HTMLElement>('.file-menu-recents')!.click();
    expect(menu().hidden).toBe(false);
  });

  it('it lists the recents and pressing one opens it and closes the menu', () => {
    const { anchor, acts, menu } = setup();
    anchor.click();
    const rows = [...menu().querySelectorAll<HTMLButtonElement>('.file-menu-recent')];
    expect(rows.map((r) => r.textContent)).toEqual(['casa.ifcx', 'torre.ifcx']);
    rows[1].click();
    expect(acts.onOpenRecent).toHaveBeenCalledWith(recents[1]);
    expect(menu().hidden).toBe(true);
  });

  it('without recents it shows an empty text', () => {
    const { anchor, menu } = setup([]);
    anchor.click();
    expect(menu().querySelectorAll('.file-menu-recent')).toHaveLength(0);
    expect(menu().textContent).toContain('No recent documents');
  });

  it('Import IFC is disabled; Open, Close and Exit call their action and close', () => {
    const { anchor, acts, menu } = setup();
    anchor.click();
    expect(item('Import IFC').disabled).toBe(true);
    expect(item('Import IFC').title).toBe('Coming soon');
    item('Open').click();
    expect(acts.onOpen).toHaveBeenCalledTimes(1);
    expect(menu().hidden).toBe(true);
    anchor.click();
    item('Close').click();
    expect(acts.onClose).toHaveBeenCalledTimes(1);
    anchor.click();
    item('Exit').click();
    expect(acts.onExit).toHaveBeenCalledTimes(1);
  });
});

describe('File menu: Theme section', () => {
  beforeEach(() => {
    localStorage.clear();
    initTheme(); // system
    document.body.innerHTML = '<button id="file">File</button>';
    mountFileMenu(document.getElementById('file') as HTMLButtonElement, {
      onOpen() {},
      onSave() {},
      onSaveAs() {},
      onClose() {},
      onExit() {},
      recents: () => [],
      onOpenRecent() {},
    });
    document.getElementById('file')!.click();
  });

  const menu = () => document.querySelector<HTMLElement>('.file-menu')!;
  const radios = () => [...menu().querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  const checked = () => radios().map((r) => r.getAttribute('aria-checked'));

  it('it has a Theme section with Light, Dark and System; System active by default', () => {
    expect(menu().textContent).toContain('Theme');
    expect(radios().map((r) => r.textContent)).toEqual(['Light', 'Dark', 'System']);
    expect(checked()).toEqual(['false', 'false', 'true']);
  });

  it('choosing an option changes the preference and closes the menu', () => {
    radios()[1].click();
    expect(getThemePref()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(menu().hidden).toBe(true);
    document.getElementById('file')!.click();
    expect(checked()).toEqual(['false', 'true', 'false']);
  });

  it('it shows a change made from the title bar button (a single state)', () => {
    setThemePref('light');
    expect(checked()).toEqual(['true', 'false', 'false']);
  });
});

describe('contextual tabs', () => {
  const ctxTab = (el: HTMLElement) => tabBtn(el, FLOOR_SKETCH_TAB.label);

  it('the floor sketch tab has the Mode and Draw groups of Revit', () => {
    expect(FLOOR_SKETCH_TAB.label).toBe('Modify | Create Floor Boundary');
    const group = (name: string) => FLOOR_SKETCH_TAB.groups.find((g) => g.label === name)!;
    expect(labels(group('Mode').buttons)).toEqual(['Finish Edit Mode', 'Cancel Edit Mode']);
    expect(labels(group('Draw').buttons)).toEqual(['Pick Walls', 'Line', 'Rectangle']);
    expect(group('Draw').buttons.every((b) => b.radio === 'draw')).toBe(true);
  });

  it('showContextual adds the tab at the end, selects it and shows its panel', () => {
    const { el, api } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    const tabs = [...el.querySelectorAll('[role="tab"]')];
    expect(tabs.at(-1)).toBe(ctxTab(el));
    expect(ctxTab(el).getAttribute('aria-selected')).toBe('true');
    expect(tabBtn(el, 'Architecture').getAttribute('aria-selected')).toBe('false');
    expect(btn(el, 'sketchFinish').closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  });

  it('hideContextual removes it and goes back to the tab that was active', () => {
    const { el, api } = mount();
    tabBtn(el, 'View').click();
    api.showContextual(FLOOR_SKETCH_TAB);
    api.hideContextual();
    expect(el.querySelector('[data-action="sketchFinish"]')).toBeNull();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(RIBBON.length);
    expect(tabBtn(el, 'View').getAttribute('aria-selected')).toBe('true');
  });

  it('showing it twice does not duplicate the tab or forget what to go back to', () => {
    const { el, api } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    api.showContextual(FLOOR_SKETCH_TAB);
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(RIBBON.length + 1);
    api.hideContextual();
    expect(tabBtn(el, 'Architecture').getAttribute('aria-selected')).toBe('true');
  });

  it('hideContextual without a tab does nothing', () => {
    const { el, api } = mount();
    api.hideContextual();
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(RIBBON.length);
  });

  it('the drawing tools are radio: pressing one releases the others and notifies', () => {
    const { el, api, onAction } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    api.setPressed('sketchPick', true);
    btn(el, 'sketchLine').click();
    expect(onAction).toHaveBeenCalledWith('sketchLine', true);
    expect(btn(el, 'sketchLine').getAttribute('aria-pressed')).toBe('true');
    expect(btn(el, 'sketchPick').getAttribute('aria-pressed')).toBe('false');
    btn(el, 'sketchLine').click(); // un radio pulsado se queda pulsado
    expect(btn(el, 'sketchLine').getAttribute('aria-pressed')).toBe('true');
  });

  it('setPressed on a radio releases the others without calling onAction', () => {
    const { el, api, onAction } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    api.setPressed('sketchRect', true);
    api.setPressed('sketchPick', true);
    expect(btn(el, 'sketchRect').getAttribute('aria-pressed')).toBe('false');
    expect(btn(el, 'sketchPick').getAttribute('aria-pressed')).toBe('true');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Finish y Cancel avisan sin quedar pulsados', () => {
    const { el, api, onAction } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    btn(el, 'sketchFinish').click();
    btn(el, 'sketchCancel').click();
    expect(onAction.mock.calls).toEqual([['sketchFinish', false], ['sketchCancel', false]]);
  });

  it('setEnabled reaches the buttons of the contextual tab', () => {
    const { el, api } = mount();
    api.showContextual(FLOOR_SKETCH_TAB);
    api.setEnabled('sketchFinish', false, 'x');
    expect(btn(el, 'sketchFinish').disabled).toBe(true);
  });

  it('the Floor button is a toggle with an action', () => {
    const { el } = mount();
    expect(btn(el, 'floor')).toBeTruthy();
    expect(btn(el, 'floor').getAttribute('aria-pressed')).toBe('false');
  });
});


describe('mountRibbon: batches of tabs', () => {
  const EXTRA: RibbonTab = {
    id: 'materiales',
    label: 'Materials',
    groups: [{ label: 'Material', buttons: [{ id: 'mat-x', label: 'X', icon: 'folder' }] }],
  };
  function mountWith(defs: RibbonTab[]) {
    document.body.innerHTML = '<div id="ribbon"></div>';
    const el = document.getElementById('ribbon') as HTMLElement;
    const api = mountRibbon(el, vi.fn(), defs);
    return { el, api };
  }
  const visibleTabs = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('[role="tab"]')].filter((t) => !t.hidden).map((t) => t.textContent);

  it('showTabs shows only the requested tabs and selects the active one', () => {
    const { el, api } = mountWith([...RIBBON, EXTRA]);
    api.showTabs(['materiales'], 'materiales');
    expect(visibleTabs(el)).toEqual(['Materials']);
    expect(tabBtn(el, 'Materials').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector<HTMLElement>('#ribbon-panel-arquitectura')!.hidden).toBe(true);
    expect(api.activeTab()).toBe('materiales');
  });

  it('volver a una tanda conserva el estado de sus toggles', () => {
    const { el, api } = mountWith([...RIBBON, EXTRA]);
    btn(el, 'xray').click();
    api.showTabs(['materiales'], 'materiales');
    api.showTabs(RIBBON.map((t) => t.id), 'vista');
    expect(btn(el, 'xray').getAttribute('aria-pressed')).toBe('true');
    expect(api.activeTab()).toBe('vista');
  });

  it('the arrows only go through the visible tabs', () => {
    const { el, api } = mountWith([...RIBBON, EXTRA]);
    api.showTabs(['vista', 'gestionar'], 'gestionar');
    tabBtn(el, 'Manage').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(api.activeTab()).toBe('vista');
  });

  it('showTabs closes the contextual one and activeTab gives the one below while it is open', () => {
    const { el, api } = mountWith([...RIBBON, EXTRA]);
    api.showTabs(RIBBON.map((t) => t.id), 'vista');
    api.showContextual(FLOOR_SKETCH_TAB);
    expect(api.activeTab()).toBe('vista');
    api.showTabs(['materiales'], 'materiales');
    expect(el.querySelector('#ribbon-tab-floor-sketch')).toBeNull();
  });
});
