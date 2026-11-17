import { START_PX } from './helpers';
import type { GanttContext } from './context';

export function installInit(ctx: GanttContext): void {
  ctx.setPx(START_PX);

  ctx.syncZoomButtons();
}
