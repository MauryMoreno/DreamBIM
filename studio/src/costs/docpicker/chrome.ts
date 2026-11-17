import { el } from './helpers';
import type { DocPickerContext } from './context';

export function installChrome(ctx: DocPickerContext): void {
  const s = ctx.o.state;
  ctx.s = s;

  const scrim = el('div', 'modal-scrim');
  ctx.scrim = scrim;

  const box = el('div', 'modal doc-picker');
  ctx.box = box;

  box.setAttribute('role', 'dialog');

  box.setAttribute('aria-modal', 'true');

  box.setAttribute('aria-label', `Pick a value for ${ctx.o.target}`);

  const title = el('div', 'modal-title doc-picker-title', `Pick the price per unit · ${ctx.o.target}`);

  const bar = el('div', 'doc-picker-bar');
  ctx.bar = bar;

  const tabs = el('div', 'doc-picker-sheets');
  ctx.tabs = tabs;

  tabs.setAttribute('role', 'tablist');

  tabs.setAttribute('aria-label', 'Sheets');

  const body = el('div', 'doc-picker-body');
  ctx.body = body;

  const error = el('div', 'sch-error');
  ctx.error = error;

  const hint = el('span', 'doc-picker-hint');
  ctx.hint = hint;

  const cancel = el('button', 'modal-btn', 'Cancel');
  ctx.cancel = cancel;

  cancel.type = 'button';

  // what was selected by hand with the mouse: any part of the document
  const useSel = el('button', 'modal-btn modal-btn-primary doc-picker-use', 'Use Selection');
  ctx.useSel = useSel;

  useSel.type = 'button';

  useSel.hidden = true;

  const foot = el('div', 'doc-picker-foot');

  foot.append(hint, useSel, cancel);

  box.append(title, bar, tabs, body, error, foot);

  scrim.append(box);
}
