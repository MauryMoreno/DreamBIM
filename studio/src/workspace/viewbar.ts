import type { ViewRef } from '../browser/views';
import type { VisualStyle } from '../render/styles';
import { SOON } from '../ribbon/definition';
import { toggleRadioMenu } from '../shell/radiomenu';
import { VISUAL_STYLES, type Toggle } from './constants';
import type { WorkspaceContext } from './context';
import { el } from './layout';
import { svgIcon, type StudioIcon } from '../shell/icons';
import type { ViewTabs } from './viewtabs';

export interface ViewbarDeps {
  tabs: ViewTabs;
  planCut(v: ViewRef): number;
}

export interface ViewbarController {
  setToggle(t: Toggle, on: boolean): void;
  /** The Visual Style button carries the icon of the active view's style (like Revit). */
  showStyleIcon(style: VisualStyle): void;
}

export function mountViewbar(ctx: WorkspaceContext, deps: ViewbarDeps): ViewbarController {
  const { layout, state, viewer, ribbon } = ctx;
  const { tabs } = deps;

  const scale = el('span', 'ws-scale', '1 : 100');
  scale.title = 'View scale';
  const vbButton = (icon: StudioIcon, title: string, onClick?: () => void) => {
    const b = el('button', 'ws-vb-btn');
    b.type = 'button';
    b.title = onClick ? title : `${title} — ${SOON}`;
    b.setAttribute('aria-label', title);
    b.appendChild(svgIcon(icon, 16));
    if (onClick) b.addEventListener('click', onClick);
    else b.disabled = true;
    return b;
  };
  const shadowsBtn = vbButton('sun', 'Shadows', () => setToggle('shadows', !state.toggles.shadows));
  // Visual Style: each view remembers its own (ViewTabs); the menu opens upwards, over the bar
  const styleBtn = vbButton('cube3d', 'Visual Style', () => {
    const a = tabs.active;
    if (!a) return;
    toggleRadioMenu(styleBtn, VISUAL_STYLES, a.style, (v) => {
      tabs.setStyle(a.id, v as VisualStyle);
      viewer.setVisualStyle(v as VisualStyle);
      showStyleIcon(v as VisualStyle);
    }, { above: true });
  });
  const showStyleIcon = (style: VisualStyle): void => {
    if (styleBtn.dataset.style === style) return;
    styleBtn.dataset.style = style;
    styleBtn.replaceChildren(svgIcon(VISUAL_STYLES.find((s) => s.value === style)!.icon, 16));
  };
  styleBtn.setAttribute('aria-haspopup', 'menu');
  shadowsBtn.setAttribute('aria-pressed', 'false');
  layout.viewbar.append(
    scale,
    el('span', 'ws-vb-sep'),
    styleBtn,
    shadowsBtn,
    vbButton('detail', 'Detail Level'),
  );

  function setToggle(t: Toggle, on: boolean): void {
    state.toggles[t] = on;
    ribbon.setPressed(t, on);
    if (t === 'xray') viewer.setXray(on);
    else if (t === 'shadows') {
      viewer.setShadows(on);
      shadowsBtn.setAttribute('aria-pressed', String(on));
      shadowsBtn.classList.toggle('pressed', on);
    } else if (t === 'grid') viewer.setGrid(on);
    else {
      const v = tabs.active?.view;
      if (v?.kind === 'plan') viewer.setSectionAt(on, deps.planCut(v));
      else viewer.setSectionBox(on);
    }
  }

  return { setToggle, showStyleIcon };
}
