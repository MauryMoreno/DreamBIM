import { CardViewer } from './types';
import { el, message } from './helpers';
import { compose } from '../../ifcx/compose';
import { svgIcon } from '../../shell/icons';
import { renderCard } from '../card';
import type { CollectionContext } from './context';

export function installLarge(ctx: CollectionContext): void {
  // --- carta grande: visor vivo, niveles de detalle y colocar --------------------------------------
  ctx.canPlace = false;

  ctx.closeLarge = null;

  /** Every open or close invalidates the pending reads. */
  let openTicket = 0;

  /** The viewer is created once and reused: each Viewer is a WebGL context and cannot be released. */
  let viewer: CardViewer | null = null;

  let viewerHost: HTMLElement | null = null;

  const openLarge = (path: string): void => {
    const info = ctx.records.get(path)?.info;
    if (!info) return;
    ctx.closeLarge?.();
    const t = ++openTicket;

    const overlay = el('div', 'col-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', info.name);
    const panel = el('div', 'col-panel');
    const peers = ctx.files.filter((f) => ctx.records.get(f.path)?.info?.typeFolder === info.typeFolder);
    const card = renderCard(info, 'large', {
      lod: 0,
      sizes: { index: peers.findIndex((f) => f.path === path) + 1, total: peers.length },
      number: ctx.numbers.get(path),
      statMax: ctx.statMax(),
      onLod(level) {
        viewer?.setLod({ enabled: true, force: level });
        card.querySelectorAll<HTMLButtonElement>('.card-lods button').forEach((b, i) => {
          b.setAttribute('aria-pressed', String(info.lods[i]?.level === level));
        });
      },
    });
    const close = el('button', 'col-close');
    close.append(svgIcon('close', 14));
    close.title = 'Close (Esc)';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    const place = el('button', 'col-place', 'Place');
    place.type = 'button';
    const syncPlace = (): void => {
      place.disabled = !ctx.canPlace;
      place.title = ctx.canPlace ? 'Link this file to the open model' : 'Open a model to place this';
    };
    syncPlace();
    ctx.placeSync = syncPlace;
    place.addEventListener('click', () => ctx.cb.onPlace(path));
    panel.append(card, el('div', 'col-actions'), close);
    panel.querySelector('.col-actions')!.append(place);
    overlay.append(panel);
    ctx.host.append(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) ctx.closeLarge?.();
    });
    close.addEventListener('click', () => ctx.closeLarge?.());
    ctx.closeLarge = () => {
      openTicket++;
      viewer?.disposeModel();
      viewerHost?.remove();
      overlay.remove();
      ctx.placeSync = null;
      ctx.closeLarge = null;
    };

    const art = card.querySelector<HTMLElement>('.card-art')!;
    viewerHost ??= el('div', 'col-viewer');
    art.append(viewerHost); // en el DOM antes de crear el visor: mide su contenedor al construirse
    viewer ??= ctx.deps.createViewer(viewerHost);
    ctx.indexer.load(path).then(
      (file) => {
        if (t !== openTicket || !viewer) return;
        viewer.setModel(compose([file]).root);
        viewer.setLod({ enabled: true, force: 0 });
        viewer.fit();
      },
      (e) => {
        if (t !== openTicket) return;
        art.append(el('div', 'col-viewer-error', message(e)));
      },
    );
  };
  ctx.openLarge = openLarge;
}
